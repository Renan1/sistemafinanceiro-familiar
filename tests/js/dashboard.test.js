/**
 * tests/js/dashboard.test.js — Cálculos do Painel (RF-60 a RF-62, RN-01, RN-02)
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumoDoMes, serieMensal, porCategoria, porFormaPagamento, projecaoFaturas,
  orcadoRealizado, previstoRealizado, recorrenciaVigente, mesesAte,
} from '../../js/dashboard.js';

const R = 'renan'; const C = 'camilla';
const OUT = '2026-10-01';

const resumo = [
  { user_id: null, competencia: OUT, receitas_centavos: 1000000, despesas_centavos: 400000, despesas_fixas_centavos: 250000, despesas_variaveis_centavos: 150000, despesas_cartao_centavos: 100000, taxa_poupanca_pct: 60, fixos_sobre_renda_pct: 25 },
  { user_id: R, competencia: OUT, receitas_centavos: 600000, despesas_centavos: 300000, despesas_fixas_centavos: 200000, despesas_variaveis_centavos: 100000, despesas_cartao_centavos: 100000, taxa_poupanca_pct: 50, fixos_sobre_renda_pct: 33.3 },
  { user_id: null, competencia: '2026-09-01', receitas_centavos: 900000, despesas_centavos: 950000, despesas_fixas_centavos: 250000, despesas_variaveis_centavos: 700000 },
];

const p = (user_id, competencia, valor, cat, extra = {}) => ({
  user_id, competencia, valor_centavos: valor, categoria_id: cat, categoria_nome: cat, categoria_icone: '•', categoria_cor: '#000',
  forma_pagamento: 'pix', total: 1, data_compra: competencia, ...extra,
});
const parcelas = [
  p(R, OUT, 50000, 'mercado'), p(C, OUT, 30000, 'mercado'), p(R, OUT, 20000, 'lazer', { forma_pagamento: 'credito' }),
  p(C, OUT, 10000, 'saude', { forma_pagamento: 'debito' }), p(R, OUT, 5000, 'pets'), p(R, OUT, 4000, 'vestuario'),
  p(R, OUT, 3000, 'presentes'), p(R, OUT, 1000, 'outros'),
  // parcela 2/3 de uma compra de setembro (compromisso anterior)
  p(R, OUT, 33333, 'eletronicos', { forma_pagamento: 'credito', total: 3, data_compra: '2026-09-20' }),
  // futuras
  p(R, '2026-11-01', 33333, 'eletronicos', { forma_pagamento: 'credito', total: 3 }),
  p(C, '2026-12-01', 15000, 'lazer', { forma_pagamento: 'credito', total: 2 }),
];

describe('Resumo e séries', () => {
  test('família e pessoa', () => {
    assert.equal(resumoDoMes(resumo, 'familia', OUT).saldo, 600000);
    assert.equal(resumoDoMes(resumo, R, OUT).receitas, 600000);
    assert.equal(resumoDoMes(resumo, C, OUT).receitas, 0, 'sem linha = zeros');
  });
  test('série de 12 meses termina no mês escolhido e preenche vazios com zero', () => {
    const s = serieMensal(resumo, 'familia', OUT);
    assert.equal(s.length, 12);
    assert.equal(s.at(-1).competencia, OUT);
    assert.equal(s.at(-2).despesas, 950000);
    assert.equal(s[0].competencia, '2025-11-01');
    assert.equal(s[0].receitas, 0);
  });
  test('mesesAte atravessa o ano', () => {
    assert.deepEqual(mesesAte('2027-02-01', 3), ['2026-12-01', '2027-01-01', '2027-02-01']);
  });
});

describe('Categorias e formas de pagamento', () => {
  test('ordena, agrupa o resto em "Outras" e soma 100%', () => {
    const cats = porCategoria(parcelas, 'familia', OUT);
    assert.equal(cats[0].categoria_id, 'mercado');
    assert.equal(cats[0].total, 80000);
    assert.equal(cats.length, 6);
    assert.match(cats.at(-1).nome, /^Outras \(\d\)$/);
    assert.ok(Math.abs(cats.reduce((s, c) => s + c.pct, 0) - 100) < 1e-9);
  });
  test('visão individual só soma a pessoa', () => {
    assert.equal(porCategoria(parcelas, C, OUT).find((c) => c.categoria_id === 'mercado').total, 30000);
  });
  test('formas de pagamento', () => {
    const f = porFormaPagamento(parcelas, 'familia', OUT);
    assert.deepEqual(f.map((x) => x.forma), ['pix', 'credito', 'debito']);
    assert.equal(f.find((x) => x.forma === 'credito').total, 53333);
  });
});

describe('Faturas futuras (6 meses)', () => {
  test('só crédito, meses seguintes ao escolhido', () => {
    const proj = projecaoFaturas(parcelas, 'familia', OUT);
    assert.equal(proj.length, 6);
    assert.deepEqual(proj.slice(0, 3).map((x) => [x.competencia, x.total]), [['2026-11-01', 33333], ['2026-12-01', 15000], ['2027-01-01', 0]]);
    assert.equal(projecaoFaturas(parcelas, R, OUT)[1].total, 0);
  });
});

describe('Orçamento × realizado', () => {
  const orcamentos = [
    { categoria_id: 'mercado', user_id: null, valor_mensal_centavos: 100000 },  // 80% → atenção
    { categoria_id: 'lazer', user_id: null, valor_mensal_centavos: 15000 },     // 133% → estourado
    { categoria_id: 'saude', user_id: null, valor_mensal_centavos: 50000 },     // 20% → ok
    { categoria_id: 'mercado', user_id: R, valor_mensal_centavos: 40000 },      // individual
  ];
  test('situação por limite (80% atenção, 100% estourado), mais crítico primeiro', () => {
    const r = orcadoRealizado(orcamentos, parcelas, 'familia', OUT);
    assert.deepEqual(r.map((x) => [x.categoria_id, x.pct, x.situacao]),
      [['lazer', 133, 'estourado'], ['mercado', 80, 'atencao'], ['saude', 20, 'ok']]);
  });
  test('visão individual usa o orçamento da pessoa contra o gasto dela', () => {
    const r = orcadoRealizado(orcamentos, parcelas, R, OUT);
    assert.deepEqual(r.map((x) => [x.categoria_id, x.realizado, x.situacao]), [['mercado', 50000, 'estourado']]);
  });
});

describe('Previsto × realizado (RN-01)', () => {
  const rec = (user_id, tipo, valor, extra = {}) => ({ user_id, tipo, valor_centavos: valor, ativa: true, data_inicio: '2026-01-01', data_fim: null, ...extra });
  const recorrencias = [
    rec(R, 'receita', 600000), rec(C, 'receita', 400000),
    rec(R, 'despesa', 200000), rec(C, 'despesa', 50000),
    rec(R, 'despesa', 99999, { ativa: false }),                 // pausada
    rec(R, 'receita', 77777, { data_inicio: '2026-11-01' }),    // começa depois
    rec(R, 'despesa', 11111, { data_fim: '2026-09-30' }),       // já terminou
  ];
  const orcamentos = [{ categoria_id: 'mercado', user_id: null, valor_mensal_centavos: 100000 }];

  test('recorrência vigente', () => {
    assert.equal(recorrenciaVigente(recorrencias[4], OUT), false);
    assert.equal(recorrenciaVigente(recorrencias[5], OUT), false);
    assert.equal(recorrenciaVigente(recorrencias[6], OUT), false);
    assert.equal(recorrenciaVigente(recorrencias[0], OUT), true);
  });

  test('família', () => {
    const r = previstoRealizado({ recorrencias, orcamentos, parcelas, linhasResumo: resumo, visao: 'familia', competencia: OUT });
    assert.deepEqual(r.linhas.map((l) => [l.chave, l.previsto, l.realizado]),
      [['ganhos', 1000000, 1000000], ['fixos', 250000, 250000], ['variaveis', 100000, 150000]]);
    assert.equal(r.parcelasAnteriores, 33333);
    assert.equal(r.saldoPrevisto, 1000000 - 250000 - 100000);
    assert.equal(r.saldoRealizado, 600000);
  });

  test('pessoa sem orçamento individual: variáveis sem previsto', () => {
    const r = previstoRealizado({ recorrencias, orcamentos, parcelas, linhasResumo: resumo, visao: C, competencia: OUT });
    assert.equal(r.linhas[0].previsto, 400000);
    assert.equal(r.linhas[2].previsto, null);
  });
});
