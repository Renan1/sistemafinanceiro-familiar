/**
 * =============================================================================
 * tests/js/formato-validacao.test.js — Formatação pt-BR e validações
 * Rodar: npm test
 * =============================================================================
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { moeda, dataBR, mesAbrev, mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia, percentual } from '../../js/formato.js';
import { validarSenha, validarGasto, validarGanho, validarCartao, validarEmail } from '../../js/validacao.js';

describe('Formatação pt-BR (RNF-30)', () => {
  test('moeda', () => {
    assert.equal(moeda(123456), 'R$ 1.234,56');
    assert.equal(moeda(5), 'R$ 0,05');
    assert.equal(moeda(0), 'R$ 0,00');
    assert.equal(moeda(-1050), '-R$ 10,50');
  });

  test('datas', () => {
    assert.equal(dataBR('2026-09-23'), '23/09/2026');
    assert.equal(mesAbrev('2026-11-01'), 'Nov/26');
    assert.equal(mesExtenso('2026-03-01'), 'março de 2026');
    assert.equal(competenciaDe('2026-09-23'), '2026-09-01');
    assert.equal(somarMesesCompetencia('2026-12-01', 1), '2027-01-01');
    assert.equal(somarMesesCompetencia('2026-01-01', -1), '2025-12-01');
  });

  test('"hoje" usa o fuso de São Paulo, não o do aparelho', () => {
    // 23/09/2026 às 01:30 UTC ainda é 22/09 em São Paulo (UTC-3).
    assert.equal(hojeSP(new Date('2026-09-23T01:30:00Z')), '2026-09-22');
    assert.equal(hojeSP(new Date('2026-09-23T03:30:00Z')), '2026-09-23');
  });

  test('percentual', () => {
    assert.equal(percentual(14.8), '14,8%');
    assert.equal(percentual(null), '—');
  });
});

describe('Política de senha (RNF-01)', () => {
  test('senha forte passa', () => assert.deepEqual(validarSenha('Familia@2026'), []));
  test('lista o que falta', () => {
    assert.deepEqual(validarSenha('abc'), [
      'mínimo de 8 caracteres', 'uma letra MAIÚSCULA', 'um número', 'um caractere especial (!@#$%…)',
    ]);
    assert.deepEqual(validarSenha('SENHA123!'), ['uma letra minúscula']);
  });
});

describe('Validação de lançamentos', () => {
  const gasto = { valorCentavos: 1000, categoriaId: 'c', formaPagamento: 'pix', cartaoId: null, qtdParcelas: 1, data: '2026-09-23' };

  test('gasto válido', () => assert.deepEqual(validarGasto(gasto), []));
  test('gasto sem valor/categoria', () => {
    assert.deepEqual(validarGasto({ ...gasto, valorCentavos: 0, categoriaId: null }), ['Digite o valor.', 'Escolha a categoria.']);
  });
  test('crédito sem cartão', () => {
    assert.deepEqual(validarGasto({ ...gasto, formaPagamento: 'credito' }), ['Escolha o cartão.']);
  });
  test('ganho válido e inválido', () => {
    assert.deepEqual(validarGanho({ valorCentavos: 500000, categoriaId: 'c', data: '2026-09-05' }), []);
    assert.deepEqual(validarGanho({ valorCentavos: 0, categoriaId: 'c', data: '2026-09-05' }), ['Digite o valor.']);
  });
  test('cartão', () => {
    const ok = { apelido: 'Nubank', bandeira: 'mastercard', ultimos4: '1234', dia_fechamento: 5, dia_vencimento: 12, limite_centavos: null };
    assert.deepEqual(validarCartao(ok), []);
    assert.equal(validarCartao({ ...ok, ultimos4: '12a4', dia_fechamento: 32 }).length, 2);
  });
  test('e-mail', () => {
    assert.deepEqual(validarEmail('renan@exemplo.com'), []);
    assert.equal(validarEmail('renan@').length, 1);
  });
});
