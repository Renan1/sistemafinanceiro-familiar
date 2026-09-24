/**
 * =============================================================================
 * js/saude.js — Roda o motor de regras e grava alertas e tarefas (RF-70)
 * -----------------------------------------------------------------------------
 * Quando roda:
 *   * ao abrir o app com internet (no máximo a cada 6 horas, mês atual);
 *   * ao abrir a aba Saúde e no botão "Reavaliar agora" (mês escolhido).
 *
 * O que faz:
 *   1. baixa os números (3 meses antes até 3 depois — js/db.js dadosRegras);
 *   2. avalia as regras (js/regras.js) para a FAMÍLIA e para CADA PESSOA;
 *   3. grava os alertas do mês de uma vez (RPC substituir_insights);
 *   4. cria as tarefas novas da visão família (sem duplicar regra aberta).
 * Precisa de internet (os números vêm do servidor).
 * =============================================================================
 */
import * as db from './db.js';
import { log } from './log.js';
import { montarContexto, avaliar, tarefasNovas } from './regras.js';
import { hojeSP, competenciaDe, somarMesesCompetencia } from './formato.js';
import { estado } from './estado.js';

const CHAVE_ULTIMA = 'financas-regras-ultima';
const INTERVALO_AUTOMATICO = 6 * 60 * 60 * 1000;

/**
 * Avalia o mês e grava. Devolve { alertas, tarefasCriadas }.
 * @param {string} competencia 'AAAA-MM-01'
 */
export async function reavaliar(competencia = competenciaDe(hojeSP())) {
  const dados = await db.dadosRegras(competencia, {
    inicio: somarMesesCompetencia(competencia, -3),
    fim: somarMesesCompetencia(competencia, 3),
  });
  const base = { competencia, hoje: hojeSP(), ...dados, recorrencias: estado.recorrencias, categorias: estado.categorias };

  const visoes = ['familia', ...estado.membros.map((m) => m.id)];
  const alertas = [];
  let daFamilia = [];
  for (const visao of visoes) {
    const resultado = avaliar(montarContexto({ ...base, visao }));
    if (visao === 'familia') daFamilia = resultado;
    for (const a of resultado) {
      alertas.push({
        regra_codigo: a.regra_codigo, severidade: a.severidade, mensagem: a.mensagem, dados: a.dados,
        user_id: visao === 'familia' ? null : visao,
      });
    }
  }
  await db.substituirInsights(competencia, alertas);

  // Tarefas: só do mês atual ou passado (mês futuro ainda pode mudar).
  let tarefasCriadas = 0;
  if (competencia <= competenciaDe(hojeSP())) {
    const novas = tarefasNovas(daFamilia, await db.listarTarefas());
    tarefasCriadas = await db.criarTarefas(novas);
  }
  log.info('saude', `Regras avaliadas: ${alertas.length} alerta(s), ${tarefasCriadas} tarefa(s) nova(s)`, { competencia });
  try { localStorage.setItem(CHAVE_ULTIMA, String(Date.now())); } catch { /* ignora */ }
  return { alertas, tarefasCriadas };
}

/** Versão automática (abertura do app): só com internet e se passou o intervalo. */
export async function reavaliarSeNecessario() {
  if (!navigator.onLine || !estado.perfil) return null;
  let ultima = 0;
  try { ultima = Number(localStorage.getItem(CHAVE_ULTIMA) ?? 0); } catch { /* ignora */ }
  if (Date.now() - ultima < INTERVALO_AUTOMATICO) return null;
  try {
    return await reavaliar();
  } catch (e) {
    log.aviso('saude', 'Não foi possível avaliar as regras agora', e);
    return null;
  }
}
