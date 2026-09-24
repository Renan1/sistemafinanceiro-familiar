/**
 * =============================================================================
 * js/estado.js — Dados compartilhados entre as telas
 * -----------------------------------------------------------------------------
 * Guarda em memória quem está logado e os cadastros (categorias, cartões,
 * membros da família). Carrega primeiro do aparelho (abre na hora, mesmo sem
 * internet) e depois atualiza do Supabase quando houver sinal.
 * =============================================================================
 */
import { log } from './log.js';
import * as db from './db.js';
import { lerCache } from './offline.js';

export const estado = {
  /** Perfil do usuário logado: { id, nome, household_id, cor_identificacao } */
  perfil: null,
  /** Membros da família (inclui o próprio). */
  membros: [],
  /** Categorias ativas (despesa e receita). */
  categorias: [],
  /** Cartões da família (ativos e arquivados). */
  cartoes: [],
  /** Contagem de uso por categoria, para ordenar "mais usadas primeiro". */
  usoCategorias: {},
  /** Recorrências (gastos/ganhos fixos) da família. */
  recorrencias: [],
};

const ouvintes = new Set();

/** Avisa quando os cadastros mudam (as telas se redesenham). */
export function ouvirEstado(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((fn) => fn(estado));
}

/** Carrega o que estiver guardado no aparelho. Devolve true se havia perfil. */
export async function carregarDoAparelho() {
  const [perfil, membros, categorias, cartoes, uso, recorrencias] = await Promise.all([
    lerCache('perfil'), lerCache('membros', []), lerCache('categorias', []),
    lerCache('cartoes', []), lerCache('uso_categorias', {}), lerCache('recorrencias', []),
  ]);
  Object.assign(estado, { perfil, membros, categorias, cartoes, usoCategorias: uso, recorrencias });
  avisar();
  return Boolean(perfil);
}

/** Atualiza do Supabase. Sem internet, mantém o que já tinha e só registra. */
export async function atualizarDoServidor(userId) {
  try {
    const dados = await db.carregarDadosBase(userId);
    Object.assign(estado, dados);
    estado.usoCategorias = await lerCache('uso_categorias', {});
    avisar();
    return true;
  } catch (e) {
    if (e.tipo === 'rede') log.info('estado', 'Sem internet: usando dados guardados no aparelho');
    else log.erro('estado', 'Não foi possível atualizar os dados', e);
    // Só "usuário sem família" impede o uso (a tela precisa explicar). Outras
    // falhas: segue com o que está guardado no aparelho.
    if (e.semFamilia) throw e;
    return false;
  }
}

/** Limpa a memória (ao sair da conta). */
export function limparEstado() {
  Object.assign(estado, { perfil: null, membros: [], categorias: [], cartoes: [], usoCategorias: {}, recorrencias: [] });
  avisar();
}

// ---- Atalhos usados pelas telas -------------------------------------------

/** Categorias de um tipo, das mais usadas para as menos usadas. */
export function categoriasOrdenadas(tipo) {
  const uso = estado.usoCategorias ?? {};
  return estado.categorias
    .filter((c) => c.tipo === tipo && c.ativa !== false)
    .sort((a, b) => (uso[b.id] ?? 0) - (uso[a.id] ?? 0) || a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

/** Cartões ativos: os do usuário primeiro, depois os dos outros membros. */
export function cartoesAtivos() {
  const meu = estado.perfil?.id;
  return estado.cartoes
    .filter((c) => c.ativo)
    .sort((a, b) => (a.user_id === meu ? 0 : 1) - (b.user_id === meu ? 0 : 1) || a.apelido.localeCompare(b.apelido));
}

/** Nome de um membro pelo id ('Eu' se for o próprio usuário). */
export function nomeMembro(userId, { eu = true } = {}) {
  if (eu && userId === estado.perfil?.id) return 'Eu';
  return estado.membros.find((m) => m.id === userId)?.nome ?? '—';
}

export const categoriaPorId = (id) => estado.categorias.find((c) => c.id === id);
export const cartaoPorId = (id) => estado.cartoes.find((c) => c.id === id);

/** Categorias de um tipo para gerenciar (inclui inativas), na ordem definida. */
export function categoriasDoTipo(tipo) {
  return estado.categorias.filter((c) => c.tipo === tipo)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

/** Membros da família: o usuário primeiro. */
export function membrosOrdenados() {
  const meu = estado.perfil?.id;
  return [...estado.membros].sort((a, b) => (a.id === meu ? -1 : b.id === meu ? 1 : a.nome.localeCompare(b.nome)));
}
