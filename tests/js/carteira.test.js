/**
 * tests/js/carteira.test.js — Compras da Carteira do iPhone → sugestão de gasto (v1.2)
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, acharCartao, sugerirGasto, lembrarEscolha } from '../../js/carteira.js';

const R = 'renan';
const cartoes = [
  { id: 'nu', user_id: R, apelido: 'Nubank Renan', ultimos4: '1234', ativo: true },
  { id: 'itau', user_id: R, apelido: 'Itaú Personnalité', ultimos4: '9876', ativo: true },
  { id: 'itau-velho', user_id: R, apelido: 'Itaú antigo', ultimos4: '5555', ativo: false },
  { id: 'cami', user_id: 'camilla', apelido: 'Itaú Camilla', ultimos4: '4321', ativo: true },
];

describe('normalizar', () => {
  test('tira acento, pontuação e espaços extras', () => {
    assert.equal(normalizar('  Padaria  São José - Loja 2 '), 'padaria sao jose loja 2');
    assert.equal(normalizar(null), '');
  });
});

describe('acharCartao (nome como aparece na Carteira)', () => {
  test('pelos 4 últimos dígitos', () => assert.equal(acharCartao('Mastercard •••• 1234', cartoes, R)?.id, 'nu'));
  test('pelo apelido contido no nome', () => assert.equal(acharCartao('Nubank Renan', cartoes, R)?.id, 'nu'));
  test('pela primeira palavra', () => assert.equal(acharCartao('Nubank', cartoes, R)?.id, 'nu'));
  test('sem acento: "Itau Personnalite Visa"', () => assert.equal(acharCartao('Itau Personnalite Visa', cartoes, R)?.id, 'itau'));
  test('ignora cartão arquivado e cartão de outra pessoa', () => {
    assert.equal(acharCartao('5555', cartoes, R), null);
    assert.equal(acharCartao('Visa •••• 4321', cartoes, R), null, 'dígitos do cartão da Camilla');
  });
  test('na dúvida (dois possíveis ou nome vazio), não chuta', () => {
    const dois = [...cartoes, { id: 'nu2', user_id: R, apelido: 'Nubank PJ', ultimos4: '1111', ativo: true }];
    assert.equal(acharCartao('Nubank', dois, R), null);
    assert.equal(acharCartao('', cartoes, R), null);
  });
});

describe('sugerirGasto', () => {
  const item = { valor_centavos: 4590, estabelecimento: 'PADARIA SÃO JOSÉ', cartao_nome: 'Nubank', recebido_em: '2026-09-26T01:30:00Z' };

  test('valor, local e data no fuso de São Paulo (22h30 do dia 25)', () => {
    const s = sugerirGasto(item, { cartoes, userId: R });
    assert.equal(s.centavos, 4590);
    assert.equal(s.localNome, 'PADARIA SÃO JOSÉ');
    assert.equal(s.data, '2026-09-25');
  });
  test('cartão reconhecido pelo nome → crédito nesse cartão; sem categoria lembrada', () => {
    const s = sugerirGasto(item, { cartoes, userId: R });
    assert.equal(s.forma, 'credito');
    assert.equal(s.cartaoId, 'nu');
    assert.equal(s.categoriaId, null);
  });
  test('lembranças: categoria do lugar e forma escolhida antes valem mais que o palpite', () => {
    const lembrancas = lembrarEscolha({}, item, { forma: 'debito', cartaoId: null, categoriaId: 'padaria' });
    const s = sugerirGasto(item, { cartoes, userId: R, lembrancas });
    assert.equal(s.categoriaId, 'padaria');
    assert.equal(s.forma, 'debito');
    assert.equal(s.cartaoId, null);
  });
  test('lembrança de um cartão que foi arquivado é ignorada', () => {
    const lembrancas = { cartoes: { nubank: { forma: 'credito', cartaoId: 'itau-velho' } } };
    const s = sugerirGasto(item, { cartoes, userId: R, lembrancas });
    assert.equal(s.cartaoId, 'nu');
  });
  test('cartão desconhecido e nada lembrado → deixa a pessoa escolher', () => {
    const s = sugerirGasto({ ...item, cartao_nome: 'Cartão Misterioso' }, { cartoes, userId: R });
    assert.equal(s.forma, null);
    assert.equal(s.cartaoId, null);
  });
});

describe('lembrarEscolha', () => {
  test('não altera o objeto original e guarda pelas chaves normalizadas', () => {
    const original = { categorias: { x: 'y' }, cartoes: {} };
    const novo = lembrarEscolha(original, { estabelecimento: 'Posto Shell', cartao_nome: 'Itaú Visa' },
      { forma: 'credito', cartaoId: 'itau', categoriaId: 'combustivel' });
    assert.deepEqual(original, { categorias: { x: 'y' }, cartoes: {} });
    assert.equal(novo.categorias['posto shell'], 'combustivel');
    assert.deepEqual(novo.cartoes['itau visa'], { forma: 'credito', cartaoId: 'itau' });
  });
});
