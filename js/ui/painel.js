/**
 * =============================================================================
 * js/ui/painel.js — Painel (Dashboard) completo (RF-60 a RF-63)
 * -----------------------------------------------------------------------------
 * Filtros no topo: MÊS e VISÃO (Eu / cônjuge / Família) — D-18. Blocos:
 *   1. Números do mês: ganhos, gastos, saldo, taxa de poupança.
 *   2. Previsto × realizado (conciliação — RN-01).
 *   3. Para onde foi o dinheiro: gastos por categoria (rosca + lista).
 *   4. Ganhos × gastos nos últimos 12 meses.
 *   5. Fixos × variáveis nos últimos 6 meses.
 *   6. Gastos por forma de pagamento.
 *   7. Faturas do cartão nos próximos 6 meses (parcelas já comprometidas).
 *   8. Orçamento × realizado por categoria (80% atenção, 100% estourou).
 *   9. Mapa dos gastos com localização.
 *
 * Os números vêm de js/dashboard.js (testado). Os dados de cada mês ficam
 * guardados no aparelho: sem internet, o Painel mostra a última cópia.
 * Lançamentos ainda "aguardando sinal" entram depois de sincronizar.
 * =============================================================================
 */
import { h, trocar } from './dom.js';
import { chips } from './componentes.js';
import { barras, rosca, tabelaNumeros, tema } from './graficos.js';
import * as db from '../db.js';
import * as calc from '../dashboard.js';
import { desenharMapa } from '../mapa.js';
import { lerCache, gravarCache } from '../offline.js';
import { log } from '../log.js';
import { moeda, percentual, mesExtenso, mesAbrev, hojeSP, competenciaDe, somarMesesCompetencia } from '../formato.js';
import { estado, membrosOrdenados, categoriaPorId, nomeMembro } from '../estado.js';

const ROTULO_FORMA = { pix: 'PIX', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', boleto: 'Boleto', outro: 'Outro' };

/** Filtros guardados enquanto o app está aberto. */
const filtros = { competencia: null, visao: 'familia' };

export function montarPainel(raiz) {
  filtros.competencia ??= competenciaDe(hojeSP());
  let dados = null;
  let graficos = [];
  let mapa = null;
  let geracao = 0; // descarta desenhos de um mês que já não está na tela

  const titulo = h('h2', { class: 'titulo-mes' });
  const aviso = h('p', { class: 'dica' });
  const corpo = h('div', { class: 'painel' });

  const opcoesVisao = [
    ...membrosOrdenados().map((m) => ({ valor: m.id, rotulo: m.id === estado.perfil.id ? 'Eu' : m.nome })),
    { valor: 'familia', rotulo: 'Família' },
  ];
  if (filtros.visao !== 'familia' && !opcoesVisao.some((o) => o.valor === filtros.visao)) filtros.visao = 'familia';
  const seletorVisao = chips({
    opcoes: opcoesVisao, valor: filtros.visao, rotulo: 'Visão', rolavel: false,
    aoEscolher: (v) => { filtros.visao = v; desenhar(); },
  });

  const mudarMes = (n) => { filtros.competencia = somarMesesCompetencia(filtros.competencia, n); carregar(); };

  // ---- Dados -----------------------------------------------------------------
  async function carregar() {
    const competencia = filtros.competencia;
    titulo.textContent = mesExtenso(competencia);
    const chave = `painel:${competencia}`;
    dados = await lerCache(chave);
    aviso.textContent = dados ? 'Atualizando…' : 'Carregando…';
    desenhar();
    try {
      const novos = await db.dadosPainel(competencia, {
        inicio12: somarMesesCompetencia(competencia, -11),
        fim6: somarMesesCompetencia(competencia, 6),
        proximaCompetencia: somarMesesCompetencia(competencia, 1),
      });
      if (competencia !== filtros.competencia) return;
      dados = novos;
      await gravarCache(chave, novos);
      aviso.textContent = '';
    } catch (e) {
      aviso.textContent = e.tipo === 'rede'
        ? (dados ? 'Sem internet — mostrando a última cópia guardada.' : 'Sem internet — conecte-se para ver o painel deste mês.')
        : e.message;
    }
    desenhar();
  }

  function limparGraficos() {
    graficos.forEach((g) => g.destroy());
    graficos = [];
    mapa?.remover();
    mapa = null;
  }

  // ---- Desenho ---------------------------------------------------------------
  function desenhar() {
    geracao++;
    limparGraficos();
    if (!dados) { trocar(corpo); return; }

    const { visao, competencia } = filtros;
    const t = tema();
    const r = calc.resumoDoMes(dados.resumo, visao, competencia);

    trocar(corpo,
      blocoNumeros(r),
      blocoPrevisto(calc.previstoRealizado({
        recorrencias: estado.recorrencias, orcamentos: dados.orcamentos, parcelas: dados.parcelas,
        linhasResumo: dados.resumo, visao, competencia,
      })),
      blocoCategorias(calc.porCategoria(dados.parcelas, visao, competencia)),
      blocoDozeMeses(calc.serieMensal(dados.resumo, visao, competencia, 12), t),
      blocoFixosVariaveis(calc.serieMensal(dados.resumo, visao, competencia, 6), t),
      blocoFormas(calc.porFormaPagamento(dados.parcelas, visao, competencia), t),
      blocoFaturas(calc.projecaoFaturas(dados.parcelas, visao, competencia, 6), t),
      blocoOrcamento(calc.orcadoRealizado(dados.orcamentos, dados.parcelas, visao, competencia, estado.categorias)),
      blocoMapa(dados.mapa.filter(calc.naVisao(visao))),
      h('p', { class: 'dica' }, 'Gastos contam pelo mês da fatura (competência). Lançamentos aguardando sinal entram depois de sincronizar.'),
    );
  }

  /** Seção com título, subtítulo e conteúdo. */
  const secao = (tituloSecao, subtitulo, ...conteudo) => h('section', { class: 'secao' },
    h('h3', { class: 'secao-titulo' }, tituloSecao), subtitulo ? h('p', { class: 'secao-sub' }, subtitulo) : null, ...conteudo);

  /** Canvas do Chart.js dentro de um container com altura fixa. */
  function areaGrafico(altura, criar) {
    const canvas = h('canvas', { role: 'img' });
    const area = h('div', { class: 'area-grafico', style: { height: `${altura}px` } }, canvas);
    const minhaGeracao = geracao;
    criar(canvas)
      .then((g) => { if (minhaGeracao === geracao) graficos.push(g); else g.destroy(); })
      .catch((e) => {
        log.aviso('painel', 'Gráfico não carregou', e);
        trocar(area, h('p', { class: 'vazio' }, 'Gráficos precisam de internet no primeiro acesso ao Painel.'));
      });
    return area;
  }

  // 1. Números do mês ----------------------------------------------------------
  function blocoNumeros(r) {
    const card = (rotulo, valor, classe = '', sub) => h('div', { class: `card ${classe}` },
      h('span', { class: 'card-rotulo' }, rotulo), h('strong', { class: 'card-valor' }, valor), sub ? h('small', {}, sub) : null);
    const semGanho = r.receitas === 0;
    return h('div', {},
      h('div', { class: 'cards' },
        card('Ganhos', moeda(r.receitas), 'positivo'),
        card('Gastos', moeda(r.despesas), 'negativo'),
        card('Saldo do mês', moeda(r.saldo), r.saldo >= 0 ? 'positivo' : 'negativo'),
        card('Taxa de poupança', percentual(r.taxaPoupanca), (r.taxaPoupanca ?? 0) >= 10 ? 'positivo' : 'atencao',
          r.fixosSobreRenda != null ? `fixos = ${percentual(r.fixosSobreRenda)} da renda` : null)),
      semGanho ? h('p', { class: 'alerta-inline' }, '💡 Nenhum ganho registrado neste mês — lance os ganhos para a conciliação fazer sentido.') : null);
  }

  // 2. Previsto × realizado ----------------------------------------------------
  function blocoPrevisto(p) {
    const diferenca = (l) => {
      if (l.previsto == null) return '—';
      const d = l.realizado - l.previsto;
      if (d === 0) return '= no previsto';
      const acima = d > 0;
      // Para ganho, acima é bom; para gasto, acima é ruim. Texto + símbolo (nunca só cor).
      const bom = l.tipo === 'ganho' ? acima : !acima;
      return h('span', { class: bom ? 'dif-bom' : 'dif-ruim' }, `${acima ? '▲' : '▼'} ${moeda(Math.abs(d))}`);
    };
    return secao('Previsto × realizado', 'Previsto: gastos e ganhos fixos cadastrados + orçamentos.',
      h('table', { class: 'tabela-conciliacao' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Previsto'), h('th', {}, 'Realizado'), h('th', {}, 'Diferença'))),
        h('tbody', {},
          p.linhas.map((l) => h('tr', {},
            h('th', { scope: 'row' }, l.rotulo),
            h('td', {}, l.previsto == null ? h('span', { class: 'mudo' }, 'sem orçamento') : moeda(l.previsto)),
            h('td', {}, moeda(l.realizado)),
            h('td', {}, diferenca(l)))),
          h('tr', { class: 'linha-total' },
            h('th', { scope: 'row' }, 'Saldo'),
            h('td', {}, moeda(p.saldoPrevisto)),
            h('td', {}, moeda(p.saldoRealizado)),
            h('td', {}, diferenca({ previsto: p.saldoPrevisto, realizado: p.saldoRealizado, tipo: 'ganho' }))))),
      p.parcelasAnteriores > 0
        ? h('p', { class: 'secao-sub' }, `Inclui ${moeda(p.parcelasAnteriores)} de parcelas de compras feitas em meses anteriores.`)
        : null);
  }

  // 3. Categorias ---------------------------------------------------------------
  function blocoCategorias(cats) {
    if (cats.length === 0) return secao('Para onde foi o dinheiro', null, h('p', { class: 'vazio' }, 'Nenhum gasto neste mês.'));
    return secao('Para onde foi o dinheiro', 'Gastos do mês por categoria',
      h('div', { class: 'rosca-e-lista' },
        areaGrafico(170, (c) => rosca(c, { fatias: cats })),
        h('ul', { class: 'lista-legenda' }, cats.map((c) => h('li', {},
          h('span', { class: 'amostra', style: { background: c.cor } }),
          h('span', { class: 'legenda-nome' }, `${c.icone} ${c.nome}`),
          h('span', { class: 'legenda-valor' }, moeda(c.total), h('small', {}, ` ${Math.round(c.pct)}%`)))))));
  }

  // 4. 12 meses ----------------------------------------------------------------
  function blocoDozeMeses(serie, t) {
    return secao('Ganhos × gastos', 'Últimos 12 meses',
      areaGrafico(220, (c) => barras(c, {
        rotulos: serie.map((s) => mesAbrev(s.competencia)),
        series: [
          { nome: 'Ganhos', dados: serie.map((s) => s.receitas), cor: t.ganhos },
          { nome: 'Gastos', dados: serie.map((s) => s.despesas), cor: t.gastos },
        ],
      })),
      tabelaNumeros(['Mês', 'Ganhos', 'Gastos', 'Saldo'],
        serie.map((s) => [mesAbrev(s.competencia), moeda(s.receitas), moeda(s.despesas), moeda(s.receitas - s.despesas)])));
  }

  // 5. Fixos × variáveis --------------------------------------------------------
  function blocoFixosVariaveis(serie, t) {
    return secao('Fixos × variáveis', 'Últimos 6 meses',
      areaGrafico(200, (c) => barras(c, {
        rotulos: serie.map((s) => mesAbrev(s.competencia)),
        empilhado: true,
        series: [
          { nome: 'Fixos', dados: serie.map((s) => s.fixas), cor: t.fixos },
          { nome: 'Variáveis', dados: serie.map((s) => s.variaveis), cor: t.gastos },
        ],
      })),
      tabelaNumeros(['Mês', 'Fixos', 'Variáveis'], serie.map((s) => [mesAbrev(s.competencia), moeda(s.fixas), moeda(s.variaveis)])));
  }

  // 6. Formas de pagamento -------------------------------------------------------
  function blocoFormas(formas, t) {
    if (formas.length === 0) return null;
    return secao('Por forma de pagamento', 'Gastos do mês',
      areaGrafico(Math.max(90, formas.length * 34), (c) => barras(c, {
        horizontal: true,
        rotulos: formas.map((f) => ROTULO_FORMA[f.forma] ?? f.forma),
        series: [{ nome: 'Gastos', dados: formas.map((f) => f.total), cor: t.gastos }],
      })),
      tabelaNumeros(['Forma', 'Total'], formas.map((f) => [ROTULO_FORMA[f.forma] ?? f.forma, moeda(f.total)])));
  }

  // 7. Faturas futuras -------------------------------------------------------------
  function blocoFaturas(proj, t) {
    const total = proj.reduce((s, p) => s + p.total, 0);
    return secao('Faturas do cartão', `Próximos 6 meses — ${moeda(total)} já comprometidos em parcelas`,
      total === 0 ? h('p', { class: 'vazio' }, 'Nenhuma parcela a vencer nos próximos meses. 🎉') :
        areaGrafico(180, (c) => barras(c, {
          rotulos: proj.map((p) => mesAbrev(p.competencia)),
          series: [{ nome: 'Faturas', dados: proj.map((p) => p.total), cor: t.gastos }],
        })),
      total === 0 ? null : tabelaNumeros(['Mês', 'Parcelas'], proj.map((p) => [mesAbrev(p.competencia), moeda(p.total)])));
  }

  // 8. Orçamento --------------------------------------------------------------------
  function blocoOrcamento(itens) {
    const ICONE = { ok: '✓', atencao: '⚠', estourado: '⛔' };
    const TEXTO = { ok: 'dentro', atencao: 'atenção', estourado: 'estourou' };
    return secao('Orçamento × realizado', filtros.visao === 'familia' ? 'Orçamentos da família' : 'Orçamentos individuais',
      itens.length === 0
        ? h('p', { class: 'vazio' }, 'Nenhum orçamento definido para esta visão. Defina em Mais → Orçamentos.')
        : h('ul', { class: 'lista-orcamento' }, itens.map((o) => h('li', {},
          h('div', { class: 'orc-linha' },
            h('span', {}, `${o.icone} ${o.nome}`),
            h('span', { class: `orc-status ${o.situacao}` }, `${ICONE[o.situacao]} ${o.pct}% · ${TEXTO[o.situacao]}`)),
          h('div', { class: 'orc-trilho', role: 'progressbar', 'aria-valuenow': String(o.pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': o.nome },
            h('div', { class: `orc-barra ${o.situacao}`, style: { width: `${Math.min(o.pct, 100)}%` } })),
          h('small', { class: 'secao-sub' }, `${moeda(o.realizado)} de ${moeda(o.orcado)}`)))));
  }

  // 9. Mapa ----------------------------------------------------------------------
  function blocoMapa(gastos) {
    if (gastos.length === 0) {
      return secao('Mapa dos gastos', null, h('p', { class: 'vazio' }, 'Nenhum gasto com localização neste mês.'));
    }
    const area = h('div', { class: 'mapa' });
    const minhaGeracao = geracao;
    // Espera o elemento estar na página para o Leaflet medir o tamanho.
    requestAnimationFrame(() => {
      desenharMapa(area, gastos, { categoria: categoriaPorId, pessoa: (id) => nomeMembro(id) })
        .then((m) => { if (minhaGeracao === geracao) mapa = m; else m.remover(); })
        .catch((e) => {
          log.aviso('painel', 'Mapa não carregou', e);
          trocar(area, h('p', { class: 'vazio' }, 'O mapa precisa de internet.'));
        });
    });
    return secao('Mapa dos gastos', `${gastos.length} gasto(s) com localização — toque num ponto para ver`, area);
  }

  // ---- Tema claro/escuro mudou: redesenha com as cores novas -------------------------
  const esquema = matchMedia('(prefers-color-scheme: dark)');
  const aoMudarTema = () => desenhar();
  esquema.addEventListener('change', aoMudarTema);

  trocar(raiz, h('section', { class: 'tela' },
    h('div', { class: 'nav-mes' },
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      titulo,
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›')),
    seletorVisao.elemento,
    aviso,
    corpo));
  carregar();

  return () => { geracao++; limparGraficos(); esquema.removeEventListener('change', aoMudarTema); };
}
