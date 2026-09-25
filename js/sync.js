/**
 * =============================================================================
 * js/sync.js — Sincronização da fila com o Supabase (RNF-10 a RNF-12)
 * -----------------------------------------------------------------------------
 * Envia para o Supabase os lançamentos guardados no aparelho (js/offline.js).
 *
 * QUANDO roda (não depende de Background Sync, que o iPhone não tem):
 *   * ao abrir o app;
 *   * quando a internet volta (evento 'online');
 *   * quando o app volta para a tela (evento 'visibilitychange');
 *   * logo depois de cada Salvar;
 *   * pelo botão de sincronizar (indicador no topo).
 *
 * COMO é seguro reenviar:
 *   Cada lançamento tem um id gerado no aparelho (crypto.randomUUID()) e o
 *   servidor faz "upsert" por esse id. Se a conexão cair no meio e o app
 *   reenviar, o servidor só atualiza o mesmo registro — nunca duplica (D-06).
 *
 * O QUE acontece em cada tipo de falha:
 *   rede / servidor  → item continua 'pendente'; tenta de novo depois.
 *   sessão expirada  → para tudo, avisa "entre novamente"; a fila é MANTIDA.
 *   recusado         → item vira 'erro' (não fica tentando para sempre) e
 *                      aparece em Lançamentos com o motivo.
 * =============================================================================
 */
import { log } from './log.js';
import * as db from './db.js';
import { listarFila, removerDaFila, atualizarItemFila } from './offline.js';

/** Estado atual, lido pelo indicador da tela. */
export const estadoSync = {
  sincronizando: false,
  precisaLogin: false,
  ultimoSucesso: null,
  ultimoErro: null,
};

const ouvintes = new Set();
let execucaoAtual = null;
let userIdAtual = null;

/** Informa qual usuário está usando o app (só os itens dele são enviados). */
export function definirUsuario(userId) {
  userIdAtual = userId;
  estadoSync.precisaLogin = false;
}

/** Recebe aviso quando o estado da sincronização muda. */
export function ouvirSync(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((fn) => fn({ ...estadoSync }));
}

/**
 * Envia a fila. Se já estiver rodando, devolve a mesma execução (evita dois
 * envios simultâneos do mesmo item).
 * @param {string} motivo  só para o log ('abertura', 'online', 'manual'…)
 * @returns {Promise<{enviados:number, restantes:number}>}
 */
export function sincronizar(motivo = 'manual') {
  if (execucaoAtual) return execucaoAtual;
  execucaoAtual = executar(motivo).finally(() => {
    execucaoAtual = null;
    estadoSync.sincronizando = false;
    avisar();
  });
  return execucaoAtual;
}

async function executar(motivo) {
  if (!userIdAtual) return { enviados: 0, restantes: 0 };

  const itens = (await listarFila(userIdAtual)).filter((i) => i.estado === 'pendente');
  if (itens.length === 0) return { enviados: 0, restantes: 0 };

  if (!navigator.onLine) {
    log.info('sync', `Sem internet — ${itens.length} lançamento(s) aguardando sinal`, { motivo });
    return { enviados: 0, restantes: itens.length };
  }

  estadoSync.sincronizando = true;
  avisar();
  log.info('sync', `Enviando ${itens.length} lançamento(s)`, { motivo });

  try {
    await db.garantirSessao();
  } catch (e) {
    return pararPor(e, itens.length);
  }

  let enviados = 0;
  for (const item of itens) {
    try {
      if (item.tipo === 'despesa') {
        await db.salvarDespesa(item.dados, item.parcelas);
        // v1.2: gasto lançado da caixa de entrada (Carteira do iPhone) → marca o item.
        // Se falhar aqui, o item fica na fila e tudo é reenviado (os dois passos são idempotentes).
        if (item.caixaId) await db.marcarCaixa(item.caixaId, 'lancado', item.id);
      }
      else if (item.tipo === 'receita') await db.salvarReceita(item.dados);
      else throw Object.assign(new Error(`Tipo desconhecido: ${item.tipo}`), { tipo: 'recusado' });

      await removerDaFila(item.chave);
      enviados++;
    } catch (e) {
      if (e.tipo === 'recusado') {
        // O servidor disse "não": marcar para o usuário ver, e seguir com os outros.
        await atualizarItemFila(item.chave, { estado: 'erro', ultimo_erro: e.message, tentativas: item.tentativas + 1 });
        log.erro('sync', 'Servidor recusou um lançamento', { id: item.id, motivo: e.message });
        continue;
      }
      await atualizarItemFila(item.chave, { ultimo_erro: e.message, tentativas: item.tentativas + 1 });
      return pararPor(e, itens.length - enviados, enviados);
    }
  }

  estadoSync.ultimoSucesso = new Date().toISOString();
  estadoSync.ultimoErro = null;
  log.info('sync', `Sincronização concluída: ${enviados} enviado(s)`);
  return { enviados, restantes: 0 };
}

/** Interrompe o envio por falta de rede/sessão, mantendo a fila. */
function pararPor(erro, restantes, enviados = 0) {
  estadoSync.ultimoErro = erro.message;
  if (erro.tipo === 'sessao') {
    estadoSync.precisaLogin = true;
    log.aviso('sync', 'Login expirado — a fila foi mantida; entre novamente para enviar', { restantes });
  } else {
    log.aviso('sync', `Envio interrompido (${erro.tipo ?? 'erro'}): ${erro.message}`, { restantes });
  }
  return { enviados, restantes };
}

/** Recoloca um item com erro na fila de envio (botão "tentar de novo"). */
export async function tentarDeNovo(chave) {
  await atualizarItemFila(chave, { estado: 'pendente', ultimo_erro: null });
  return sincronizar('tentar-de-novo');
}

/**
 * Liga os gatilhos automáticos de sincronização. Chamado uma vez pelo app.js.
 */
export function ligarGatilhos() {
  window.addEventListener('online', () => {
    log.info('sync', 'Internet voltou');
    sincronizar('online');
  });
  window.addEventListener('offline', () => {
    log.info('sync', 'Sem internet');
    avisar();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizar('voltou-para-tela');
  });
}
