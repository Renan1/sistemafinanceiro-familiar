/**
 * tests/js/regras.test.js — Motor de regras da Saúde Financeira (RF-70, RF-71)
 * Rodar: npm test
 * Cada regra é testada no caso em que DISPARA e no caso em que NÃO dispara.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarContexto, avaliar, tarefasNovas, REGRAS, LIMITES } from '../../js/regras.js';

const OUT = '2026-10-01';
const cats = [
  { id: 'merc', nome: 'Alimentação/Mercado' }, { id: 'deliv', nome: 'Restaurante/Delivery' },
  { id: 'lazer', nome: 'Lazer' }, { id: 'assin', nome: 'Assinaturas' }, { id: 'mor', nome: 'Moradia' },
];
const linha = (competencia, receitas, despesas, fixas = 0, user_id = null) => ({
  competencia, user_id, receitas_centavos: receitas, despesas_centavos: despesas, despesas_fixas_centavos: fixas,
  taxa_poupanca_pct: receitas ? Math.round(1000 * (receitas - despesas) / receitas) / 10 : null,
});
const parc = (competencia, valor, categoria_id, extra = {}) => ({ user_id: 'renan', competencia, valor_centavos: valor, categoria_id, forma_pagamento: 'pix', total: 1, ...extra });

/** Monta o contexto com valores "saudáveis" e deixa sobrescrever o que o teste quer. */
function ctx({ resumo, parcelas = [], orcamentos = [], recorrencias = [], hoje = '2026-10-20', competencia = OUT, visao = 'familia' } = {}) {
  return montarContexto({
    competencia, hoje, visao, categorias: cats, orcamentos, recorrencias, parcelas,
    resumo: resumo ?? [linha(OUT, 1000000, 600000, 300000), linha('2026-09-01', 1000000, 600000), linha('2026-08-01', 1000000, 600000)],
  });
}
const codigos = (c) => avaliar(c).map((a) => a.regra_codigo);
const regra = (codigo) => REGRAS.find((r) => r.codigo === codigo);

describe('Mês saudável', () => {
  test('nenhum alerta', () => assert.deepEqual(codigos(ctx()), []));
});

describe('DESPESA_MAIOR_RECEITA (crítico)', () => {
  test('dispara quando gastos > ganhos', () => {
    const a = regra('DESPESA_MAIOR_RECEITA').avaliar(ctx({ resumo: [linha(OUT, 500000, 650000)] }));
    assert.equal(a.severidade, 'critico');
    assert.equal(a.dados.diferenca, 150000);
    assert.equal(a.tarefa.prioridade, 1);
  });
  test('não dispara sem ganho registrado (outra regra cuida)', () => {
    assert.equal(regra('DESPESA_MAIOR_RECEITA').avaliar(ctx({ resumo: [linha(OUT, 0, 650000)] })), null);
  });
});

describe('ORCAMENTO_CATEGORIA (80% atenção, 100% crítico)', () => {
  const orc = [{ categoria_id: 'merc', user_id: null, valor_mensal_centavos: 100000 }, { categoria_id: 'lazer', user_id: null, valor_mensal_centavos: 50000 }];
  test('79% não dispara', () => assert.equal(regra('ORCAMENTO_CATEGORIA').avaliar(ctx({ orcamentos: orc, parcelas: [parc(OUT, 79000, 'merc')] })), null));
  test('80% atenção, sem tarefa', () => {
    const a = regra('ORCAMENTO_CATEGORIA').avaliar(ctx({ orcamentos: orc, parcelas: [parc(OUT, 80000, 'merc')] }));
    assert.equal(a.severidade, 'atencao');
    assert.equal(a.tarefa, undefined);
  });
  test('100% crítico, com tarefa citando a categoria', () => {
    const a = regra('ORCAMENTO_CATEGORIA').avaliar(ctx({ orcamentos: orc, parcelas: [parc(OUT, 60000, 'lazer'), parc(OUT, 85000, 'merc')] }));
    assert.equal(a.severidade, 'critico');
    assert.match(a.mensagem, /Lazer 120%.*Alimentação\/Mercado 85%/);
    assert.match(a.tarefa.titulo, /Lazer/);
  });
  test('na visão de uma pessoa, usa o orçamento individual', () => {
    const indiv = [{ categoria_id: 'merc', user_id: 'renan', valor_mensal_centavos: 10000 }];
    assert.equal(regra('ORCAMENTO_CATEGORIA').avaliar(ctx({ orcamentos: indiv, parcelas: [parc(OUT, 20000, 'merc')] })), null, 'família ignora individual');
    assert.equal(regra('ORCAMENTO_CATEGORIA').avaliar(ctx({ visao: 'renan', orcamentos: indiv, parcelas: [parc(OUT, 20000, 'merc')] })).severidade, 'critico');
  });
});

describe('CATEGORIA_ACIMA_MEDIA (+30% sobre 3 meses)', () => {
  const historico = ['2026-09-01', '2026-08-01', '2026-07-01'].map((c) => parc(c, 40000, 'deliv'));
  test('dispara com +50%', () => {
    const a = regra('CATEGORIA_ACIMA_MEDIA').avaliar(ctx({ parcelas: [...historico, parc(OUT, 60000, 'deliv')] }));
    assert.equal(a.severidade, 'atencao');
    assert.match(a.mensagem, /Restaurante\/Delivery \+50%/);
  });
  test('+30% exato não dispara', () => {
    assert.equal(regra('CATEGORIA_ACIMA_MEDIA').avaliar(ctx({ parcelas: [...historico, parc(OUT, 52000, 'deliv')] })), null);
  });
  test('média abaixo do mínimo (ruído) não dispara', () => {
    const pequeno = ['2026-09-01', '2026-08-01', '2026-07-01'].map((c) => parc(c, 2000, 'lazer'));
    assert.equal(regra('CATEGORIA_ACIMA_MEDIA').avaliar(ctx({ parcelas: [...pequeno, parc(OUT, 9000, 'lazer')] })), null);
  });
});

describe('PARCELAS_FUTURAS_ALTAS (> 30% da renda média)', () => {
  const futuras = (valor) => ['2026-11-01', '2026-12-01', '2027-01-01'].map((c) => parc(c, valor, 'lazer', { forma_pagamento: 'credito', total: 6 }));
  test('dispara com 35%', () => {
    const a = regra('PARCELAS_FUTURAS_ALTAS').avaliar(ctx({ parcelas: futuras(350000) }));
    assert.equal(a.dados.mediaParcelas, 350000);
    assert.equal(a.dados.rendaMedia, 1000000);
  });
  test('30% não dispara', () => assert.equal(regra('PARCELAS_FUTURAS_ALTAS').avaliar(ctx({ parcelas: futuras(300000) })), null));
  test('parcelas no PIX/débito não contam', () => {
    assert.equal(regra('PARCELAS_FUTURAS_ALTAS').avaliar(ctx({ parcelas: futuras(900000).map((p) => ({ ...p, forma_pagamento: 'boleto' })) })), null);
  });
});

describe('FIXOS_ACIMA_LIMITE (> 50% da renda)', () => {
  test('dispara com 60%', () => assert.ok(regra('FIXOS_ACIMA_LIMITE').avaliar(ctx({ resumo: [linha(OUT, 1000000, 700000, 600000)] }))));
  test('50% não dispara', () => assert.equal(regra('FIXOS_ACIMA_LIMITE').avaliar(ctx({ resumo: [linha(OUT, 1000000, 700000, 500000)] })), null));
});

describe('POUPANCA_BAIXA (< 10%)', () => {
  test('5% atenção', () => assert.equal(regra('POUPANCA_BAIXA').avaliar(ctx({ resumo: [linha(OUT, 1000000, 950000)] })).severidade, 'atencao'));
  test('negativa é crítica', () => assert.equal(regra('POUPANCA_BAIXA').avaliar(ctx({ resumo: [linha(OUT, 1000000, 1100000)] })).severidade, 'critico'));
  test('10% não dispara', () => assert.equal(regra('POUPANCA_BAIXA').avaliar(ctx({ resumo: [linha(OUT, 1000000, 900000)] })), null));
});

describe('MUITAS_COMPRAS_PEQUENAS (> 15 abaixo de R$ 30 em delivery)', () => {
  const compras = (n, valor = 2500, cat = 'deliv') => Array.from({ length: n }, () => parc(OUT, valor, cat));
  test('16 dispara', () => assert.equal(regra('MUITAS_COMPRAS_PEQUENAS').avaliar(ctx({ parcelas: compras(16) })).dados.quantidade, 16));
  test('15 não dispara', () => assert.equal(regra('MUITAS_COMPRAS_PEQUENAS').avaliar(ctx({ parcelas: compras(15) })), null));
  test('R$ 30 ou mais não conta', () => assert.equal(regra('MUITAS_COMPRAS_PEQUENAS').avaliar(ctx({ parcelas: compras(20, LIMITES.comprasPequenasValor) })), null));
  test('outra categoria não conta', () => assert.equal(regra('MUITAS_COMPRAS_PEQUENAS').avaliar(ctx({ parcelas: compras(20, 1000, 'merc') })), null));
});

describe('REVISAR_ASSINATURAS (trimestral)', () => {
  const recorrencias = [
    { user_id: 'renan', tipo: 'despesa', descricao: 'Streaming', valor_centavos: 3990, categoria_id: 'assin', ativa: true, data_inicio: '2026-01-01', data_fim: null },
    { user_id: 'renan', tipo: 'despesa', descricao: 'Aluguel', valor_centavos: 200000, categoria_id: 'mor', ativa: true, data_inicio: '2026-01-01', data_fim: null },
  ];
  test('outubro: lista as assinaturas (e só elas)', () => {
    const a = regra('REVISAR_ASSINATURAS').avaliar(ctx({ recorrencias }));
    assert.equal(a.severidade, 'info');
    assert.deepEqual(a.dados.assinaturas.map((x) => x.descricao), ['Streaming']);
  });
  test('novembro não dispara', () => {
    assert.equal(regra('REVISAR_ASSINATURAS').avaliar(ctx({ recorrencias, competencia: '2026-11-01', resumo: [linha('2026-11-01', 1, 0)] })), null);
  });
});

describe('SEM_RECEITA (lembrete)', () => {
  test('mês passado sem ganho dispara', () => {
    assert.ok(regra('SEM_RECEITA').avaliar(ctx({ resumo: [linha(OUT, 0, 100000)], hoje: '2026-11-03' })));
  });
  test('mês atual antes do dia 10: ainda é cedo', () => {
    assert.equal(regra('SEM_RECEITA').avaliar(ctx({ resumo: [linha(OUT, 0, 100000)], hoje: '2026-10-05' })), null);
  });
  test('mês futuro não dispara', () => {
    assert.equal(regra('SEM_RECEITA').avaliar(ctx({ resumo: [], hoje: '2026-09-20' })), null);
  });
});

describe('Resultado e tarefas', () => {
  test('ordena do mais grave para o menos grave', () => {
    const r = avaliar(ctx({ resumo: [linha(OUT, 1000000, 1100000, 600000)] }));
    assert.equal(r[0].severidade, 'critico');
    assert.ok(r.every((x, i) => i === 0 || ['critico', 'atencao', 'info'].indexOf(r[i - 1].severidade) <= ['critico', 'atencao', 'info'].indexOf(x.severidade)));
  });
  test('não sugere tarefa de regra que já tem tarefa aberta', () => {
    const alertas = avaliar(ctx({ resumo: [linha(OUT, 1000000, 1100000, 600000)] }));
    const abertas = [{ regra_codigo: 'DESPESA_MAIOR_RECEITA', status: 'aberta' }, { regra_codigo: 'POUPANCA_BAIXA', status: 'feita' }];
    const novas = tarefasNovas(alertas, abertas);
    assert.ok(!novas.some((t) => t.regra_codigo === 'DESPESA_MAIOR_RECEITA'));
    assert.ok(novas.some((t) => t.regra_codigo === 'POUPANCA_BAIXA'), 'feita pode abrir de novo');
    assert.ok(novas.every((t) => t.origem === 'regra' && t.user_id === null));
  });
});
