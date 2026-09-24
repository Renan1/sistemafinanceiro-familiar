/**
 * =============================================================================
 * js/ui/novo-ganho.js — Tela "Novo ganho" (RF-20 a RF-22)
 * -----------------------------------------------------------------------------
 * Registra os GANHOS DO MÊS: salário, pró-labore, aluguel, freelance,
 * reembolso… São esses valores que, confrontados com os gastos, formam a
 * conciliação do Dashboard e alimentam a Saúde Financeira.
 *
 *   * Ganho VARIÁVEL (freelance, reembolso): lance aqui quando acontecer.
 *   * Ganho FIXO mensal (salário): pode lançar aqui todo mês, ou cadastrar
 *     uma vez como recorrência (Fase 3) para entrar sozinho.
 *
 * Mesmo fluxo do gasto: salva no aparelho primeiro, confirma e envia.
 *
 * MODO EDIÇÃO (Fase 3): aberta a partir de Lançamentos com um ganho
 * existente — "Salvar alterações" reenvia com o mesmo id; "Excluir" marca
 * como excluído. Funciona sem internet (passa pela fila).
 * =============================================================================
 */
import { h, trocar, avisar, vibrar, confirmar } from './dom.js';
import { teclado, mostradorValor, gradeCategorias, segmentado } from './componentes.js';
import { moeda, hojeSP } from '../formato.js';
import { validarGanho } from '../validacao.js';
import { enfileirar, listarFila, registrarUsoCategoria, novoId } from '../offline.js';
import { sincronizar } from '../sync.js';
import { log } from '../log.js';
import { estado, categoriasOrdenadas, categoriaPorId } from '../estado.js';

/** Categorias que normalmente são ganhos fixos: já sugerem "Fixo". */
const SUGERE_FIXO = /sal[aá]rio|pr[oó]-?labore|aluguel/i;

export function montarNovoGanho(raiz, { navegar, edicao = null } = {}) {
  const s = edicao
    ? { centavos: edicao.valor_centavos, categoriaId: edicao.categoria_id, natureza: edicao.natureza, data: edicao.data, descricao: edicao.descricao ?? '' }
    : { centavos: 0, categoriaId: null, natureza: 'variavel', data: hojeSP(), descricao: '' };

  /** Categorias de ganho; na edição inclui a original mesmo se desativada. */
  const listaCategorias = () => {
    const lista = categoriasOrdenadas('receita');
    const original = edicao && categoriaPorId(edicao.categoria_id);
    if (original && !lista.some((c) => c.id === original.id)) lista.unshift(original);
    return lista;
  };

  const mostrador = mostradorValor();
  mostrador.elemento.classList.add('ganho');
  const tec = teclado({ aoMudar: (c) => { s.centavos = c; mostrador.atualizar(c); } });

  const natureza = segmentado({
    rotulo: 'Natureza', valor: s.natureza,
    opcoes: [{ valor: 'variavel', rotulo: 'Variável' }, { valor: 'fixa', rotulo: 'Fixo' }],
    aoEscolher: (v) => { s.natureza = v; },
  });

  const grade = gradeCategorias({
    categorias: listaCategorias(),
    selecionada: s.categoriaId,
    aoEscolher: (id) => {
      s.categoriaId = id;
      // Salário/pró-labore/aluguel: sugere "Fixo" (pode trocar).
      const nova = SUGERE_FIXO.test(categoriaPorId(id)?.nome ?? '') ? 'fixa' : 'variavel';
      s.natureza = nova;
      natureza.definir(nova);
    },
  });

  const campoData = h('input', {
    type: 'date', class: 'campo-data', value: s.data, 'aria-label': 'Data do recebimento',
    onchange: (e) => { s.data = e.target.value || hojeSP(); },
  });
  const campoDescricao = h('input', {
    type: 'text', class: 'campo', placeholder: 'Descrição (opcional) — ex.: salário setembro',
    maxlength: '120', enterkeyhint: 'done', value: s.descricao, oninput: (e) => { s.descricao = e.target.value; },
  });

  const botaoSalvar = h('button', { type: 'button', class: 'btn btn-ganho btn-salvar', onclick: salvar },
    edicao ? 'Salvar alterações' : 'Salvar ganho');

  async function salvar() {
    const erros = validarGanho({ valorCentavos: s.centavos, categoriaId: s.categoriaId, data: s.data });
    if (erros.length) { vibrar(60); avisar(erros[0], { tipo: 'aviso' }); return; }

    botaoSalvar.disabled = true;
    const id = edicao?.id ?? novoId();
    const dados = {
      id,
      household_id: estado.perfil.household_id,
      user_id: estado.perfil.id,
      data: s.data,
      valor_centavos: s.centavos,
      categoria_id: s.categoriaId,
      descricao: s.descricao.trim() || null,
      natureza: s.natureza,
      origem: edicao?.origem ?? 'manual',
      recorrencia_id: edicao?.recorrencia_id ?? null,
      competencia_recorrencia: edicao?.competencia_recorrencia ?? null,
      observacao: edicao?.observacao ?? null,
    };

    try {
      await enfileirar({ tipo: 'receita', id, user_id: estado.perfil.id, dados });
    } catch (e) {
      log.erro('ganho', 'Falha ao guardar no aparelho', e);
      avisar('Não foi possível salvar neste aparelho. Tente de novo.', { tipo: 'erro' });
      botaoSalvar.disabled = false;
      return;
    }

    vibrar(15);
    log.info('ganho', edicao ? 'Ganho alterado' : 'Ganho salvo', { id, valor: s.centavos, natureza: s.natureza });
    if (edicao) {
      avisar('Alteração salva ✓', { tipo: 'ok' });
      sincronizar('editar');
      navegar('#/lancamentos');
      return;
    }
    const aviso = avisar(`Salvo ✓ ${moeda(s.centavos)} — enviando…`, { tipo: 'ok', duracao: 4000 });
    await registrarUsoCategoria(s.categoriaId);
    estado.usoCategorias[s.categoriaId] = (estado.usoCategorias[s.categoriaId] ?? 0) + 1;

    // Limpa para o próximo
    tec.definir(0);
    Object.assign(s, { categoriaId: null, natureza: 'variavel', data: hojeSP(), descricao: '' });
    campoDescricao.value = '';
    campoData.value = s.data;
    natureza.definir('variavel');
    grade.recarregar(categoriasOrdenadas('receita'));
    grade.selecionar(null);
    botaoSalvar.disabled = false;

    await sincronizar('salvar');
    const item = (await listarFila(estado.perfil.id)).find((i) => i.id === id);
    if (!item) aviso.atualizar('Salvo ✓ e sincronizado', 'ok');
    else if (item.estado === 'erro') aviso.atualizar(`Servidor recusou: ${item.ultimo_erro}`, 'erro');
    else aviso.atualizar('Salvo ✓ no aparelho — envia quando tiver sinal', 'ok');
  }

  async function excluir() {
    if (!await confirmar(`Excluir este ganho de ${moeda(edicao.valor_centavos)}?`, { sim: 'Excluir', perigoso: true })) return;
    await enfileirar({
      tipo: 'receita', id: edicao.id, user_id: estado.perfil.id,
      dados: { ...camposReceita(edicao), excluido_em: new Date().toISOString() },
    });
    log.info('ganho', 'Ganho excluído', { id: edicao.id });
    avisar('Ganho excluído ✓', { tipo: 'ok' });
    sincronizar('excluir');
    navegar('#/lancamentos');
  }

  trocar(raiz,
    h('section', { class: 'tela-lancamento' },
      h('div', { class: 'rolagem' },
        edicao ? h('div', { class: 'cabecalho-edicao' },
          h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/lancamentos') }, '‹ Lançamentos'),
          h('button', { type: 'button', class: 'link perigo', onclick: excluir }, 'Excluir')) : null,
        mostrador.elemento,
        h('h2', { class: 'rotulo' }, 'Tipo de ganho'),
        grade.elemento,
        h('div', { class: 'linha-detalhes' }, natureza.elemento, campoData),
        campoDescricao,
        edicao ? null : h('p', { class: 'dica' }, '💡 Ganho fixo todo mês (salário)? Cadastre uma vez em Mais → Recorrências e ele entra sozinho.'),
      ),
      h('div', { class: 'doca' }, tec.elemento, botaoSalvar),
    ));

  if (edicao) tec.definir(edicao.valor_centavos); // teclado começa no valor original

  return () => tec.elemento.desligar();
}

/** Só as colunas da tabela receitas (a lista traz outras). */
export function camposReceita(r) {
  const campos = ['id', 'household_id', 'user_id', 'data', 'valor_centavos', 'categoria_id', 'descricao',
    'natureza', 'recorrencia_id', 'competencia_recorrencia', 'origem', 'observacao'];
  return Object.fromEntries(campos.map((c) => [c, r[c] ?? null]));
}
