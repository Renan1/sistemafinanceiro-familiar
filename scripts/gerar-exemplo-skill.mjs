/**
 * scripts/gerar-exemplo-skill.mjs — Gera claude-skill/consultor-financeiro/exemplos/export-exemplo.json
 *
 * Usa o PRÓPRIO montarExport() do app com dados FICTÍCIOS, para o exemplo da
 * Skill ter sempre o formato real. Rode depois de mudar js/exportacao.js:
 *   node scripts/gerar-exemplo-skill.mjs
 * (tests/js/skill.test.js falha se o exemplo ficar desatualizado.)
 */
import { montarExport } from '../js/exportacao.js';
import { writeFileSync } from 'node:fs';
const OUT = '2026-10-01';
const membros = [{ id: 'r', nome: 'Renan' }, { id: 'c', nome: 'Camilla' }];
const categorias = [['merc','Alimentação/Mercado'],['deliv','Restaurante/Delivery'],['transp','Transporte/Combustível'],['mor','Moradia'],['contas','Contas'],['saude','Saúde'],['lazer','Lazer'],['assin','Assinaturas'],['sal','Salário'],['pro','Pró-labore'],['free','Freelance/Serviços']].map(([id,nome])=>({id,nome}));
const cartoes = [{ id: 'k1', apelido: 'Nubank Renan' }, { id: 'k2', apelido: 'Itaú Camilla' }];
const meses = ['2026-05-01','2026-06-01','2026-07-01','2026-08-01','2026-09-01','2026-10-01'];
const resumo = meses.flatMap((c, i) => {
  const l = (user_id, rec, desp, fix) => ({ competencia: c, user_id, receitas_centavos: rec, despesas_centavos: desp, despesas_fixas_centavos: fix, despesas_variaveis_centavos: desp - fix, despesas_cartao_centavos: Math.round(desp * 0.45), saldo_centavos: rec - desp, taxa_poupanca_pct: Math.round(1000*(rec-desp)/rec)/10 });
  const dR = 520000 + i * 18000, dC = 330000 + i * 12000;
  return [l('r', 750000, dR, 310000), l('c', 480000, dC, 150000), l(null, 1230000, dR + dC, 460000)];
});
const d = (id, user_id, data_compra, v, cat, forma, extra = {}) => ({ id, user_id, data_compra, valor_total_centavos: v, categoria_id: cat, forma_pagamento: forma, qtd_parcelas: 1, natureza: 'variavel', descricao: null, ...extra });
const despesas = [
  d('1','r','2026-10-10',250000,'mor','boleto',{ natureza:'fixa', recorrencia_id:'x', descricao:'Aluguel' }),
  d('2','r','2026-10-15',11990,'contas','debito',{ natureza:'fixa', recorrencia_id:'x', descricao:'Internet' }),
  d('3','c','2026-10-05',5590,'assin','credito',{ cartao_id:'k2', natureza:'fixa', recorrencia_id:'x', descricao:'Streaming' }),
  d('4','r','2026-10-04',68500,'merc','debito',{ local_nome:'Supermercado' }),
  d('5','c','2026-10-18',41200,'merc','pix'),
  ...Array.from({ length: 18 }, (_, i) => d(`6${i}`, i % 2 ? 'c' : 'r', `2026-10-${String(2 + i).padStart(2,'0')}`, 1800 + (i % 5) * 450, 'deliv', 'credito', { cartao_id: i % 2 ? 'k2' : 'k1', descricao: 'Lanche' })),
  d('7','r','2026-10-20',360000,'lazer','credito',{ cartao_id:'k1', qtd_parcelas: 6, descricao:'Passagens férias', valor_a_vista_centavos: 330000 }),
  d('8','c','2026-10-22',32000,'saude','pix',{ descricao:'Farmácia' }),
  d('9','r','2026-10-12',28000,'transp','credito',{ cartao_id:'k1', descricao:'Combustível' }),
];
const receitas = [
  { user_id:'r', data:'2026-10-05', valor_centavos: 750000, categoria_id:'sal', natureza:'fixa', recorrencia_id:'x', descricao:'Salário' },
  { user_id:'c', data:'2026-10-05', valor_centavos: 420000, categoria_id:'pro', natureza:'fixa', recorrencia_id:'x', descricao:'Pró-labore' },
  { user_id:'c', data:'2026-10-19', valor_centavos: 60000, categoria_id:'free', natureza:'variavel', descricao:'Projeto extra' },
];
const parcelas = [
  ...despesas.filter(x=>x.qtd_parcelas===1).map(x=>({ user_id:x.user_id, competencia:OUT, valor_centavos:x.valor_total_centavos, categoria_id:x.categoria_id, forma_pagamento:x.forma_pagamento })),
  ...[1,2,3,4,5].map(n=>({ user_id:'r', competencia:`2026-${String(10+n>12?(10+n-12):10+n).padStart(2,'0')}-01`.replace(/^2026-0([1-3])/, '2027-0$1'), valor_centavos:60000, categoria_id:'lazer', forma_pagamento:'credito' })),
  { user_id:'r', competencia:OUT, valor_centavos:60000, categoria_id:'lazer', forma_pagamento:'credito' },
];
// Resumo de outubro coerente com os lançamentos (pela competência).
for (const quem of ['r', 'c', null]) {
  const minhas = parcelas.filter((p) => p.competencia === OUT && (quem === null || p.user_id === quem));
  const fixos = despesas.filter((x) => x.natureza === 'fixa' && (quem === null || x.user_id === quem)).reduce((s, x) => s + x.valor_total_centavos, 0);
  const desp = minhas.reduce((s, p) => s + p.valor_centavos, 0);
  const rec = receitas.filter((x) => quem === null || x.user_id === quem).reduce((s, x) => s + x.valor_centavos, 0);
  const cartao = minhas.filter((p) => p.forma_pagamento === 'credito').reduce((s, p) => s + p.valor_centavos, 0);
  Object.assign(resumo.find((l) => l.competencia === OUT && l.user_id === quem), {
    receitas_centavos: rec, despesas_centavos: desp, despesas_fixas_centavos: fixos, despesas_variaveis_centavos: desp - fixos,
    despesas_cartao_centavos: cartao, saldo_centavos: rec - desp, taxa_poupanca_pct: Math.round(1000 * (rec - desp) / rec) / 10 });
}
const orcamentos = [{ categoria_id:'merc', user_id:null, valor_mensal_centavos:120000 },{ categoria_id:'deliv', user_id:null, valor_mensal_centavos:30000 },{ categoria_id:'lazer', user_id:null, valor_mensal_centavos:50000 }];
const insights = [
  { regra_codigo:'ORCAMENTO_CATEGORIA', severidade:'critico', mensagem:'Orçamento estourado: Restaurante/Delivery 158%, Lazer 120%.', user_id:null },
  { regra_codigo:'MUITAS_COMPRAS_PEQUENAS', severidade:'info', mensagem:'18 compras pequenas (< R$ 30,00) em lanches/delivery somaram R$ 472,50 no mês.', user_id:null },
  { regra_codigo:'REVISAR_ASSINATURAS', severidade:'info', mensagem:'Revisão trimestral: 1 assinatura(s) somando R$ 55,90/mês — Streaming.', user_id:null },
];
const tarefas = [{ titulo:'Segurar gastos em Lazer, Restaurante/Delivery', descricao:null, prioridade:1, status:'aberta', origem:'regra', user_id:null }];
const recorrencias = [
  { tipo:'receita', descricao:'Salário', valor_centavos:750000, dia_do_mes:5, categoria_id:'sal', user_id:'r', forma_pagamento:null, data_inicio:'2026-01-01', data_fim:null, ativa:true },
  { tipo:'receita', descricao:'Pró-labore', valor_centavos:420000, dia_do_mes:5, categoria_id:'pro', user_id:'c', forma_pagamento:null, data_inicio:'2026-01-01', data_fim:null, ativa:true },
  { tipo:'despesa', descricao:'Aluguel', valor_centavos:250000, dia_do_mes:10, categoria_id:'mor', user_id:'r', forma_pagamento:'boleto', data_inicio:'2026-01-01', data_fim:null, ativa:true },
  { tipo:'despesa', descricao:'Internet', valor_centavos:11990, dia_do_mes:15, categoria_id:'contas', user_id:'r', forma_pagamento:'debito', data_inicio:'2026-01-01', data_fim:null, ativa:true },
  { tipo:'despesa', descricao:'Streaming', valor_centavos:5590, dia_do_mes:5, categoria_id:'assin', user_id:'c', forma_pagamento:'credito', data_inicio:'2026-03-01', data_fim:null, ativa:true },
];
const exp = montarExport({ competencia: OUT, familia: { nome: 'Família Exemplo' }, membros, categorias, cartoes, recorrencias,
  dados: { resumo, despesas, receitas, parcelas, orcamentos, insights, tarefas }, geradoEm: '2026-11-02T09:00:00.000Z' });
writeFileSync(new URL('../claude-skill/consultor-financeiro/exemplos/export-exemplo.json', import.meta.url), JSON.stringify(exp, null, 2) + '\n');
console.log('ok', Object.keys(exp).join(','));
