/**
 * =============================================================================
 * js/ui/categorias.js — Gerenciar categorias (RF-52, RF-53)
 * -----------------------------------------------------------------------------
 * Categorias são da FAMÍLIA: você e a Camilla podem criar, editar e excluir.
 *   * Criar: nome, tipo (gasto/ganho), ícone (emoji), cor e ordem.
 *   * Desativar: some das telas de lançamento, mas o histórico continua.
 *   * Excluir: se houver lançamentos usando, o app pergunta PARA QUAL
 *     categoria movê-los (função excluir_categoria no banco — D-13).
 * Precisa de internet.
 * =============================================================================
 */
import { h, trocar, avisar, confirmar, formularioDialogo } from './dom.js';
import { segmentado } from './componentes.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { estado, atualizarDoServidor, categoriasDoTipo } from '../estado.js';

/** Paleta sugerida (cores do iOS). */
const CORES = ['#34C759', '#30D158', '#FF9500', '#FF3B30', '#FF2D55', '#AF52DE', '#5856D6',
  '#007AFF', '#32ADE6', '#5AC8FA', '#FFCC00', '#A2845E', '#8E8E93'];

let tipoAtual = 'despesa';

export function montarCategorias(raiz, { navegar }) {
  const lista = h('div', { class: 'lista' });
  const formulario = h('div');
  const erroDe = (e) => (e.tipo === 'rede' ? 'Sem internet — categorias precisam de conexão.' : e.message);

  async function recarregar() {
    await atualizarDoServidor(estado.perfil.id);
    desenhar();
  }

  function desenhar() {
    const cats = categoriasDoTipo(tipoAtual);
    trocar(lista, cats.length ? cats.map((c) => h('div', {
      class: `item clicavel${c.ativa ? '' : ' arquivado'}`, onclick: () => editar(c),
    },
    h('span', { class: 'item-icone', style: { '--cor-cat': c.cor } }, c.icone),
    h('div', { class: 'item-texto' },
      h('strong', {}, c.nome, c.ativa ? null : h('span', { class: 'selo' }, 'desativada')),
      h('small', {}, `ordem ${c.ordem}`)),
    h('span', { class: 'item-seta' }, '›'))) : h('p', { class: 'vazio' }, 'Nenhuma categoria.'));
  }

  /** Campos comuns de criação/edição. */
  const camposCategoria = (c = {}) => [
    { nome: 'nome', rotulo: 'Nome', valor: c.nome ?? '', atributos: { maxlength: '40' } },
    { nome: 'icone', rotulo: 'Ícone (um emoji)', valor: c.icone ?? '📦', atributos: { maxlength: '16' } },
    { nome: 'cor', rotulo: 'Cor', tipo: 'select', valor: c.cor ?? CORES[0],
      opcoes: [...new Set([...(c.cor ? [c.cor] : []), ...CORES])].map((cor) => ({ valor: cor, rotulo: nomeCor(cor) })) },
    { nome: 'ordem', rotulo: 'Ordem (menor aparece primeiro)', tipo: 'number', valor: String(c.ordem ?? 100), atributos: { inputmode: 'numeric' } },
  ];
  const validar = (v) => (!v.nome.trim() ? 'Informe o nome.' : !v.icone.trim() ? 'Informe um emoji.' : null);

  async function editar(c) {
    const acao = await formularioDialogo({
      titulo: `${c.icone} ${c.nome}`, confirmar: 'Continuar',
      campos: [{ nome: 'acao', rotulo: 'O que deseja fazer?', tipo: 'select', opcoes: [
        { valor: 'editar', rotulo: '✏️ Editar nome, ícone, cor, ordem' },
        { valor: c.ativa ? 'desativar' : 'ativar', rotulo: c.ativa ? '🙈 Desativar (esconder nas telas)' : '👁 Reativar' },
        { valor: 'excluir', rotulo: '🗑 Excluir' },
      ] }],
    });
    if (!acao) return;
    try {
      if (acao.acao === 'editar') {
        const v = await formularioDialogo({ titulo: 'Editar categoria', campos: camposCategoria(c), validar });
        if (!v) return;
        await db.atualizarCategoria(c.id, { nome: v.nome.trim(), icone: v.icone.trim(), cor: v.cor, ordem: Number(v.ordem) || 100 });
      } else if (acao.acao === 'desativar' || acao.acao === 'ativar') {
        await db.atualizarCategoria(c.id, { ativa: acao.acao === 'ativar' });
      } else if (acao.acao === 'excluir') {
        if (!await excluir(c)) return;
      }
      log.info('categorias', `Categoria: ${acao.acao}`, { id: c.id });
      avisar('Pronto ✓', { tipo: 'ok' });
      await recarregar();
    } catch (e) {
      avisar(erroDe(e), { tipo: 'erro' });
    }
  }

  /** Tenta excluir; se estiver em uso, pergunta para onde mover. */
  async function excluir(c) {
    if (!await confirmar(`Excluir a categoria "${c.nome}"?`, { sim: 'Excluir', perigoso: true })) return false;
    try {
      await db.excluirCategoria(c.id);
      return true;
    } catch (e) {
      if (!/em uso/i.test(e.message)) throw e;
    }
    const outras = categoriasDoTipo(c.tipo).filter((o) => o.id !== c.id);
    const destino = await formularioDialogo({
      titulo: 'Categoria em uso',
      texto: `Existem lançamentos em "${c.nome}". Para onde movê-los? (Os de todos da família serão movidos.)`,
      confirmar: 'Mover e excluir', perigoso: true,
      campos: [{ nome: 'destino', rotulo: 'Mover para', tipo: 'select', valor: outras.find((o) => /outros/i.test(o.nome))?.id,
        opcoes: outras.map((o) => ({ valor: o.id, rotulo: `${o.icone} ${o.nome}` })) }],
    });
    if (!destino) return false;
    await db.excluirCategoria(c.id, destino.destino);
    return true;
  }

  function desenharFormulario() {
    trocar(formulario, h('button', {
      type: 'button', class: 'btn btn-primario',
      onclick: async () => {
        const v = await formularioDialogo({ titulo: `Nova categoria de ${tipoAtual === 'despesa' ? 'gasto' : 'ganho'}`, campos: camposCategoria(), validar });
        if (!v) return;
        try {
          await db.criarCategoria({ tipo: tipoAtual, nome: v.nome.trim(), icone: v.icone.trim(), cor: v.cor, ordem: Number(v.ordem) || 100 });
          log.info('categorias', 'Categoria criada', { nome: v.nome.trim() });
          avisar('Categoria criada ✓', { tipo: 'ok' });
          await recarregar();
        } catch (e) {
          avisar(/duplicate|uq_categorias/i.test(e.original ?? '') ? 'Já existe uma categoria com esse nome.' : erroDe(e), { tipo: 'erro' });
        }
      },
    }, '+ Nova categoria'));
  }

  const tipo = segmentado({
    rotulo: 'Tipo', valor: tipoAtual,
    opcoes: [{ valor: 'despesa', rotulo: 'Gastos' }, { valor: 'receita', rotulo: 'Ganhos' }],
    aoEscolher: (v) => { tipoAtual = v; desenhar(); },
  });

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    tipo.elemento, h('div', { style: { height: '10px' } }),
    lista,
    h('div', { style: { height: '12px' } }),
    formulario,
    h('p', { class: 'dica' }, 'Categorias valem para a família toda. Desativar esconde das telas sem mexer no histórico.')));
  desenhar();
  desenharFormulario();
}

function nomeCor(hex) {
  return ({
    '#34C759': '🟢 Verde', '#30D158': '🟢 Verde claro', '#FF9500': '🟠 Laranja', '#FF3B30': '🔴 Vermelho',
    '#FF2D55': '🩷 Rosa', '#AF52DE': '🟣 Roxo', '#5856D6': '🟣 Índigo', '#007AFF': '🔵 Azul', '#32ADE6': '🔵 Ciano',
    '#5AC8FA': '🔵 Azul claro', '#FFCC00': '🟡 Amarelo', '#A2845E': '🟤 Marrom', '#8E8E93': '⚪ Cinza',
  })[hex] ?? hex;
}
