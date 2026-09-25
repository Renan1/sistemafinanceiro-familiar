/**
 * tests/js/importacao.test.js — Importar extrato e fatura (v1.3)
 *
 * Os arquivos abaixo são FICTÍCIOS, com a mesma estrutura dos arquivos reais
 * de cada banco (cabeçalhos, formatos de data e valor, linhas de saldo,
 * pagamento, estorno, parcelas). Dados reais nunca entram no repositório.
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  consertarTexto, limparDescricao, chaveComerciante, lerParcela, lerData, lerValorComSinal, lerCSV,
  lerNubankCSV, lerItauFatura, lerItauConta, lerOFX, lerArquivo, analisar, montarLancamento,
  regrasAprendidas, sugerirCategoria, sugerirCartao, resumo, formaDaConta,
} from '../../js/importacao.js';

const U = 'user-renan';
const NOMES_D = ['Alimentação/Mercado', 'Restaurante/Delivery', 'Transporte/Combustível', 'Moradia', 'Contas', 'Saúde',
  'Lazer', 'Assinaturas', 'Manutenção', 'Impostos/Taxas', 'Outros'];
const NOMES_R = ['Salário', 'Pró-labore', 'Rendimentos/Investimentos', 'Reembolso', 'Outros'];
const categorias = [...NOMES_D.map((nome, i) => ({ id: `d${i}`, nome, tipo: 'despesa' })),
  ...NOMES_R.map((nome, i) => ({ id: `r${i}`, nome, tipo: 'receita' }))];
const cat = (nome, tipo = 'despesa') => categorias.find((c) => c.nome === nome && c.tipo === tipo).id;
const nubank = { id: 'k-nu', user_id: U, apelido: 'Nubank Renan', ultimos4: '1111', dia_fechamento: 7, dia_vencimento: 14, ativo: true };
const itau = { id: 'k-it', user_id: U, apelido: 'Itaú Uniclass', ultimos4: '1234', dia_fechamento: 30, dia_vencimento: 6, ativo: true };
const perfil = { id: U, household_id: 'hh' };

// ---------------------------------------------------------------------------
// Arquivos fictícios
// ---------------------------------------------------------------------------
const NUBANK_SET = `date,title,amount
2026-09-04,"Estorno de ""Lojaxyz*Teste"" (Loja XYZ)","- 15,94"
2026-08-30,Lojaxyz*Teste,"15,94"
2026-08-18,Google One,"9,99"
2026-08-15,Loja Qualquer,"1.235,87"
2026-08-11,Pagamento recebido,"- 1.440,47"
2026-08-07,Clube Teste - Parcela 9/12,"19,90"
2026-08-07,Loja Grande - Parcela 1/3,"300,00"
`;
const NUBANK_OUT = `date,title,amount
2026-09-15,Google One,"9,99"
2026-09-10,Pagamento recebido,"- 1.580,76"
2026-09-07,Clube Teste - Parcela 10/12,"19,90"
2026-09-07,Loja Grande - Parcela 2/3,"300,00"
`;

// Fatura Itaú (.xlsx) como a planilha chega do worker (sheet_to_json, header: 1).
const ITAU_FATURA = [{ nome: 'Fatura 07-26', linhas: [
  [' ', null, null, null, null, null, null, null, null, null],
  [null, 'Nome', 'Fulano Teste', null, null, null, null, null, null, null],
  [null, 'Fatura Paga - Julho/2026', null, null, null, null, null, null, null, null],
  [null, 'Cartão', null, null, null, null, 'Valor', null, 'Vencimento', null],
  [null, 'Itau Teste Platinum Mastercard - final 1234', null, 'Você pagou R$ 448,59', null, null, 448.59, null, 46209, null],
  [null, 'Lançamentos', null, null, null, null, null, null, null, null],
  [null, 'Data', 'Lançamento', 'Parcelamento', 'Valor', null, 'Titularidade', 'Nome', 'Tipo do cartão', 'Número do cartão'],
  [null, 46174, 'Pagamento Efetuado', null, -500, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, 46214, 'Controle De Saldo', null, 0, null, 'Titular', 'F Teste', 'Físico', '****1234'],
  [null, 46200, 'Burger Teste           Cidade Teste  Bra', null, 175.4, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, 46199, 'Anuidade Diferenci', 'Parcela 1 de 12', 60, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, 46182, 'Loja Parcelada .      ', 'Parcela 4 de 4', 82.39, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, 46192, 'Paddle.net* Apptestelondongbr', null, 29.76, 'USD 5,50 \n(cotação R$ 5,41)', 'Titular', 'F Teste', 'Físico', '****1234'],
  [null, 46192, 'Iof Internacional - Paddle.net* Apptestelondongbr', null, 1.04, null, 'Titular', 'F Teste', 'Físico', '****1234'],
  [null, 46196, 'Tagitau*fulano        Sao Paulo     Bra', null, 50, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, 46196, 'Tagitau*fulano        Sao Paulo     Bra', null, 50, null, 'Titular', 'F Teste', 'Físico', '****9999'],
  [null, null, null, null, null, null, null, null, null, null],
  [null, null, null, 'Subtotal  ', null, null, null, null, null, null],
] }];

// Extrato da conta Itaú (.xls), com o acento "quebrado" como vem no arquivo real.
const ITAU_CONTA = [{ nome: 'Lançamentos', linhas: [
  ['Logotipo Itaú', null, null, null, null],
  ['Nome:', 'FULANO TESTE', null, null, null],
  ['data', 'lanÃ§amento', 'ag./origem', 'valor (R$)', 'saldos (R$)'],
  ['lançamentos', '', '', '', ''],
  ['31/07/2026', 'SALDO ANTERIOR', '', '', 1000],
  ['03/08/2026', 'SALDO TOTAL DISPONÃ\u008dVEL DIA', '', '', 900],
  ['03/08/2026', 'PIX QRS PADARIA TES03/08', '', -17, ''],
  ['04/08/2026', 'FATURA PAGA Itau Uniclas', '', -142.39, ''],
  ['04/08/2026', 'PAG BOLETO NU PAGAMENTOS SA', '', -1440.47, ''],
  ['04/08/2026', 'PAG BOLETO ENERGIA TESTE SA', '', -193.52, ''],
  ['04/08/2026', 'REND PAGO APLIC AUT MAIS', '', 0.82, ''],
  ['04/08/2026', 'TAR PACOTE ITAU JUL/26', '', -79, ''],
  ['06/08/2026', 'SISPAG PIX EMPRESA TESTE LTDA', '', 5000, ''],
  ['10/08/2026', 'PAY Drogari 10/08', '', -45.5, ''],
  ['14/08/2026', 'RESGATE CDB DI', '', 1200.05, ''],
  ['14/08/2026', 'APLICACAO CDB DI', '', -300, ''],
  ['15/08/2026', 'PIX TRANSF FULANA15/08', '', 250, ''],
] }];

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905120000[-3:BRT]<TRNAMT>-45.90<FITID>A1<MEMO>Compra no débito - Padaria Teste
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260906<TRNAMT>1500.00<FITID>A2<MEMO>Transferência recebida
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

// ===========================================================================
describe('texto, data e valor', () => {
  test('conserta acento quebrado e não mexe em texto certo', () => {
    assert.equal(consertarTexto('SALDO TOTAL DISPONÃ\u008dVEL DIA'), 'SALDO TOTAL DISPONÍVEL DIA');
    assert.equal(consertarTexto('lançamento'), 'lançamento');
  });
  test('descrição limpa: sem cidade/país, sem data grudada, sem "Parcela"', () => {
    assert.equal(limparDescricao('Burger Teste           Cidade Teste  Bra'), 'Burger Teste');
    assert.equal(limparDescricao('Zp     *Loja Tag Itasao Paulobra'), 'Zp*Loja Tag Itasao Paulobra');
    assert.equal(limparDescricao('PIX QRS PADARIA TES03/08'), 'PIX QRS PADARIA TES');
    assert.equal(limparDescricao('Clube Teste - Parcela 9/12'), 'Clube Teste');
  });
  test('chave do lugar igual no Nubank e no Itaú; sem prefixo do banco', () => {
    assert.equal(chaveComerciante('Mercadolivre*mercadol  Santo Andre   Bra'), 'mercadolivre mercadol');
    assert.equal(chaveComerciante('Mercadolivre*Mercadol'), 'mercadolivre mercadol');
    assert.equal(chaveComerciante('Ebn *Playstation - Parcela 3/4'), 'playstation');
    assert.equal(chaveComerciante('PIX QRS PADARIA TES03/08'), 'padaria tes');
    assert.equal(chaveComerciante('Estorno de "Lojaxyz*Teste" (Loja XYZ)'), 'lojaxyz teste');
  });
  test('parcela, data e valor com sinal', () => {
    assert.deepEqual(lerParcela('Clube - Parcela 9/12'), { k: 9, n: 12 });
    assert.deepEqual(lerParcela(null, 'Parcela 1 de 16'), { k: 1, n: 16 });
    assert.equal(lerParcela('Loja'), null);
    assert.equal(lerData(46209), '2026-07-06');
    assert.equal(lerData('03/08/2026'), '2026-08-03');
    assert.equal(lerValorComSinal('- 1.440,47'), -144047);
    assert.equal(lerValorComSinal('15,94'), 1594);
    assert.equal(lerValorComSinal(-1219.9), -121990);
  });
  test('CSV com aspas escapadas', () => {
    assert.deepEqual(lerCSV('a,b\n"x ""y"", z",1\n'), [['a', 'b'], ['x "y", z', '1']]);
  });
  test('forma de pagamento das saídas da conta', () => {
    assert.equal(formaDaConta('PIX QRS PADARIA'), 'pix');
    assert.equal(formaDaConta('PAG BOLETO ENERGIA'), 'boleto');
    assert.equal(formaDaConta('PAY Drogari 10/08'), 'debito');
  });
});

describe('leitores', () => {
  test('Nubank: vencimento pelo nome do arquivo, sinais e parcelas', () => {
    const a = lerNubankCSV(NUBANK_SET, 'Nubank_2026-09-14.csv');
    assert.equal(a.tipo, 'cartao');
    assert.equal(a.vencimento, '2026-09-14');
    assert.equal(a.linhas.length, 7);
    assert.equal(a.linhas[0].valor, -1594);
    assert.deepEqual(a.linhas[5].parcela, { k: 9, n: 12 });
  });
  test('Itaú fatura: vencimento, final do cartão, sem "Controle de Saldo" (0) nem "Subtotal"', () => {
    const a = lerItauFatura(ITAU_FATURA);
    assert.equal(a.vencimento, '2026-07-06');
    assert.equal(a.finalCartao, '1234');
    assert.equal(a.titulo, 'Fatura Paga - Julho/2026');
    assert.equal(a.linhas.length, 8);
    assert.deepEqual(a.linhas.find((l) => /Anuidade/.test(l.descricao)).parcela, { k: 1, n: 12 });
    assert.match(a.linhas.find((l) => /^Paddle/.test(l.descricao)).extra, /USD 5,50/);
  });
  test('Itaú conta: pula linhas de SALDO; negativo no extrato = saída (positivo aqui)', () => {
    const a = lerItauConta(ITAU_CONTA);
    assert.equal(a.tipo, 'conta');
    assert.equal(a.linhas.length, 11);
    assert.equal(a.linhas[0].valor, 1700);
    assert.equal(a.linhas.find((l) => /SISPAG/.test(l.descricao)).valor, -500000);
  });
  test('OFX: data, valor e descrição', () => {
    const a = lerOFX(OFX);
    assert.equal(a.tipo, 'conta');
    assert.deepEqual(a.linhas.map((l) => [l.data, l.valor]), [['2026-09-05', 4590], ['2026-09-06', -150000]]);
  });
  test('lerArquivo reconhece cada formato e recusa o desconhecido', () => {
    assert.equal(lerArquivo('Nubank_2026-09-14.csv', { texto: NUBANK_SET }).formato, 'nubank-fatura');
    assert.equal(lerArquivo('fatura.xlsx', { abas: ITAU_FATURA }).formato, 'itau-fatura');
    assert.equal(lerArquivo('extrato.xls', { abas: ITAU_CONTA }).formato, 'itau-conta');
    assert.equal(lerArquivo('x.ofx', { texto: OFX }).formato, 'ofx-conta');
    assert.throws(() => lerArquivo('x.csv', { texto: 'a,b,c\n1,2,3' }), /não reconhecido/);
  });
  test('sugere o cartão: pelo final (Itaú) ou pelo banco no apelido (Nubank)', () => {
    assert.equal(sugerirCartao(lerItauFatura(ITAU_FATURA), [nubank, itau], U).id, 'k-it');
    assert.equal(sugerirCartao(lerNubankCSV(NUBANK_SET, 'n.csv'), [nubank, itau], U).id, 'k-nu');
  });
});

describe('análise da fatura do cartão (Nubank)', async () => {
  const arquivo = lerNubankCSV(NUBANK_SET, 'Nubank_2026-09-14.csv');
  const itens = await analisar({ arquivo, userId: U, cartao: nubank, competencia: '2026-09-01', categorias });
  const por = (re) => itens.find((i) => re.test(i.linha.descricao) && i.linha.valor > 0) ?? itens.find((i) => re.test(i.linha.descricao));

  test('pagamento da fatura e compra estornada no mesmo mês não viram gasto', () => {
    assert.equal(por(/Pagamento recebido/).situacao, 'ignorado');
    assert.equal(por(/^Lojaxyz/).situacao, 'ignorado');
    assert.equal(itens.find((i) => /^Estorno/.test(i.linha.descricao)).situacao, 'ignorado');
  });
  test('total dos novos = total das compras da fatura', () => {
    const r = resumo(itens);
    assert.equal(r.porSituacao.novo, 4);
    assert.equal(r.gastos, 999 + 123587 + 1990 + 30000);
  });
  test('"Parcela 9/12" vira compra com as parcelas 9 a 12, nas faturas certas', () => {
    const it = por(/Clube Teste/);
    assert.deepEqual(it.parcelas.map((p) => p.competencia), ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']);
    assert.equal(it.parcelas[0].data_vencimento, '2026-09-14');
    assert.ok(it.parcelas.every((p) => p.valor_centavos === 1990));
  });
  test('categoria sugerida pelo dicionário (Google One → Assinaturas); desconhecido → Outros', () => {
    assert.equal(por(/Google One/).categoriaId, cat('Assinaturas'));
    assert.equal(por(/Loja Qualquer/).categoriaId, cat('Outros'));
    assert.equal(por(/Loja Qualquer/).fonteCategoria, 'padrao');
  });
  test('id fixo por linha: mesma linha → mesmo id (reimportar não duplica)', async () => {
    const de_novo = await analisar({ arquivo, userId: U, cartao: nubank, competencia: '2026-09-01', categorias });
    assert.deepEqual(de_novo.map((i) => i.id), itens.map((i) => i.id));
    const ids = new Set(itens.filter((i) => i.situacao === 'novo').map((i) => i.id));
    const reimport = await analisar({ arquivo, userId: U, cartao: nubank, competencia: '2026-09-01', categorias, existentes: { idsExistentes: ids } });
    assert.equal(reimport.filter((i) => i.situacao === 'ja_importado').length, 4);
    assert.equal(reimport.filter((i) => i.selecionado).length, 0);
  });
  test('fatura do mês seguinte: "Parcela 10/12" e "2/3" já lançadas não entram de novo', async () => {
    // Simula o banco depois da 1ª importação (parcelas geradas por montarLancamento).
    const gravados = itens.filter((i) => i.situacao === 'novo').map((i) => montarLancamento(i, { arquivo, perfil, cartao: nubank }));
    const existentes = {
      idsExistentes: new Set(gravados.map((g) => g.id)),
      despesas: gravados.map((g) => g.dados),
      parcelas: gravados.flatMap((g) => g.parcelas.map((p) => ({ ...p, despesa_id: g.id, cartao_id: g.dados.cartao_id }))),
    };
    const out = await analisar({ arquivo: lerNubankCSV(NUBANK_OUT, 'Nubank_2026-10-14.csv'), userId: U, cartao: nubank,
      competencia: '2026-10-01', categorias, existentes });
    const s = (re) => out.find((i) => re.test(i.linha.descricao)).situacao;
    assert.equal(s(/Clube Teste - Parcela 10/), 'provavel_duplicado');
    assert.equal(s(/Loja Grande - Parcela 2/), 'provavel_duplicado');
    assert.equal(s(/Google One/), 'novo', 'assinatura do mês é compra nova');
  });
  test('compra já lançada à mão (ou pela Carteira) no mesmo cartão e valor → "parece já lançado"', async () => {
    const existentes = { despesas: [{ id: 'm1', descricao: 'Google', forma_pagamento: 'credito', data_compra: '2026-08-18' }],
      parcelas: [{ despesa_id: 'm1', cartao_id: 'k-nu', competencia: '2026-08-01', valor_centavos: 999 }] };
    const r = await analisar({ arquivo, userId: U, cartao: nubank, competencia: '2026-09-01', categorias, existentes });
    const g = r.find((i) => /Google One/.test(i.linha.descricao));
    assert.equal(g.situacao, 'provavel_duplicado');
    assert.match(g.motivo, /Google/);
  });
});

describe('análise da fatura Itaú e do extrato da conta', async () => {
  test('fatura Itaú: soma dos novos = valor pago; IOF → Impostos/Taxas; parcela 1 de 12 → 12 parcelas', async () => {
    const arquivo = lerItauFatura(ITAU_FATURA);
    const itens = await analisar({ arquivo, userId: U, cartao: itau, competencia: '2026-07-01', categorias });
    assert.equal(resumo(itens).gastos, 44859, 'igual ao "Você pagou" da fatura');
    assert.equal(itens.find((i) => /^Iof/.test(i.linha.descricao)).categoriaId, cat('Impostos/Taxas'));
    assert.equal(itens.find((i) => /Anuidade/.test(i.linha.descricao)).parcelas.length, 12);
    const tags = itens.filter((i) => /Tagitau/.test(i.linha.descricao));
    assert.equal(tags.length, 2);
    assert.notEqual(tags[0].id, tags[1].id, 'duas linhas iguais no mesmo dia são 2 lançamentos');
  });

  const arquivo = lerItauConta(ITAU_CONTA);
  const existentes = {
    despesas: [{ id: 'm2', data_compra: '2026-08-05', valor_total_centavos: 19352, forma_pagamento: 'boleto', descricao: 'Conta de luz' }],
    receitas: [],
  };
  const itens = await analisar({ arquivo, userId: U, categorias, existentes });
  const por = (re) => itens.find((i) => re.test(i.linha.descricao));

  test('não é gasto nem ganho: fatura paga, fatura do Nubank, aplicação, resgate, rendimento automático', () => {
    for (const re of [/FATURA PAGA/, /NU PAGAMENTOS/, /APLICACAO CDB/, /RESGATE/, /REND PAGO/]) {
      assert.equal(por(re).situacao, 'ignorado', String(re));
      assert.equal(por(re).selecionado, false);
    }
  });
  test('saídas viram gasto com a forma certa; entradas viram ganho', () => {
    assert.deepEqual([por(/PADARIA/).tipo, por(/PADARIA/).forma, por(/PADARIA/).categoriaId], ['despesa', 'pix', cat('Alimentação/Mercado')]);
    assert.equal(por(/TAR PACOTE/).categoriaId, cat('Impostos/Taxas'));
    assert.deepEqual([por(/PAY Drogari/).forma, por(/PAY Drogari/).categoriaId], ['debito', cat('Saúde')]);
    assert.deepEqual([por(/SISPAG/).tipo, por(/SISPAG/).categoriaId], ['receita', cat('Salário', 'receita')]);
    assert.deepEqual([por(/FULANA/).tipo, por(/FULANA/).categoriaId], ['receita', cat('Outros', 'receita')]);
  });
  test('conta de luz já lançada à mão (1 dia de diferença, mesmo valor) → "parece já lançado"', () => {
    assert.equal(por(/ENERGIA/).situacao, 'provavel_duplicado');
    assert.match(por(/ENERGIA/).motivo, /Conta de luz/);
  });
  test('montarLancamento: gasto da conta e ganho no formato da fila', () => {
    const g = montarLancamento(por(/PADARIA/), { arquivo, perfil });
    assert.equal(g.tipo, 'despesa');
    assert.deepEqual([g.dados.origem, g.dados.forma_pagamento, g.dados.cartao_id, g.dados.qtd_parcelas, g.dados.valor_total_centavos],
      ['importacao_conta', 'pix', null, 1, 1700]);
    const r = montarLancamento(por(/SISPAG/), { arquivo, perfil });
    assert.deepEqual([r.tipo, r.dados.valor_centavos, r.dados.household_id, r.dados.origem], ['receita', 500000, 'hh', 'importacao_conta']);
  });
});

describe('aprender com as correções', async () => {
  test('categoria trocada → regra; na próxima vez a sugestão vem da regra', async () => {
    const arquivo = lerItauConta(ITAU_CONTA);
    const itens = await analisar({ arquivo, userId: U, categorias });
    const fulana = itens.find((i) => /FULANA/.test(i.linha.descricao));
    fulana.categoriaId = cat('Reembolso', 'receita');
    const regras = regrasAprendidas(itens);
    assert.deepEqual(regras, [{ tipo: 'receita', padrao: 'fulana', categoria_id: cat('Reembolso', 'receita') }]);
    assert.deepEqual(sugerirCategoria('PIX TRANSF FULANA02/09', 'receita', { regras, categorias }),
      { categoriaId: cat('Reembolso', 'receita'), fonte: 'aprendida' });
  });
  test('fatura do cartão: montarLancamento com parcelas, cartão e origem', async () => {
    const arquivo = lerNubankCSV(NUBANK_SET, 'Nubank_2026-09-14.csv');
    const itens = await analisar({ arquivo, userId: U, cartao: nubank, competencia: '2026-09-01', categorias });
    const l = montarLancamento(itens.find((i) => /Clube Teste/.test(i.linha.descricao)), { arquivo, perfil, cartao: nubank });
    assert.deepEqual([l.dados.qtd_parcelas, l.dados.valor_total_centavos, l.dados.cartao_id, l.dados.forma_pagamento, l.dados.origem],
      [4, 7960, 'k-nu', 'credito', 'importacao_fatura']);
    assert.equal(l.dados.descricao, 'Clube Teste (9/12)');
    assert.match(l.dados.observacao, /parcela 9 de 12/);
  });
});
