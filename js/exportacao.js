/**
 * =============================================================================
 * js/exportacao.js — Exportar dados (JSON/CSV) e importar tarefas do Claude
 * -----------------------------------------------------------------------------
 * RF-80  Exportar em JSON e CSV.
 * RF-81  Rotina mensal: o JSON do mês vai para a Skill "Consultor Financeiro
 *        Familiar" (claude-skill/consultor-financeiro/SKILL.md).
 * RF-73  Importar de volta as tarefas que o Claude sugerir.
 *
 * FORMATOS (versionados — a Skill confere o campo "formato"):
 *   financas-familia/export@1   JSON do mês para o Claude (ver montarExport)
 *   financas-familia/tarefas@1  JSON de tarefas vindo do Claude
 *   financas-familia/backup@1   Backup completo (todas as tabelas)
 *
 * PRIVACIDADE: o export para o Claude NÃO leva e-mails, ids internos nem
 * coordenadas de GPS — só nomes, valores, categorias e o nome do local.
 *
 * Funções puras, testadas em tests/js/exportacao.test.js.
 * =============================================================================
 */
import { mesExtenso, somarMesesCompetencia, competenciaDe } from './formato.js';

export const FORMATO_EXPORT = 'financas-familia/export@1';
export const FORMATO_TAREFAS = 'financas-familia/tarefas@1';
export const FORMATO_BACKUP = 'financas-familia/backup@1';
export const MAX_TAREFAS_IMPORTACAO = 20;

const FORMA = { pix: 'PIX', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', boleto: 'Boleto', outro: 'Outro' };

/**
 * JSON do mês para a Skill do Claude.
 * @param {object} p
 * @param {string} p.competencia 'AAAA-MM-01'
 * @param {object} p.familia     { nome }
 * @param {Array}  p.membros     [{ id, nome }]
 * @param {Array}  p.categorias, p.cartoes, p.recorrencias
 * @param {object} p.dados       { resumo, despesas, receitas, parcelas, orcamentos, insights, tarefas }
 * @param {string} [p.geradoEm]  ISO (injeção para testes)
 */
export function montarExport({ competencia, familia, membros, categorias, cartoes, recorrencias, dados, geradoEm = new Date().toISOString() }) {
  const pessoa = (id) => (id ? membros.find((m) => m.id === id)?.nome ?? '—' : 'Família');
  const categoria = (id) => categorias.find((c) => c.id === id)?.nome ?? '—';
  const cartao = (id) => cartoes.find((c) => c.id === id)?.apelido ?? null;
  const doMes = dados.parcelas.filter((p) => p.competencia === competencia);

  // Gastos do mês por categoria (pela competência — mês da fatura).
  const somaCat = new Map();
  for (const p of doMes) somaCat.set(p.categoria_id, (somaCat.get(p.categoria_id) ?? 0) + p.valor_centavos);
  const totalMes = [...somaCat.values()].reduce((s, v) => s + v, 0);

  const futuros = Array.from({ length: 12 }, (_, i) => somarMesesCompetencia(competencia, i + 1));

  return {
    formato: FORMATO_EXPORT,
    gerado_em: geradoEm,
    moeda: 'BRL',
    valores_em: 'centavos (100 = R$ 1,00)',
    familia: { nome: familia?.nome ?? 'Família', membros: membros.map((m) => m.nome) },
    periodo: { competencia, rotulo: mesExtenso(competencia) },

    resumo_mensal: dados.resumo
      .slice().sort((a, b) => a.competencia.localeCompare(b.competencia) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((r) => ({
        competencia: r.competencia,
        pessoa: pessoa(r.user_id),
        receitas: r.receitas_centavos,
        despesas: r.despesas_centavos,
        despesas_fixas: r.despesas_fixas_centavos,
        despesas_variaveis: r.despesas_variaveis_centavos,
        despesas_cartao: r.despesas_cartao_centavos,
        saldo: r.saldo_centavos,
        taxa_poupanca_pct: r.taxa_poupanca_pct,
      })),

    receitas: dados.receitas.map((r) => ({
      data: r.data, pessoa: pessoa(r.user_id), categoria: categoria(r.categoria_id), descricao: r.descricao ?? null,
      valor: r.valor_centavos, natureza: r.natureza, recorrente: Boolean(r.recorrencia_id),
    })),

    despesas: dados.despesas.map((d) => ({
      data_compra: d.data_compra, pessoa: pessoa(d.user_id), categoria: categoria(d.categoria_id), descricao: d.descricao ?? null,
      valor_total: d.valor_total_centavos, forma_pagamento: FORMA[d.forma_pagamento] ?? d.forma_pagamento,
      cartao: cartao(d.cartao_id), parcelas: d.qtd_parcelas, natureza: d.natureza, recorrente: Boolean(d.recorrencia_id),
      local: d.local_nome ?? null,
    })),

    gastos_por_categoria: [...somaCat.entries()]
      .map(([id, total]) => ({ categoria: categoria(id), total, pct: totalMes ? Math.round(1000 * total / totalMes) / 10 : 0 }))
      .sort((a, b) => b.total - a.total),

    parcelas_futuras: futuros.map((c) => {
      const doMesFuturo = dados.parcelas.filter((p) => p.competencia === c && p.forma_pagamento === 'credito');
      const porPessoa = {};
      for (const p of doMesFuturo) porPessoa[pessoa(p.user_id)] = (porPessoa[pessoa(p.user_id)] ?? 0) + p.valor_centavos;
      return { competencia: c, total: doMesFuturo.reduce((s, p) => s + p.valor_centavos, 0), por_pessoa: porPessoa };
    }),

    recorrencias: recorrencias.map((r) => ({
      tipo: r.tipo === 'receita' ? 'ganho' : 'gasto', descricao: r.descricao, valor: r.valor_centavos, dia_do_mes: r.dia_do_mes,
      categoria: categoria(r.categoria_id), pessoa: pessoa(r.user_id), forma_pagamento: r.forma_pagamento ? FORMA[r.forma_pagamento] : null,
      desde: r.data_inicio, ate: r.data_fim, ativa: r.ativa,
    })),

    orcamentos: dados.orcamentos.map((o) => ({
      categoria: categoria(o.categoria_id), pessoa: pessoa(o.user_id), orcado: o.valor_mensal_centavos,
      realizado: doMes.filter((p) => p.categoria_id === o.categoria_id && (!o.user_id || p.user_id === o.user_id))
        .reduce((s, p) => s + p.valor_centavos, 0),
    })),

    alertas: dados.insights.map((i) => ({ regra: i.regra_codigo, severidade: i.severidade, mensagem: i.mensagem, pessoa: pessoa(i.user_id) })),

    tarefas: dados.tarefas.map((t) => ({
      titulo: t.titulo, descricao: t.descricao ?? null, prioridade: t.prioridade, status: t.status, origem: t.origem, pessoa: pessoa(t.user_id),
    })),

    instrucoes: 'Analise com a Skill "Consultor Financeiro Familiar". Devolva as tarefas no formato financas-familia/tarefas@1 para importar no app (Saúde → Importar tarefas do Claude).',
  };
}

// =============================================================================
// CSV (abre direto no Excel em português)
// =============================================================================

/** Valor para CSV: aspas quando preciso; separador ";" (padrão do Excel pt-BR). */
function celula(v) {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Centavos → "1234,56" (vírgula decimal, sem milhar — o Excel entende como número). */
const numero = (centavos) => ((centavos ?? 0) / 100).toFixed(2).replace('.', ',');

/**
 * CSV dos lançamentos do mês (gastos e ganhos).
 * Começa com BOM (﻿) para o Excel reconhecer os acentos (UTF-8).
 */
export function montarCSV({ despesas, receitas, membros, categorias, cartoes }) {
  const pessoa = (id) => membros.find((m) => m.id === id)?.nome ?? '';
  const categoria = (id) => categorias.find((c) => c.id === id)?.nome ?? '';
  const cartao = (id) => cartoes.find((c) => c.id === id)?.apelido ?? '';
  const cabecalho = ['tipo', 'data', 'pessoa', 'categoria', 'descricao', 'forma_pagamento', 'cartao', 'parcelas', 'natureza', 'local', 'valor'];
  const linhas = [
    ...receitas.map((r) => ['ganho', r.data, pessoa(r.user_id), categoria(r.categoria_id), r.descricao, '', '', '', r.natureza, '', numero(r.valor_centavos)]),
    ...despesas.map((d) => ['gasto', d.data_compra, pessoa(d.user_id), categoria(d.categoria_id), d.descricao, FORMA[d.forma_pagamento] ?? d.forma_pagamento,
      cartao(d.cartao_id), d.qtd_parcelas, d.natureza, d.local_nome, numero(d.valor_total_centavos)]),
  ].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return `﻿${[cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
}

// =============================================================================
// Importar tarefas do Claude
// =============================================================================

/**
 * Lê o texto colado (ou arquivo) com as tarefas geradas pela Skill.
 * Aceita o JSON puro ou dentro de um bloco ```json … ``` (como o Claude
 * costuma responder).
 * @returns {{tarefas: Array<{titulo, descricao, prioridade, user_id}>, erros: string[], competencia: string|null}}
 */
export function lerTarefasDoClaude(texto, membros) {
  const erros = [];
  let json;
  const bruto = String(texto ?? '').trim();
  const bloco = bruto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  try {
    json = JSON.parse(bloco ? bloco[1] : bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
  } catch {
    return { tarefas: [], erros: ['Não encontrei um JSON válido. Copie o bloco de tarefas que o Claude gerou (começa com { e termina com }).'], competencia: null };
  }
  if (json?.formato !== FORMATO_TAREFAS) {
    erros.push(`Formato inesperado: "${json?.formato ?? 'sem formato'}". O esperado é "${FORMATO_TAREFAS}".`);
    return { tarefas: [], erros, competencia: null };
  }
  if (!Array.isArray(json.tarefas) || json.tarefas.length === 0) {
    return { tarefas: [], erros: ['Nenhuma tarefa na lista.'], competencia: json.competencia ?? null };
  }
  if (json.tarefas.length > MAX_TAREFAS_IMPORTACAO) erros.push(`Muitas tarefas: só as ${MAX_TAREFAS_IMPORTACAO} primeiras serão importadas.`);

  const porNome = (nome) => membros.find((m) => m.nome.toLowerCase() === String(nome ?? '').trim().toLowerCase());
  const tarefas = [];
  json.tarefas.slice(0, MAX_TAREFAS_IMPORTACAO).forEach((t, i) => {
    const titulo = String(t?.titulo ?? '').trim();
    if (!titulo) { erros.push(`Tarefa ${i + 1}: sem título (ignorada).`); return; }
    const prioridade = [1, 2, 3].includes(Number(t.prioridade)) ? Number(t.prioridade) : 2;
    const responsavel = String(t.responsavel ?? 'Família').trim();
    const membro = /^fam[ií]lia$/i.test(responsavel) ? null : porNome(responsavel);
    if (!/^fam[ií]lia$/i.test(responsavel) && !membro) erros.push(`Tarefa ${i + 1}: responsável "${responsavel}" não encontrado — ficou para a Família.`);
    tarefas.push({
      titulo: titulo.slice(0, 120),
      descricao: t.descricao ? String(t.descricao).slice(0, 1000) : null,
      prioridade,
      user_id: membro?.id ?? null,
    });
  });
  return { tarefas, erros, competencia: json.competencia ?? null };
}

/** Remove das importadas as que já existem ABERTAS com o mesmo título (reimportar não duplica). */
export function semDuplicadas(novas, existentes) {
  const abertas = new Set(existentes.filter((t) => t.status === 'aberta').map((t) => t.titulo.trim().toLowerCase()));
  return novas.filter((t) => !abertas.has(t.titulo.trim().toLowerCase()));
}

/** Nome do arquivo: financas-2026-10.json / financas-2026-10.csv */
export const nomeArquivo = (competencia, extensao) => `financas-${competenciaDe(competencia).slice(0, 7)}.${extensao}`;
