/**
 * =============================================================================
 * js/log.js — Logs do aplicativo (RNF-41)
 * -----------------------------------------------------------------------------
 * Registra o que acontece no app (login, salvamentos, sincronização, erros)
 * para ajudar a descobrir problemas. Os registros:
 *   * aparecem no console do navegador (F12 no PC);
 *   * ficam guardados NESTE aparelho (últimos 500), em localStorage;
 *   * podem ser vistos/exportados em Mais → Diagnóstico.
 *
 * NUNCA registre senhas, tokens ou chaves. Os dados são reduzidos por
 * `limpar()` antes de gravar, por segurança.
 *
 * Uso:
 *   import { log } from './log.js';
 *   log.info('sync', 'Fila enviada', { enviados: 3 });
 *   log.aviso('geo', 'Permissão negada');
 *   log.erro('db', 'Falha ao salvar', erro);
 * =============================================================================
 */

const CHAVE = 'financas-logs';
const MAXIMO = 500;
const CAMPOS_PROIBIDOS = /senha|password|token|apikey|anon_?key|secret|authorization/i;

let registros = carregar();
const ouvintes = new Set();

function carregar() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
  } catch {
    return []; // modo privado / armazenamento bloqueado: segue só em memória
  }
}

function persistir() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(registros));
  } catch { /* sem espaço ou bloqueado: ignora, o log não pode derrubar o app */ }
}

/** Converte erros e objetos em algo gravável, removendo campos sensíveis. */
function limpar(dado, profundidade = 0) {
  if (dado == null || profundidade > 3) return dado ?? null;
  if (dado instanceof Error) return { erro: dado.name, mensagem: dado.message };
  if (typeof dado !== 'object') return dado;
  if (Array.isArray(dado)) return dado.slice(0, 20).map((d) => limpar(d, profundidade + 1));
  const saida = {};
  for (const [k, v] of Object.entries(dado)) {
    saida[k] = CAMPOS_PROIBIDOS.test(k) ? '***' : limpar(v, profundidade + 1);
  }
  return saida;
}

function registrar(nivel, modulo, mensagem, dados) {
  const item = { em: new Date().toISOString(), nivel, modulo, mensagem, dados: limpar(dados) };
  registros.push(item);
  if (registros.length > MAXIMO) registros = registros.slice(-MAXIMO);
  persistir();

  const metodo = nivel === 'erro' ? 'error' : nivel === 'aviso' ? 'warn' : 'log';
  console[metodo](`[${modulo}] ${mensagem}`, dados ?? '');
  ouvintes.forEach((fn) => fn(item));
}

export const log = {
  info: (modulo, mensagem, dados) => registrar('info', modulo, mensagem, dados),
  aviso: (modulo, mensagem, dados) => registrar('aviso', modulo, mensagem, dados),
  erro: (modulo, mensagem, dados) => registrar('erro', modulo, mensagem, dados),

  /** Cópia dos registros (mais recentes por último). */
  todos: () => [...registros],

  /** Apaga os registros deste aparelho. */
  limpar: () => { registros = []; persistir(); },

  /** Texto simples para exportar/copiar (Mais → Diagnóstico). */
  comoTexto: () => registros
    .map((r) => `${r.em} ${r.nivel.toUpperCase().padEnd(5)} [${r.modulo}] ${r.mensagem}` +
      (r.dados ? ` ${JSON.stringify(r.dados)}` : ''))
    .join('\n'),

  /** Recebe cada novo registro (a tela de diagnóstico usa para atualizar ao vivo). */
  ouvir: (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
};

// Erros não tratados também vão para o log.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log.erro('app', 'Erro não tratado', { mensagem: e.message, arquivo: e.filename, linha: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => log.erro('app', 'Promessa rejeitada', e.reason));
}
