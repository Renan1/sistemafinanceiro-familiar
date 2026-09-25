/**
 * =============================================================================
 * js/ui/importar.js — Mais → Importar extrato / fatura (v1.3 — RF-17)
 * -----------------------------------------------------------------------------
 *   1. Escolher o arquivo (fatura Nubank .csv, fatura Itaú .xlsx, extrato Itaú
 *      .xls ou OFX). Ele é lido NO APARELHO — não é enviado a lugar nenhum.
 *   2. Conferir a prévia: cada linha aparece como
 *        ✅ para importar · 🟰 parece já lançado · ⏭️ ignorado · ✔️ já importado,
 *      com a categoria sugerida (trocar uma troca todas as linhas iguais).
 *   3. "Importar N lançamentos": vão pela mesma fila dos lançamentos
 *      digitados (funcionam sem internet até enviar) e as categorias
 *      trocadas viram regras aprendidas para a próxima importação.
 *
 * Lógica (ler, classificar, achar duplicados): js/importacao.js.
 * Planilhas: js/libs.js → lerPlanilha() (worker isolado).
 * =============================================================================
 */
import { h, trocar, avisar } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { enfileirar } from '../offline.js';
import { sincronizar } from '../sync.js';
import { lerPlanilha } from '../libs.js';
import { moeda, dataBR } from '../formato.js';
import { estado, cartoesAtivos } from '../estado.js';
import {
  lerArquivo, analisar, montarLancamento, regrasAprendidas, resumo, sugerirCartao, chaveComerciante,
} from '../importacao.js';

const SITUACOES = {
  novo: { rotulo: 'Para importar', icone: '✅' },
  provavel_duplicado: { rotulo: 'Parece já lançado', icone: '🟰' },
  ignorado: { rotulo: 'Ignorados', icone: '⏭️' },
  ja_importado: { rotulo: 'Já importados', icone: '✔️' },
};
const FORMA = { pix: 'PIX', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', dinheiro: 'Dinheiro', outro: 'Outro' };

export function montarImportar(raiz, { navegar }) {
  let arquivo = null;      // resultado de lerArquivo()
  let itens = [];          // resultado de analisar()
  let regras = [];
  let filtro = 'novo';
  let cartaoId = null;
  let competencia = null;  // 'AAAA-MM-01' (fatura)

  const areaPrevia = h('div');
  const barra = h('div', { class: 'barra-importar', hidden: true });

  // ---- 1. Escolher o arquivo ------------------------------------------------
  const entrada = h('input', {
    type: 'file', accept: '.csv,.xls,.xlsx,.ofx,.txt', class: 'campo-arquivo', 'aria-label': 'Arquivo do banco',
    onchange: (e) => e.target.files[0] && abrir(e.target.files[0]),
  });

  async function abrir(file) {
    trocar(areaPrevia, h('p', { class: 'dica' }, `Lendo ${file.name}…`));
    barra.hidden = true;
    try {
      const planilha = /\.xlsx?$/i.test(file.name);
      const conteudo = planilha ? { abas: await lerPlanilha(await file.arrayBuffer()) } : { texto: await file.text() };
      arquivo = lerArquivo(file.name, conteudo);
      if (!arquivo.linhas.length) throw new Error('Nenhum lançamento encontrado no arquivo.');
      log.info('importar', 'Arquivo lido', { formato: arquivo.formato, linhas: arquivo.linhas.length });
      if (arquivo.tipo === 'cartao') {
        cartaoId = sugerirCartao(arquivo, cartoesAtivos(), estado.perfil.id)?.id ?? null;
        competencia = arquivo.vencimento ? `${arquivo.vencimento.slice(0, 7)}-01` : null;
      }
      try { regras = await db.listarRegrasCategoria(); } catch (e) { regras = []; log.aviso('importar', 'Regras aprendidas indisponíveis', e); }
      await reanalisar();
    } catch (e) {
      log.aviso('importar', 'Falha ao ler o arquivo', e);
      arquivo = null;
      trocar(areaPrevia, h('p', { class: 'alerta-inline' }, e.message));
    }
  }

  /** Busca o que já existe no período e monta a prévia. */
  async function reanalisar() {
    const cartao = cartoesAtivos().find((c) => c.id === cartaoId) ?? null;
    if (arquivo.tipo === 'cartao' && (!cartao || !competencia)) { desenhar(); return; }
    if (!navigator.onLine) {
      trocar(areaPrevia, h('p', { class: 'alerta-inline' }, 'Sem internet: para conferir o que já está no app, a importação precisa de sinal.'));
      return;
    }
    trocar(areaPrevia, h('p', { class: 'dica' }, 'Conferindo com o que já está no app…'));
    const datas = arquivo.linhas.map((l) => l.data).sort();
    const margem = (iso, dias) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
    try {
      // 1ª passada sem "existentes" só para saber os ids das linhas.
      const provisorio = await analisar({ arquivo, userId: estado.perfil.id, cartao, competencia, categorias: estado.categorias, regras });
      const existentes = await db.dadosDeduplicacao({
        userId: estado.perfil.id, inicio: margem(datas[0], -7), fim: margem(datas.at(-1), 7),
        cartaoId: cartao?.id ?? null, competencia, ids: provisorio.map((i) => i.id),
      });
      itens = await analisar({ arquivo, userId: estado.perfil.id, cartao, competencia, categorias: estado.categorias, regras, existentes });
      filtro = itens.some((i) => i.situacao === 'novo') ? 'novo' : 'ignorado';
      desenhar();
    } catch (e) {
      log.aviso('importar', 'Falha ao analisar', e);
      trocar(areaPrevia, h('p', { class: 'alerta-inline' }, e.message));
    }
  }

  // ---- 2. Prévia ---------------------------------------------------------------
  function cabecalhoArquivo() {
    const datas = arquivo.linhas.map((l) => l.data).sort();
    const partes = [h('h3', { class: 'secao-titulo' }, `📄 ${arquivo.titulo}`),
      h('p', { class: 'secao-sub' }, `${arquivo.linhas.length} linha(s) · ${dataBR(datas[0])} a ${dataBR(datas.at(-1))}`)];
    if (arquivo.tipo === 'cartao') {
      const cartoes = cartoesAtivos().filter((c) => c.user_id === estado.perfil.id);
      partes.push(
        h('label', { class: 'campo-rotulo' }, h('span', {}, 'Cartão desta fatura'),
          h('select', { class: 'campo', 'aria-label': 'Cartão', onchange: (e) => { cartaoId = e.target.value || null; reanalisar(); } },
            h('option', { value: '' }, cartoes.length ? 'Escolha o cartão…' : 'Cadastre o cartão em Mais → Cartões'),
            cartoes.map((c) => h('option', { value: c.id, selected: c.id === cartaoId }, `${c.apelido} ••${c.ultimos4}`)))),
        h('label', { class: 'campo-rotulo' }, h('span', {}, 'Mês da fatura (vencimento)'),
          h('input', { type: 'month', class: 'campo', 'aria-label': 'Mês da fatura', value: competencia?.slice(0, 7) ?? '',
            onchange: (e) => { competencia = e.target.value ? `${e.target.value}-01` : null; reanalisar(); } })),
        h('p', { class: 'dica' }, 'As compras entram no mês desta fatura; "Parcela 3/10" entra com as parcelas 3 a 10 nos meses seguintes.'));
    }
    return h('div', { class: 'secao' }, partes);
  }

  function desenhar() {
    if (!arquivo) return;
    if (arquivo.tipo === 'cartao' && (!cartaoId || !competencia)) {
      trocar(areaPrevia, cabecalhoArquivo(), h('p', { class: 'dica' }, 'Escolha o cartão e o mês da fatura para ver a prévia.'));
      barra.hidden = true;
      return;
    }
    const contagem = itens.reduce((a, i) => ({ ...a, [i.situacao]: (a[i.situacao] ?? 0) + 1 }), {});
    const abas = h('div', { class: 'chips rolavel', role: 'tablist' }, Object.entries(SITUACOES).map(([k, s]) =>
      h('button', { type: 'button', class: `chip${filtro === k ? ' ativo' : ''}`, role: 'tab', 'aria-selected': String(filtro === k),
        onclick: () => { filtro = k; desenhar(); } }, `${s.icone} ${s.rotulo} (${contagem[k] ?? 0})`)));
    const visiveis = itens.filter((i) => i.situacao === filtro);
    trocar(areaPrevia,
      cabecalhoArquivo(),
      abas,
      filtro !== 'novo' && visiveis.length ? h('p', { class: 'dica' }, 'Marque uma linha para importá-la mesmo assim.') : null,
      h('div', { class: 'lista lista-importar' }, visiveis.length ? visiveis.map(linhaItem) : h('p', { class: 'vazio' }, 'Nada aqui.')));
    atualizarBarra();
  }

  function linhaItem(item) {
    const doTipo = estado.categorias.filter((c) => c.tipo === item.tipo && c.ativa !== false);
    const detalhes = [dataBR(item.data)];
    if (item.forma) detalhes.push(FORMA[item.forma] ?? item.forma);
    if (item.parcela) detalhes.push(`parcela ${item.parcela.k}/${item.parcela.n}${item.parcelas.length > 1 ? ` → ${item.parcelas.length} meses` : ''}`);
    if (item.linha.extra && !/^\*+\d+$/.test(item.linha.extra)) detalhes.push(item.linha.extra.replace(/\s+/g, ' ').slice(0, 40));
    const categoria = h('select', {
      class: 'campo campo-categoria', 'aria-label': `Categoria de ${item.descricao}`,
      onchange: (e) => trocarCategoria(item, e.target.value),
    }, doTipo.map((c) => h('option', { value: c.id, selected: c.id === item.categoriaId }, `${c.icone ?? ''} ${c.nome}`.trim())));
    return h('div', { class: `item item-importar${item.selecionado ? '' : ' desmarcado'}` },
      h('input', { type: 'checkbox', class: 'marcar', checked: item.selecionado, 'aria-label': `Importar ${item.descricao}`,
        onchange: (e) => { item.selecionado = e.target.checked; desenhar(); } }),
      h('div', { class: 'item-texto' },
        h('strong', {}, item.descricao),
        h('small', {}, detalhes.join(' · ')),
        item.motivo ? h('small', { class: 'motivo' }, item.motivo) : null,
        item.aviso ? h('small', { class: 'motivo' }, `⚠️ ${item.aviso}`) : null,
        categoria),
      h('strong', { class: `item-valor${item.tipo === 'receita' ? ' positivo' : ''}` },
        `${item.tipo === 'receita' ? '+' : '−'} ${moeda(item.valor)}${item.parcelas.length > 1 ? '/mês' : ''}`));
  }

  /** Troca a categoria desta linha e das linhas do MESMO lugar ainda não mexidas. */
  function trocarCategoria(item, categoriaId) {
    const chave = chaveComerciante(item.linha.descricao);
    for (const outro of itens) {
      if (outro === item || (outro.tipo === item.tipo && !outro.categoriaEditada && chaveComerciante(outro.linha.descricao) === chave)) {
        outro.categoriaId = categoriaId;
        outro.categoriaEditada = outro === item || outro.categoriaEditada;
      }
    }
    desenhar();
  }

  function atualizarBarra() {
    const r = resumo(itens);
    barra.hidden = false;
    trocar(barra,
      h('div', { class: 'barra-importar-texto' },
        h('strong', {}, `${r.selecionados} lançamento(s)`),
        h('small', {}, [r.gastos ? `gastos ${moeda(r.gastos)}` : null, r.ganhos ? `ganhos ${moeda(r.ganhos)}` : null].filter(Boolean).join(' · ') || 'nada marcado')),
      h('button', { type: 'button', class: 'btn btn-primario', disabled: !r.selecionados, onclick: importar }, 'Importar'));
  }

  // ---- 3. Importar ---------------------------------------------------------
  async function importar(e) {
    const botao = e.currentTarget;
    const cartao = cartoesAtivos().find((c) => c.id === cartaoId) ?? null;
    const escolhidos = itens.filter((i) => i.selecionado && i.categoriaId);
    if (!escolhidos.length) return;
    botao.disabled = true;
    botao.textContent = 'Importando…';
    try {
      for (const item of escolhidos) {
        await enfileirar(montarLancamento(item, { arquivo, perfil: estado.perfil, cartao }));
      }
      log.info('importar', 'Lançamentos importados', { formato: arquivo.formato, qtd: escolhidos.length });
      const novasRegras = regrasAprendidas(itens);
      if (novasRegras.length) {
        db.salvarRegrasCategoria(novasRegras, estado.perfil.household_id)
          .catch((err) => log.aviso('importar', 'Não foi possível guardar as regras aprendidas', err));
      }
      const { restantes } = await sincronizar('importacao');
      const r = resumo(itens);
      arquivo = null;
      itens = [];
      entrada.value = '';
      barra.hidden = true;
      trocar(areaPrevia, h('div', { class: 'secao destaque' },
        h('h3', { class: 'secao-titulo' }, `✓ ${escolhidos.length} lançamento(s) importado(s)`),
        h('p', { class: 'secao-sub' }, [r.gastos ? `Gastos ${moeda(r.gastos)}` : null, r.ganhos ? `ganhos ${moeda(r.ganhos)}` : null].filter(Boolean).join(' · ')),
        restantes ? h('p', { class: 'dica' }, `⏳ ${restantes} aguardando envio (vão sozinhos quando houver sinal).`) : null,
        novasRegras.length ? h('p', { class: 'dica' }, `🧠 ${novasRegras.length} categoria(s) aprendida(s) para as próximas importações.`) : null,
        h('div', { class: 'linha-botoes' },
          h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => navegar('#/lancamentos') }, 'Ver lançamentos'),
          h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => navegar('#/painel') }, 'Ver painel'))));
      avisar(`Importado ✓ ${escolhidos.length} lançamento(s)`, { tipo: 'ok' });
    } catch (err) {
      log.erro('importar', 'Falha ao importar', err);
      avisar(`Não foi possível importar: ${err.message}`, { tipo: 'erro' });
      botao.disabled = false;
      botao.textContent = 'Importar';
    }
  }

  trocar(raiz, h('section', { class: 'tela tela-importar' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '📥 Importar extrato ou fatura'),
      h('p', { class: 'secao-sub' }, 'O arquivo é lido neste aparelho e não é enviado a lugar nenhum. Você confere tudo antes de gravar; nada é duplicado.'),
      entrada,
      h('details', { class: 'mais-detalhes' },
        h('summary', {}, 'Quais arquivos? Onde exportar?'),
        h('ul', { class: 'passos' },
          h('li', {}, h('strong', {}, 'Nubank — fatura (.csv): '), 'app → Cartão → Faturas → escolher a fatura → Exportar (chega por e-mail).'),
          h('li', {}, h('strong', {}, 'Itaú — fatura (.xlsx): '), 'site do Itaú → Cartões → Fatura → Salvar em Excel.'),
          h('li', {}, h('strong', {}, 'Itaú — extrato da conta (.xls): '), 'site do Itaú → Extrato → escolha o período → Salvar em Excel.'),
          h('li', {}, h('strong', {}, 'Outros bancos: '), 'extrato em OFX.')),
        h('p', { class: 'dica' }, 'Pagamento de fatura, aplicação/resgate e estornos não viram gasto. Dica: importe cada fatura quando ela fechar e o extrato da conta uma vez por mês.'))),
    areaPrevia,
    barra));
}
