/**
 * tests/js/exportacao.test.js — Export JSON/CSV e importação de tarefas do Claude
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarExport, montarCSV, lerTarefasDoClaude, semDuplicadas, FORMATO_EXPORT, nomeArquivo } from '../../js/exportacao.js';

const OUT = '2026-10-01';
const membros = [{ id: 'r', nome: 'Renan', email: 'renan@x.com' }, { id: 'c', nome: 'Camilla' }];
const categorias = [{ id: 'merc', nome: 'Alimentação/Mercado' }, { id: 'sal', nome: 'Salário' }, { id: 'laz', nome: 'Lazer' }];
const cartoes = [{ id: 'k', apelido: 'Nubank' }];
const dados = {
  resumo: [{ competencia: OUT, user_id: null, receitas_centavos: 1000000, despesas_centavos: 300000, despesas_fixas_centavos: 100000, despesas_variaveis_centavos: 200000, despesas_cartao_centavos: 50000, saldo_centavos: 700000, taxa_poupanca_pct: 70 }],
  despesas: [
    { id: 'd1', user_id: 'r', data_compra: '2026-10-03', valor_total_centavos: 12345, descricao: 'Mercado; "promo"', categoria_id: 'merc', forma_pagamento: 'pix', qtd_parcelas: 1, natureza: 'variavel', latitude: -23.5, longitude: -46.6, local_nome: 'Mercado X' },
    { id: 'd2', user_id: 'c', data_compra: '2026-10-10', valor_total_centavos: 90000, descricao: null, categoria_id: 'laz', forma_pagamento: 'credito', cartao_id: 'k', qtd_parcelas: 3, natureza: 'variavel' },
  ],
  receitas: [{ id: 'r1', user_id: 'r', data: '2026-10-05', valor_centavos: 1000000, categoria_id: 'sal', natureza: 'fixa', recorrencia_id: 'rec' }],
  parcelas: [
    { user_id: 'r', competencia: OUT, valor_centavos: 12345, categoria_id: 'merc', forma_pagamento: 'pix' },
    { user_id: 'c', competencia: '2026-11-01', valor_centavos: 30000, categoria_id: 'laz', forma_pagamento: 'credito' },
    { user_id: 'c', competencia: '2026-12-01', valor_centavos: 30000, categoria_id: 'laz', forma_pagamento: 'credito' },
  ],
  orcamentos: [{ categoria_id: 'merc', user_id: null, valor_mensal_centavos: 50000 }],
  insights: [{ regra_codigo: 'POUPANCA_BAIXA', severidade: 'atencao', mensagem: 'x', user_id: null }],
  tarefas: [{ titulo: 'Revisar assinaturas', prioridade: 3, status: 'aberta', origem: 'regra', user_id: null }],
};

describe('Export JSON para o Claude', () => {
  const exp = montarExport({ competencia: OUT, familia: { nome: 'Família Martins' }, membros, categorias, cartoes, recorrencias: [], dados, geradoEm: '2026-11-01T12:00:00Z' });

  test('formato versionado e período', () => {
    assert.equal(exp.formato, FORMATO_EXPORT);
    assert.equal(exp.periodo.rotulo, 'outubro de 2026');
    assert.deepEqual(exp.familia, { nome: 'Família Martins', membros: ['Renan', 'Camilla'] });
  });
  test('usa nomes (pessoa, categoria, cartão), não ids', () => {
    assert.equal(exp.despesas[1].pessoa, 'Camilla');
    assert.equal(exp.despesas[1].categoria, 'Lazer');
    assert.equal(exp.despesas[1].cartao, 'Nubank');
    assert.equal(exp.despesas[1].forma_pagamento, 'Crédito');
    assert.equal(exp.receitas[0].recorrente, true);
    assert.equal(exp.resumo_mensal[0].pessoa, 'Família');
  });
  test('privacidade: sem e-mail, sem GPS, sem ids internos', () => {
    const texto = JSON.stringify(exp);
    assert.ok(!texto.includes('renan@x.com'));
    assert.ok(!texto.includes('-23.5') && !texto.includes('latitude'));
    assert.ok(!texto.includes('"d1"') && !texto.includes('"rec"'));
    assert.equal(exp.despesas[0].local, 'Mercado X', 'nome do local pode ir');
  });
  test('parcelas futuras (12 meses) e orçamento realizado', () => {
    assert.equal(exp.parcelas_futuras.length, 12);
    assert.deepEqual(exp.parcelas_futuras[0], { competencia: '2026-11-01', total: 30000, por_pessoa: { Camilla: 30000 } });
    assert.equal(exp.parcelas_futuras[2].total, 0);
    assert.deepEqual(exp.orcamentos[0], { categoria: 'Alimentação/Mercado', pessoa: 'Família', orcado: 50000, realizado: 12345 });
    assert.deepEqual(exp.gastos_por_categoria, [{ categoria: 'Alimentação/Mercado', total: 12345, pct: 100 }]);
  });
});

describe('CSV', () => {
  const csv = montarCSV({ despesas: dados.despesas, receitas: dados.receitas, membros, categorias, cartoes });
  const linhas = csv.replace('﻿', '').trim().split('\r\n');
  test('BOM para acentos no Excel e separador ";"', () => {
    assert.ok(csv.startsWith('﻿'));
    assert.equal(linhas[0], 'tipo;data;pessoa;categoria;descricao;forma_pagamento;cartao;parcelas;natureza;local;valor');
  });
  test('ordena por data, vírgula decimal e escapa ";" e aspas', () => {
    assert.equal(linhas.length, 4);
    assert.equal(linhas[1], 'gasto;2026-10-03;Renan;Alimentação/Mercado;"Mercado; ""promo""";PIX;;1;variavel;Mercado X;123,45');
    assert.equal(linhas[2], 'ganho;2026-10-05;Renan;Salário;;;;;fixa;;10000,00');
    assert.ok(linhas[3].endsWith('Crédito;Nubank;3;variavel;;900,00'));
  });
  test('nome do arquivo', () => assert.equal(nomeArquivo('2026-10-17', 'csv'), 'financas-2026-10.csv'));
});

describe('Importar tarefas do Claude', () => {
  const resposta = `Aqui estão as tarefas:\n\`\`\`json\n${JSON.stringify({
    formato: 'financas-familia/tarefas@1', competencia: OUT,
    tarefas: [
      { titulo: 'Montar reserva de emergência', descricao: 'Meta 6x fixos', prioridade: 1, responsavel: 'Família' },
      { titulo: 'Cancelar streaming duplicado', prioridade: 3, responsavel: 'camilla' },
      { titulo: 'Rever seguro do carro', prioridade: 9, responsavel: 'Tio João' },
      { titulo: '   ', prioridade: 1 },
    ],
  })}\n\`\`\`\nBoa sorte!`;

  test('lê o bloco ```json no meio do texto e mapeia responsáveis', () => {
    const r = lerTarefasDoClaude(resposta, membros);
    assert.equal(r.competencia, OUT);
    assert.equal(r.tarefas.length, 3);
    assert.deepEqual(r.tarefas[0], { titulo: 'Montar reserva de emergência', descricao: 'Meta 6x fixos', prioridade: 1, user_id: null });
    assert.equal(r.tarefas[1].user_id, 'c', 'nome sem diferenciar maiúsculas');
    assert.equal(r.tarefas[2].prioridade, 2, 'prioridade inválida vira 2');
    assert.equal(r.tarefas[2].user_id, null, 'responsável desconhecido vira Família');
    assert.equal(r.erros.length, 2);
  });
  test('JSON puro também funciona', () => {
    assert.equal(lerTarefasDoClaude('{"formato":"financas-familia/tarefas@1","tarefas":[{"titulo":"A"}]}', membros).tarefas.length, 1);
  });
  test('texto sem JSON / formato errado', () => {
    assert.match(lerTarefasDoClaude('oi', membros).erros[0], /JSON válido/);
    assert.match(lerTarefasDoClaude('{"formato":"outro","tarefas":[]}', membros).erros[0], /Formato inesperado/);
  });
  test('reimportar não duplica tarefas abertas com o mesmo título', () => {
    const novas = [{ titulo: 'Revisar Assinaturas ' }, { titulo: 'Nova' }];
    assert.deepEqual(semDuplicadas(novas, dados.tarefas).map((t) => t.titulo), ['Nova']);
  });
});
