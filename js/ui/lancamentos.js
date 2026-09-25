/**
 * =============================================================================
 * js/ui/lancamentos.js — Lista de lançamentos do mês (RF-40, RF-41)
 * -----------------------------------------------------------------------------
 * Mostra gastos (pela DATA DA COMPRA) e ganhos do mês escolhido, da família
 * inteira, com:
 *   * filtros: pessoa, tipo (gastos/ganhos), categoria, forma de pagamento,
 *     fixo/variável — e busca por texto (descrição, categoria, local);
 *   * totais do que está filtrado;
 *   * toque num lançamento SEU → editar/excluir (os dos outros só aparecem).
 *
 * Junta duas fontes:
 *   1. o que está no Supabase (última cópia fica guardada para ver offline);
 *   2. a fila do aparelho (novos, edições e exclusões ainda não enviados) —
 *      a versão da fila tem prioridade, então uma edição feita sem sinal já
 *      aparece na lista, e uma exclusão já some.
 *
 * Observação: o Painel soma gastos pelo MÊS DA FATURA (competência); aqui a
 * lista é pela data da compra — uma compra 3x aparece uma vez, no mês em que
 * foi feita.
 * =============================================================================
 */
import { h, trocar, avisar, confirmar } from './dom.js';
import * as db from '../db.js';
import { listarFila, removerDaFila, ouvirFila, gravarCache, lerCache } from '../offline.js';
import { tentarDeNovo } from '../sync.js';
import { moeda, dataBR, mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia } from '../formato.js';
import { estado, categoriaPorId, nomeMembro, cartaoPorId, membrosOrdenados } from '../estado.js';

const ROTULO_FORMA = { pix: 'PIX', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', boleto: 'Boleto', outro: 'Outro' };

/** Filtros ficam guardados enquanto o app está aberto (voltar da edição mantém). */
const filtros = { competencia: null, pessoa: 'todos', tipo: 'todos', categoria: '', forma: '', natureza: '', busca: '' };

export function montarLancamentos(raiz, { editar }) {
  filtros.competencia ??= competenciaDe(hojeSP());
  let doServidor = { despesas: [], receitas: [] };
  let fila = [];
  let doCache = false;
  let carregando = true;

  const titulo = h('h2', { class: 'titulo-mes' });
  const areaFiltros = h('div', { class: 'filtros' });
  const areaTotais = h('div', { class: 'totais' });
  const areaPendentes = h('div');
  const areaLista = h('div', { class: 'lista' });
  const aviso = h('p', { class: 'dica' });

  const navMes = h('div', { class: 'nav-mes' },
    h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
    titulo,
    h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›'));

  function mudarMes(n) {
    filtros.competencia = somarMesesCompetencia(filtros.competencia, n);
    carregar();
  }

  // ---- Filtros ---------------------------------------------------------------
  function seletor(chave, rotuloTodos, opcoes) {
    return h('select', {
      class: `filtro${filtros[chave] ? ' ativo' : ''}`, 'aria-label': rotuloTodos,
      onchange: (e) => { filtros[chave] = e.target.value; desenharFiltros(); desenhar(); },
    }, h('option', { value: '' }, rotuloTodos),
    opcoes.map((o) => h('option', { value: o.valor, selected: filtros[chave] === o.valor }, o.rotulo)));
  }

  function desenharFiltros() {
    const pessoas = [{ valor: 'todos', rotulo: 'Todos' },
      ...membrosOrdenados().map((m) => ({ valor: m.id, rotulo: m.id === estado.perfil.id ? 'Eu' : m.nome }))];
    const tipos = [{ valor: 'todos', rotulo: 'Tudo' }, { valor: 'despesa', rotulo: 'Gastos' }, { valor: 'receita', rotulo: 'Ganhos' }];
    const chipsDe = (chave, opcoes) => opcoes.map((o) => h('button', {
      type: 'button', class: `filtro${filtros[chave] === o.valor ? ' ativo' : ''}`,
      onclick: () => { filtros[chave] = o.valor; desenharFiltros(); desenhar(); },
    }, o.rotulo));

    const categorias = estado.categorias
      .filter((c) => filtros.tipo === 'todos' || c.tipo === filtros.tipo)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((c) => ({ valor: c.id, rotulo: `${c.icone} ${c.nome}` }));

    const busca = h('input', {
      type: 'search', class: 'campo busca', placeholder: '🔎 Buscar (descrição, categoria, local)', value: filtros.busca,
      oninput: (e) => { filtros.busca = e.target.value; desenhar(); },
    });

    trocar(areaFiltros,
      busca,
      h('div', { class: 'filtros-linha' }, chipsDe('pessoa', pessoas)),
      h('div', { class: 'filtros-linha' },
        chipsDe('tipo', tipos),
        seletor('categoria', 'Categoria', categorias),
        seletor('forma', 'Pagamento', Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => ({ valor, rotulo }))),
        seletor('natureza', 'Fixo/Variável', [{ valor: 'fixa', rotulo: 'Fixo' }, { valor: 'variavel', rotulo: 'Variável' }])));
  }

  // ---- Dados -----------------------------------------------------------------
  async function carregar() {
    titulo.textContent = mesExtenso(filtros.competencia);
    const competencia = filtros.competencia;
    const chaveCache = `lancamentos:${competencia}`;
    carregando = true;
    fila = await listarFila(estado.perfil?.id);
    const guardado = await lerCache(chaveCache);
    doServidor = guardado ?? { despesas: [], receitas: [] };
    doCache = Boolean(guardado);
    desenhar();

    try {
      const dados = await db.listarLancamentosDoMes(competencia, somarMesesCompetencia(competencia, 1));
      if (competencia !== filtros.competencia) return; // usuário já trocou de mês
      await gravarCache(chaveCache, dados);
      doServidor = dados;
      doCache = false;
      aviso.textContent = '';
    } catch (e) {
      aviso.textContent = e.tipo === 'rede'
        ? (guardado ? 'Sem internet — mostrando a última cópia guardada.' : 'Sem internet — conecte-se para ver os lançamentos deste mês.')
        : e.message;
    }
    carregando = false;
    desenhar();
  }

  /** Junta servidor + fila (a fila vence) e aplica os filtros. */
  function itensDoMes() {
    const mes = filtros.competencia.slice(0, 7);
    const mapa = new Map();
    for (const d of doServidor.despesas) mapa.set(d.id, { tipo: 'despesa', registro: d, pendente: null });
    for (const r of doServidor.receitas) mapa.set(r.id, { tipo: 'receita', registro: r, pendente: null });
    for (const f of fila) {
      const data = f.dados.data_compra ?? f.dados.data;
      const anterior = mapa.get(f.id);
      if (!anterior && data?.slice(0, 7) !== mes) continue;
      mapa.set(f.id, { tipo: f.tipo, registro: { ...(anterior?.registro ?? {}), ...f.dados, user_id: f.user_id }, pendente: f });
    }
    return [...mapa.values()]
      .filter((i) => !i.registro.excluido_em || i.pendente?.estado === 'erro')
      .filter((i) => (i.registro.data_compra ?? i.registro.data)?.slice(0, 7) === mes);
  }

  function passaNosFiltros(i) {
    const r = i.registro;
    const cat = categoriaPorId(r.categoria_id);
    if (filtros.pessoa !== 'todos' && r.user_id !== filtros.pessoa) return false;
    if (filtros.tipo !== 'todos' && i.tipo !== filtros.tipo) return false;
    if (filtros.categoria && r.categoria_id !== filtros.categoria) return false;
    if (filtros.forma && (i.tipo !== 'despesa' || r.forma_pagamento !== filtros.forma)) return false;
    if (filtros.natureza && r.natureza !== filtros.natureza) return false;
    if (filtros.busca.trim()) {
      const texto = [r.descricao, cat?.nome, r.local_nome, r.observacao].filter(Boolean).join(' ').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      const termo = filtros.busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (!texto.includes(termo)) return false;
    }
    return true;
  }

  // ---- Desenho -----------------------------------------------------------------
  function desenhar() {
    const todos = itensDoMes();
    const itens = todos.filter(passaNosFiltros)
      .sort((a, b) => (b.registro.data_compra ?? b.registro.data).localeCompare(a.registro.data_compra ?? a.registro.data));

    const soma = (tipo) => itens.filter((i) => i.tipo === tipo)
      .reduce((s, i) => s + (i.registro.valor_total_centavos ?? i.registro.valor_centavos ?? 0), 0);
    trocar(areaTotais,
      h('span', {}, 'Gastos', h('strong', {}, moeda(soma('despesa')))),
      h('span', {}, 'Ganhos', h('strong', { class: 'positivo' }, moeda(soma('receita')))),
      h('span', {}, 'Lançamentos', h('strong', {}, String(itens.length))));

    // Recusados pelo servidor ficam em destaque, com ações.
    const recusados = fila.filter((f) => f.estado === 'erro');
    trocar(areaPendentes, recusados.length ? [
      h('h3', { class: 'rotulo' }, `Recusados pelo servidor (${recusados.length})`),
      h('div', { class: 'lista' }, recusados.map(linhaRecusada)),
    ] : null);

    if (itens.length === 0) {
      trocar(areaLista, h('p', { class: 'vazio' }, carregando && !doCache ? 'Carregando…' : 'Nenhum lançamento encontrado.'));
      return;
    }
    trocar(areaLista, itens.map(linha));
  }

  function linha(i) {
    const r = i.registro;
    const cat = categoriaPorId(r.categoria_id);
    const meu = r.user_id === estado.perfil.id;
    const valor = r.valor_total_centavos ?? r.valor_centavos;
    const detalhes = [dataBR(r.data_compra ?? r.data), nomeMembro(r.user_id)];
    if (i.tipo === 'despesa') {
      detalhes.push(ROTULO_FORMA[r.forma_pagamento] ?? r.forma_pagamento);
      if (r.forma_pagamento === 'credito') {
        const cartao = cartaoPorId(r.cartao_id);
        if (cartao) detalhes.push(cartao.apelido);
        if (r.qtd_parcelas > 1) detalhes.push(`${r.qtd_parcelas}x`);
        // v1.1: compra com juros informada → "juros R$ 278,80"
        if (r.valor_a_vista_centavos && r.valor_total_centavos > r.valor_a_vista_centavos) {
          detalhes.push(`juros ${moeda(r.valor_total_centavos - r.valor_a_vista_centavos)}`);
        }
      }
      if (r.latitude != null) detalhes.push('📍');
    }
    if (r.natureza === 'fixa') detalhes.push(r.recorrencia_id ? '🔁 fixo' : 'fixo');
    if (i.pendente) detalhes.push('⏳ aguardando envio');

    return h('div', {
      class: `item${meu ? ' clicavel' : ''}${i.pendente ? ' pendente' : ''}`,
      role: meu ? 'button' : null,
      tabindex: meu ? '0' : null,
      onclick: () => (meu ? editar(i.tipo, r) : avisar(`Só ${nomeMembro(r.user_id, { eu: false })} pode alterar este lançamento.`)),
    },
    h('span', { class: 'item-icone', style: { '--cor-cat': cat?.cor ?? '#8E8E93' } }, cat?.icone ?? '•'),
    h('div', { class: 'item-texto' },
      h('strong', {}, r.descricao || cat?.nome || '—'),
      h('small', {}, detalhes.join(' · '))),
    h('span', { class: `item-valor ${i.tipo === 'receita' ? 'positivo' : ''}` }, `${i.tipo === 'receita' ? '+' : '−'} ${moeda(valor)}`),
    meu ? h('span', { class: 'item-seta' }, '›') : null);
  }

  function linhaRecusada(item) {
    const d = item.dados;
    return h('div', { class: 'item com-erro' },
      h('span', { class: 'item-icone' }, '⚠️'),
      h('div', { class: 'item-texto' },
        h('strong', {}, `${d.descricao || categoriaPorId(d.categoria_id)?.nome || '—'} · ${moeda(d.valor_total_centavos ?? d.valor_centavos)}`),
        h('small', {}, `Recusado: ${item.ultimo_erro}`),
        h('div', { class: 'item-acoes' },
          h('button', { type: 'button', class: 'link', onclick: () => tentarDeNovo(item.chave) }, 'Tentar de novo'),
          h('button', {
            type: 'button', class: 'link perigo',
            onclick: async () => {
              if (await confirmar('Descartar? Este lançamento não foi enviado e será apagado deste aparelho.', { sim: 'Descartar', perigoso: true })) {
                await removerDaFila(item.chave);
              }
            },
          }, 'Descartar'))));
  }

  trocar(raiz, h('section', { class: 'tela' },
    navMes, areaFiltros, areaTotais, aviso, areaPendentes, areaLista,
    h('p', { class: 'dica' }, 'Toque num lançamento seu para editar ou excluir. Gastos aparecem no mês da compra; o Painel soma pelo mês da fatura.')));

  desenharFiltros();
  carregar();
  // Fila mudou (enviou, editou): recarrega.
  return ouvirFila(() => carregar());
}
