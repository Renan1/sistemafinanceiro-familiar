/**
 * tests/js/recorrencias.test.js — Geração de lançamentos fixos (RF-30/31, RN-18)
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { competenciasDevidas, dataNoMes, idDeterministico, montarLancamento, gerarPendentes, MAX_MESES_RETROATIVOS } from '../../js/recorrencias.js';

const salario = {
  id: 'rec-salario', user_id: 'renan', household_id: 'hh', tipo: 'receita', descricao: 'Salário',
  valor_centavos: 500000, categoria_id: 'cat-sal', dia_do_mes: 5, data_inicio: '2026-07-01', data_fim: null, ativa: true,
};
const aluguelCredito = {
  id: 'rec-streaming', user_id: 'renan', household_id: 'hh', tipo: 'despesa', descricao: 'Streaming',
  valor_centavos: 3990, categoria_id: 'cat-ass', forma_pagamento: 'credito', cartao_id: 'cartao-1',
  dia_do_mes: 31, data_inicio: '2026-09-01', data_fim: null, ativa: true,
};
const NUBANK = { id: 'cartao-1', dia_fechamento: 5, dia_vencimento: 12 };

describe('Quais meses devem ter lançamento', () => {
  test('do início até o mês atual', () => {
    assert.deepEqual(competenciasDevidas(salario, '2026-09-01'), ['2026-07-01', '2026-08-01', '2026-09-01']);
  });
  test('recorrência que começa no futuro não gera nada', () => {
    assert.deepEqual(competenciasDevidas({ ...salario, data_inicio: '2026-12-01' }, '2026-09-01'), []);
  });
  test('recorrência encerrada para no mês do fim', () => {
    assert.deepEqual(competenciasDevidas({ ...salario, data_fim: '2026-08-31' }, '2026-10-01'), ['2026-07-01', '2026-08-01']);
  });
  test('pausada não gera', () => {
    assert.deepEqual(competenciasDevidas({ ...salario, ativa: false }, '2026-09-01'), []);
  });
  test(`no máximo ${MAX_MESES_RETROATIVOS} meses para trás`, () => {
    const meses = competenciasDevidas({ ...salario, data_inicio: '2020-01-01' }, '2026-09-01');
    assert.equal(meses.length, MAX_MESES_RETROATIVOS);
    assert.equal(meses.at(-1), '2026-09-01');
  });
  test('virada de ano', () => {
    assert.deepEqual(competenciasDevidas({ ...salario, data_inicio: '2026-11-15' }, '2027-01-01'), ['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('Data e id', () => {
  test('dia 31 em mês curto vira último dia', () => {
    assert.equal(dataNoMes('2027-02-01', 31), '2027-02-28');
    assert.equal(dataNoMes('2026-09-01', 31), '2026-09-30');
    assert.equal(dataNoMes('2026-10-01', 5), '2026-10-05');
  });
  test('id determinístico: mesma entrada, mesmo id; formato UUID', async () => {
    const a = await idDeterministico('rec-1', '2026-09-01');
    assert.equal(a, await idDeterministico('rec-1', '2026-09-01'));
    assert.notEqual(a, await idDeterministico('rec-1', '2026-10-01'));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('Montar o lançamento', () => {
  test('ganho fixo', () => {
    const l = montarLancamento(salario, '2026-09-01', undefined, 'id-1');
    assert.equal(l.tipo, 'receita');
    assert.deepEqual(
      { data: l.dados.data, valor: l.dados.valor_centavos, natureza: l.dados.natureza, origem: l.dados.origem, comp: l.dados.competencia_recorrencia },
      { data: '2026-09-05', valor: 500000, natureza: 'fixa', origem: 'recorrencia', comp: '2026-09-01' });
  });
  test('gasto fixo no crédito: 1 parcela na fatura certa', () => {
    // Dia 31 → 30/09 (depois do fechamento dia 5) → fatura de outubro.
    const l = montarLancamento(aluguelCredito, '2026-09-01', NUBANK, 'id-2');
    assert.equal(l.tipo, 'despesa');
    assert.equal(l.dados.data_compra, '2026-09-30');
    assert.equal(l.dados.qtd_parcelas, 1);
    assert.deepEqual(l.parcelas.map((p) => [p.valor_centavos, p.competencia]), [[3990, '2026-10-01']]);
  });
});

describe('Gerar pendentes sem duplicar (RN-18)', () => {
  const executar = async ({ noServidor = [], fila = [], recorrencias = [salario] } = {}) => {
    const criados = [];
    const n = await gerarPendentes({
      userId: 'renan', recorrencias, cartoes: [NUBANK], competenciaAtual: '2026-09-01',
      jaGeradasNoServidor: async () => new Set(noServidor), fila, enfileirar: async (i) => criados.push(i),
    });
    return { n, criados };
  };

  test('gera os meses que faltam', async () => {
    const { n, criados } = await executar();
    assert.equal(n, 3);
    assert.deepEqual(criados.map((c) => c.dados.competencia_recorrencia), ['2026-07-01', '2026-08-01', '2026-09-01']);
  });
  test('não gera o que já existe no servidor (inclusive excluídos)', async () => {
    const { n } = await executar({ noServidor: ['rec-salario|2026-07-01', 'rec-salario|2026-08-01'] });
    assert.equal(n, 1);
  });
  test('não gera o que já está na fila do aparelho', async () => {
    const fila = [{ dados: { recorrencia_id: 'rec-salario', competencia_recorrencia: '2026-09-01' } }];
    const { n } = await executar({ noServidor: ['rec-salario|2026-07-01', 'rec-salario|2026-08-01'], fila });
    assert.equal(n, 0);
  });
  test('não gera recorrências de outra pessoa', async () => {
    const { n } = await executar({ recorrencias: [{ ...salario, user_id: 'camilla' }] });
    assert.equal(n, 0);
  });
  test('rodar duas vezes seguidas: a segunda não cria nada', async () => {
    const primeira = await executar();
    const noServidor = primeira.criados.map((c) => `${c.dados.recorrencia_id}|${c.dados.competencia_recorrencia}`);
    const { n } = await executar({ noServidor });
    assert.equal(n, 0);
  });
});
