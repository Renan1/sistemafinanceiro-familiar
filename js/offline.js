/**
 * =============================================================================
 * js/offline.js — Armazenamento local no aparelho (IndexedDB)
 * -----------------------------------------------------------------------------
 * Duas "gavetas" (object stores) no banco local 'financas-familia':
 *
 *   fila   Lançamentos que ainda NÃO chegaram ao Supabase. Todo gasto/ganho
 *          entra aqui PRIMEIRO (RNF-10) e só sai depois de confirmado pelo
 *          servidor (js/sync.js). Chave: "<tipo>:<id>" — se o mesmo
 *          lançamento for editado antes de sincronizar, a versão nova
 *          substitui a antiga (não gera dois envios).
 *
 *   cache  Cópia dos dados para o app abrir sem internet (RNF-13):
 *          perfil, membros, categorias, cartões, uso das categorias,
 *          últimos lançamentos e resumos do painel.
 *
 * O IndexedDB é do navegador, fica neste aparelho e sobrevive a fechar o app.
 * Ele NÃO é a fonte da verdade: o banco oficial é o Supabase (D-19).
 *
 * Estados de um item da fila:
 *   'pendente'  aguardando envio (sem sinal, sessão expirada, servidor fora…)
 *   'erro'      o servidor RECUSOU (dado inválido/sem permissão). Não é
 *               reenviado sozinho; aparece para o usuário decidir.
 * =============================================================================
 */
import { log } from './log.js';

const NOME_BANCO = 'financas-familia';
const VERSAO_BANCO = 1;

let conexao = null;
const ouvintesFila = new Set();

/** Abre (ou cria) o banco local. Reaproveita a conexão aberta. */
function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    // Roda só na primeira vez (ou quando VERSAO_BANCO aumentar).
    req.onupgradeneeded = () => {
      const bd = req.result;
      if (!bd.objectStoreNames.contains('fila')) {
        const fila = bd.createObjectStore('fila', { keyPath: 'chave' });
        fila.createIndex('por_usuario', 'user_id');
      }
      if (!bd.objectStoreNames.contains('cache')) {
        bd.createObjectStore('cache', { keyPath: 'chave' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      conexao = null;
      log.erro('offline', 'Não foi possível abrir o IndexedDB', req.error);
      reject(req.error);
    };
  });
  return conexao;
}

/** Executa uma operação numa store e devolve o resultado como Promise. */
async function operar(store, modo, fn) {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const tx = bd.transaction(store, modo);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Gera o id de um novo lançamento NO APARELHO (D-06).
 * crypto.randomUUID() existe no iOS 15.4+; para aparelhos mais antigos, monta
 * um UUID v4 com números aleatórios seguros (getRandomValues).
 */
export function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// =============================================================================
// FILA DE PENDENTES
// =============================================================================

/**
 * Coloca um lançamento na fila.
 * @param {object} item { tipo:'despesa'|'receita', id, user_id, dados, parcelas? }
 */
export async function enfileirar(item) {
  const agora = new Date().toISOString();
  const registro = {
    chave: `${item.tipo}:${item.id}`,
    estado: 'pendente',
    tentativas: 0,
    ultimo_erro: null,
    criado_em: agora,
    ...item,
    atualizado_em: agora,
  };
  await operar('fila', 'readwrite', (s) => s.put(registro));
  log.info('offline', `Lançamento guardado no aparelho (${item.tipo})`, { id: item.id });
  avisarFila();
  return registro;
}

/** Itens da fila de um usuário (mais antigos primeiro). */
export async function listarFila(userId) {
  const todos = await operar('fila', 'readonly', (s) => s.getAll());
  return (todos ?? [])
    .filter((i) => !userId || i.user_id === userId)
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}

/** Remove da fila (depois que o servidor confirmou). */
export async function removerDaFila(chave) {
  await operar('fila', 'readwrite', (s) => s.delete(chave));
  avisarFila();
}

/** Atualiza campos de um item da fila (tentativas, estado, erro). */
export async function atualizarItemFila(chave, mudancas) {
  const bd = await abrir();
  await new Promise((resolve, reject) => {
    const tx = bd.transaction('fila', 'readwrite');
    const s = tx.objectStore('fila');
    const req = s.get(chave);
    req.onsuccess = () => { if (req.result) s.put({ ...req.result, ...mudancas }); };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  avisarFila();
}

/** Contagem para o indicador "3 lançamentos aguardando sinal". */
export async function contarFila(userId) {
  const itens = await listarFila(userId);
  return {
    pendentes: itens.filter((i) => i.estado === 'pendente').length,
    comErro: itens.filter((i) => i.estado === 'erro').length,
  };
}

/** Recebe aviso sempre que a fila muda (para atualizar o indicador). */
export function ouvirFila(fn) {
  ouvintesFila.add(fn);
  return () => ouvintesFila.delete(fn);
}

function avisarFila() {
  ouvintesFila.forEach((fn) => { try { fn(); } catch (e) { log.erro('offline', 'Ouvinte da fila falhou', e); } });
}

// =============================================================================
// CACHE (dados para abrir sem internet)
// =============================================================================

/** Lê um valor do cache (ou `padrao` se não existir). */
export async function lerCache(chave, padrao = null) {
  try {
    const r = await operar('cache', 'readonly', (s) => s.get(chave));
    return r ? r.valor : padrao;
  } catch (e) {
    log.aviso('offline', `Cache indisponível (${chave})`, e);
    return padrao;
  }
}

/** Grava um valor no cache. */
export async function gravarCache(chave, valor) {
  await operar('cache', 'readwrite', (s) => s.put({ chave, valor, em: new Date().toISOString() }));
}

/**
 * Apaga o cache (ao sair da conta). A FILA É MANTIDA de propósito: se houver
 * lançamentos não enviados, eles esperam o mesmo usuário entrar de novo.
 */
export async function limparCache() {
  await operar('cache', 'readwrite', (s) => s.clear());
  log.info('offline', 'Cache local apagado');
}

// =============================================================================
// USO DAS CATEGORIAS ("mais usadas primeiro" na tela de novo gasto)
// =============================================================================

/** Soma 1 ao contador de uso da categoria. */
export async function registrarUsoCategoria(categoriaId) {
  const uso = await lerCache('uso_categorias', {});
  uso[categoriaId] = (uso[categoriaId] ?? 0) + 1;
  await gravarCache('uso_categorias', uso);
}
