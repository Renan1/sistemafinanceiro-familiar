/**
 * =============================================================================
 * js/dashboard.js — Cálculos do Painel (RF-60 a RF-62, RN-01, RN-02)
 * -----------------------------------------------------------------------------
 * Funções PURAS: recebem os dados já baixados do Supabase e devolvem os
 * números de cada bloco do Painel. Não desenham nada (isso é js/ui/painel.js)
 * e não acessam rede — por isso são testadas em tests/js/dashboard.test.js.
 *
 * "Visão" (filtro do topo do Painel):
 *   'familia'  → soma de todos os membros;
 *   <user_id>  → só aquela pessoa.
 *
 * Fontes (views do sql/001_schema.sql):
 *   linhasResumo  vw_resumo_mensal     (user_id NULL = linha da família)
 *   parcelas      vw_parcelas_detalhe  (uma linha por parcela, por pessoa)
 *
 * Gastos são contados pela COMPETÊNCIA da parcela (mês da fatura), não pela
 * data da compra (RN-02).
 * =============================================================================
 */
import { somarMesesCompetencia, competenciaDe } from './formato.js';

/** Quantas fatias no gráfico de categorias antes de juntar o resto em "Outras". */
export const MAX_FATIAS = 5;

/** Limites de alerta do orçamento (os mesmos do motor de regras da Fase 5). */
export const LIMITES_ORCAMENTO = { atencao: 0.8, estourado: 1.0 };

/** A linha pertence à visão escolhida? */
export const naVisao = (visao) => (linha) => visao === 'familia' || linha.user_id === visao;

/** Linha de resumo (vw_resumo_mensal) da visão no mês, ou zeros. */
export function resumoDoMes(linhasResumo, visao, competencia) {
  const alvo = visao === 'familia' ? null : visao;
  const linha = linhasResumo.find((l) => l.competencia === competencia && (l.user_id ?? null) === alvo);
  return {
    receitas: linha?.receitas_centavos ?? 0,
    despesas: linha?.despesas_centavos ?? 0,
    fixas: linha?.despesas_fixas_centavos ?? 0,
    variaveis: linha?.despesas_variaveis_centavos ?? 0,
    cartao: linha?.despesas_cartao_centavos ?? 0,
    saldo: (linha?.receitas_centavos ?? 0) - (linha?.despesas_centavos ?? 0),
    taxaPoupanca: linha?.taxa_poupanca_pct ?? null,
    fixosSobreRenda: linha?.fixos_sobre_renda_pct ?? null,
  };
}

/** Lista de competências: `n` meses terminando em `ultima` (inclusive). */
export function mesesAte(ultima, n) {
  return Array.from({ length: n }, (_, i) => somarMesesCompetencia(ultima, i - n + 1));
}

/** Ganhos × gastos mês a mês (gráfico de 12 meses). Meses sem dados = 0. */
export function serieMensal(linhasResumo, visao, competenciaFinal, n = 12) {
  return mesesAte(competenciaFinal, n).map((competencia) => {
    const r = resumoDoMes(linhasResumo, visao, competencia);
    return { competencia, receitas: r.receitas, despesas: r.despesas, fixas: r.fixas, variaveis: r.variaveis };
  });
}

/**
 * Gastos do mês por categoria, do maior para o menor. As menores além de
 * MAX_FATIAS viram uma fatia "Outras" (gráfico legível — nunca 15 fatias).
 */
export function porCategoria(parcelas, visao, competencia, maxFatias = MAX_FATIAS) {
  const somas = new Map();
  for (const p of parcelas.filter(naVisao(visao))) {
    if (p.competencia !== competencia) continue;
    const atual = somas.get(p.categoria_id) ?? {
      categoria_id: p.categoria_id, nome: p.categoria_nome, icone: p.categoria_icone, cor: p.categoria_cor, total: 0,
    };
    atual.total += p.valor_centavos;
    somas.set(p.categoria_id, atual);
  }
  const ordenadas = [...somas.values()].sort((a, b) => b.total - a.total);
  const total = ordenadas.reduce((s, c) => s + c.total, 0);
  const principais = ordenadas.slice(0, maxFatias);
  const resto = ordenadas.slice(maxFatias);
  if (resto.length) {
    principais.push({ categoria_id: null, nome: `Outras (${resto.length})`, icone: '…', cor: '#8E8E93', total: resto.reduce((s, c) => s + c.total, 0) });
  }
  return principais.map((c) => ({ ...c, pct: total ? (100 * c.total) / total : 0 }));
}

/** Gastos do mês por forma de pagamento, do maior para o menor. */
export function porFormaPagamento(parcelas, visao, competencia) {
  const somas = {};
  for (const p of parcelas.filter(naVisao(visao))) {
    if (p.competencia === competencia) somas[p.forma_pagamento] = (somas[p.forma_pagamento] ?? 0) + p.valor_centavos;
  }
  return Object.entries(somas).map(([forma, total]) => ({ forma, total })).sort((a, b) => b.total - a.total);
}

/** Faturas de cartão dos `n` meses SEGUINTES ao mês escolhido (parcelas a vencer). */
export function projecaoFaturas(parcelas, visao, competencia, n = 6) {
  const meses = Array.from({ length: n }, (_, i) => somarMesesCompetencia(competencia, i + 1));
  return meses.map((mes) => ({
    competencia: mes,
    total: parcelas.filter(naVisao(visao))
      .filter((p) => p.competencia === mes && p.forma_pagamento === 'credito')
      .reduce((s, p) => s + p.valor_centavos, 0),
  }));
}

/**
 * Orçamento × realizado por categoria no mês.
 * Visão família → orçamentos familiares (user_id nulo) contra o gasto de todos.
 * Visão pessoa  → orçamentos daquela pessoa contra o gasto dela.
 * situacao: 'ok' (< 80%), 'atencao' (80–99%), 'estourado' (≥ 100%).
 */
export function orcadoRealizado(orcamentos, parcelas, visao, competencia, categorias = []) {
  const donoOrcamento = visao === 'familia' ? null : visao;
  return orcamentos
    .filter((o) => (o.user_id ?? null) === donoOrcamento)
    .map((o) => {
      const realizado = parcelas.filter(naVisao(visao))
        .filter((p) => p.competencia === competencia && p.categoria_id === o.categoria_id)
        .reduce((s, p) => s + p.valor_centavos, 0);
      const fracao = realizado / o.valor_mensal_centavos;
      const cat = categorias.find((c) => c.id === o.categoria_id);
      return {
        categoria_id: o.categoria_id,
        nome: cat?.nome ?? '—',
        icone: cat?.icone ?? '•',
        orcado: o.valor_mensal_centavos,
        realizado,
        pct: Math.round(fracao * 100),
        situacao: fracao >= LIMITES_ORCAMENTO.estourado ? 'estourado' : fracao >= LIMITES_ORCAMENTO.atencao ? 'atencao' : 'ok',
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

/** A recorrência vale naquele mês? (ativa, já começou, não terminou) */
export function recorrenciaVigente(rec, competencia) {
  if (!rec.ativa) return false;
  if (competenciaDe(rec.data_inicio) > competencia) return false;
  if (rec.data_fim && competenciaDe(rec.data_fim) < competencia) return false;
  return true;
}

/**
 * Conciliação PREVISTO × REALIZADO do mês (RN-01).
 *
 *   Ganhos          previsto = ganhos fixos (recorrências) vigentes no mês
 *   Gastos fixos    previsto = gastos fixos (recorrências) vigentes no mês
 *   Gastos variáveis previsto = soma dos orçamentos da visão
 *   Parcelas de compras anteriores = já comprometido antes do mês começar
 *
 * Cada linha é mostrada separada (não há um "total previsto" inventado).
 */
export function previstoRealizado({ recorrencias, orcamentos, parcelas, linhasResumo, visao, competencia }) {
  const r = resumoDoMes(linhasResumo, visao, competencia);
  const recs = recorrencias.filter(naVisao(visao)).filter((x) => recorrenciaVigente(x, competencia));
  const soma = (lista) => lista.reduce((s, x) => s + x.valor_centavos, 0);
  const donoOrcamento = visao === 'familia' ? null : visao;

  const ganhosPrevistos = soma(recs.filter((x) => x.tipo === 'receita'));
  const fixosPrevistos = soma(recs.filter((x) => x.tipo === 'despesa'));
  const variaveisPrevistos = orcamentos.filter((o) => (o.user_id ?? null) === donoOrcamento)
    .reduce((s, o) => s + o.valor_mensal_centavos, 0);
  const parcelasAnteriores = parcelas.filter(naVisao(visao))
    .filter((p) => p.competencia === competencia && p.total > 1 && competenciaDe(p.data_compra) < competencia)
    .reduce((s, p) => s + p.valor_centavos, 0);

  return {
    linhas: [
      { chave: 'ganhos', rotulo: 'Ganhos', previsto: ganhosPrevistos, realizado: r.receitas, tipo: 'ganho' },
      { chave: 'fixos', rotulo: 'Gastos fixos', previsto: fixosPrevistos, realizado: r.fixas, tipo: 'gasto' },
      { chave: 'variaveis', rotulo: 'Gastos variáveis', previsto: variaveisPrevistos || null, realizado: r.variaveis, tipo: 'gasto' },
    ],
    parcelasAnteriores,
    saldoPrevisto: ganhosPrevistos - fixosPrevistos - variaveisPrevistos,
    saldoRealizado: r.saldo,
  };
}
