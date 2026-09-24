/**
 * =============================================================================
 * js/recorrencias.js — Geração automática dos gastos/ganhos fixos (RF-30/31)
 * -----------------------------------------------------------------------------
 * Uma recorrência é um gasto ou ganho que se repete todo mês (aluguel,
 * internet, salário…). Ao abrir o app COM INTERNET, esta rotina cria os
 * lançamentos que ainda não existem — do mês atual e de meses que ficaram
 * para trás (se o app ficou sem ser aberto) — sem nunca duplicar:
 *
 *   1. Consulta no Supabase quais meses JÁ foram gerados para cada
 *      recorrência (inclusive os que você excluiu — excluiu, não volta).
 *   2. Soma os que estão na fila do aparelho aguardando envio.
 *   3. Cria só os que faltam, com um id DETERMINÍSTICO (mesma recorrência +
 *      mesmo mês = sempre o mesmo id). Se dois aparelhos gerarem ao mesmo
 *      tempo, o banco recebe o mesmo id duas vezes e só atualiza (D-06).
 *   4. O banco ainda tem a trava final: índice único (recorrencia, mês).
 *
 * Só gera as recorrências do PRÓPRIO usuário (cada um gera as suas).
 * Sem internet, não gera (precisa saber o que já existe no servidor) — gera
 * na próxima abertura com sinal.
 *
 * As funções puras (competenciasDevidas, montarLancamento, idDeterministico)
 * são testadas em tests/js/recorrencias.test.js.
 * =============================================================================
 */
import { calcularParcelas } from './parcelas.js';
import { somarMesesCompetencia, competenciaDe } from './formato.js';

/** Quantos meses para trás, no máximo, a geração alcança (proteção). */
export const MAX_MESES_RETROATIVOS = 24;

/**
 * Meses (competências 'AAAA-MM-01') em que a recorrência deve ter lançamento,
 * do início até o mês atual (ou até o fim da recorrência).
 * Recorrência pausada (ativa = false) não gera nada.
 */
export function competenciasDevidas(rec, competenciaAtual) {
  if (!rec.ativa) return [];
  const limiteAntigo = somarMesesCompetencia(competenciaAtual, -(MAX_MESES_RETROATIVOS - 1));
  let mes = competenciaDe(rec.data_inicio);
  if (mes < limiteAntigo) mes = limiteAntigo;
  const ultimo = rec.data_fim && competenciaDe(rec.data_fim) < competenciaAtual
    ? competenciaDe(rec.data_fim)
    : competenciaAtual;

  const meses = [];
  while (mes <= ultimo) {
    meses.push(mes);
    mes = somarMesesCompetencia(mes, 1);
  }
  return meses;
}

/** Data do lançamento no mês: dia_do_mes, ajustado para meses curtos (31 → 30/28). */
export function dataNoMes(competencia, dia) {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia.slice(0, 8)}${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}

/**
 * Id fixo para (recorrência, mês): SHA-256 dos dois, no formato de UUID.
 * Mesma entrada → mesmo id, em qualquer aparelho.
 */
export async function idDeterministico(recorrenciaId, competencia) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${recorrenciaId}|${competencia}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // "versão 5" (baseado em nome)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Monta o lançamento de um mês, no formato da fila (js/offline.js).
 * @param {object} rec     recorrência (linha da tabela)
 * @param {string} competencia 'AAAA-MM-01'
 * @param {object} [cartao] obrigatório se for despesa no crédito
 * @param {string} id      de idDeterministico()
 * @returns {{tipo, id, user_id, dados, parcelas?}}
 */
export function montarLancamento(rec, competencia, cartao, id) {
  const data = dataNoMes(competencia, rec.dia_do_mes);
  const comum = {
    id,
    categoria_id: rec.categoria_id,
    descricao: rec.descricao,
    natureza: 'fixa',
    recorrencia_id: rec.id,
    competencia_recorrencia: competencia,
    origem: 'recorrencia',
  };

  if (rec.tipo === 'receita') {
    return {
      tipo: 'receita', id, user_id: rec.user_id,
      dados: { ...comum, household_id: rec.household_id, user_id: rec.user_id, data, valor_centavos: rec.valor_centavos },
    };
  }

  const parcelas = calcularParcelas({
    valorTotalCentavos: rec.valor_centavos, qtdParcelas: 1, dataCompra: data,
    formaPagamento: rec.forma_pagamento, cartao,
  });
  return {
    tipo: 'despesa', id, user_id: rec.user_id,
    dados: {
      ...comum, data_compra: data, valor_total_centavos: rec.valor_centavos,
      forma_pagamento: rec.forma_pagamento, cartao_id: rec.cartao_id ?? null, qtd_parcelas: 1,
    },
    parcelas,
  };
}

/**
 * Gera o que falta. Recebe as dependências por parâmetro para ser testável.
 * @param {object} p
 * @param {string} p.userId
 * @param {Array}  p.recorrencias       todas as da família (filtra as do usuário)
 * @param {Array}  p.cartoes
 * @param {string} p.competenciaAtual   'AAAA-MM-01'
 * @param {(ids:string[])=>Promise<Set<string>>} p.jaGeradasNoServidor  chaves "recId|AAAA-MM-01"
 * @param {Array}  p.fila               itens da fila do aparelho
 * @param {(item)=>Promise} p.enfileirar
 * @returns {Promise<number>} quantos lançamentos foram criados
 */
export async function gerarPendentes({ userId, recorrencias, cartoes, competenciaAtual, jaGeradasNoServidor, fila, enfileirar }) {
  const minhas = recorrencias.filter((r) => r.user_id === userId && r.ativa);
  if (minhas.length === 0) return 0;

  const existentes = await jaGeradasNoServidor(minhas.map((r) => r.id));
  for (const item of fila) {
    if (item.dados?.recorrencia_id) existentes.add(`${item.dados.recorrencia_id}|${item.dados.competencia_recorrencia}`);
  }

  let criados = 0;
  for (const rec of minhas) {
    const cartao = rec.cartao_id ? cartoes.find((c) => c.id === rec.cartao_id) : undefined;
    for (const competencia of competenciasDevidas(rec, competenciaAtual)) {
      if (existentes.has(`${rec.id}|${competencia}`)) continue;
      const id = await idDeterministico(rec.id, competencia);
      await enfileirar(montarLancamento(rec, competencia, cartao, id));
      existentes.add(`${rec.id}|${competencia}`);
      criados++;
    }
  }
  return criados;
}
