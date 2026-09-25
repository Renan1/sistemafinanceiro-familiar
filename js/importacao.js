/**
 * =============================================================================
 * js/importacao.js — Importar extrato e fatura (v1.3 — RF-17)
 * -----------------------------------------------------------------------------
 * Lê os arquivos que os bancos exportam e transforma cada linha numa
 * SUGESTÃO de lançamento, para a pessoa conferir antes de gravar:
 *
 *   Formato                         | Tipo   | Como chega aqui
 *   --------------------------------+--------+-------------------------------
 *   Nubank — fatura do cartão (CSV) | cartão | texto do arquivo
 *   Itaú — fatura do cartão (.xlsx) | cartão | linhas da planilha (worker)
 *   Itaú — extrato da conta (.xls)  | conta  | linhas da planilha (worker)
 *   OFX (qualquer banco)            | ambos  | texto do arquivo
 *
 * Convenção de sinal em TODO o módulo: valor > 0 = dinheiro SAINDO (gasto);
 * valor < 0 = dinheiro ENTRANDO (ganho, pagamento da fatura, estorno).
 *
 * Etapas (todas funções puras, testadas em tests/js/importacao.test.js):
 *   1. ler*()          arquivo → { tipo, vencimento, finalCartao, linhas }
 *   2. analisar()      linhas → itens com situação (novo / já importado /
 *                      parece já lançado / ignorado), categoria sugerida,
 *                      forma de pagamento e parcelas
 *   3. montarLancamento()  item confirmado → item da fila (js/offline.js),
 *                      o mesmo formato do gasto/ganho digitado no app
 *   4. regrasAprendidas()  categorias trocadas pela pessoa → regras para a
 *                      próxima importação (tabela regras_categoria)
 *
 * NÃO DUPLICA:
 *   * cada linha tem uma chave (arquivo/cartão, data, valor, descrição,
 *     parcela, ocorrência) e um id fixo derivado dela — importar o mesmo
 *     arquivo de novo só encontra "já importado";
 *   * "Parcela 10/12" de uma compra que já está no app (importada antes ou
 *     digitada à mão / pela Carteira) aparece como "parece já lançado";
 *   * pagamento de fatura, aplicação/resgate e estorno não viram gasto.
 *
 * Parcelas da fatura: "Parcela 9 de 12" vira UMA compra com as parcelas
 * 9 a 12 (a atual e as futuras), nas faturas certas — assim o Painel já
 * mostra o que está comprometido nos próximos meses (D-48).
 * =============================================================================
 */
import { lerValorBR, competenciaDe, somarMesesCompetencia, moeda } from './formato.js';
import { diaAjustado, MAX_PARCELAS } from './parcelas.js';
import { normalizar } from './carteira.js';
import { idDeterministico } from './recorrencias.js';

// =============================================================================
// 1. Utilidades de texto, data e valor
// =============================================================================

/**
 * Conserta texto que veio com acento "quebrado" (UTF-8 lido como Latin-1),
 * como "DISPONÃ\u008dVEL" no extrato .xls do Itaú. Texto normal passa intacto.
 */
export function consertarTexto(texto) {
  const t = String(texto ?? '');
  if (!/[ÂÃ][\u0080-¿]/.test(t)) return t;
  try { return decodeURIComponent(escape(t)); } catch { return t; }
}

/**
 * Descrição limpa para mostrar e gravar:
 *   "Burger King            Juiz De Fora  Bra" → "Burger King"
 *   "Zp     *Iupp Tag Itasao Paulobra"          → "Zp*Iupp Tag Itasao Paulobra"
 *   "PIX QRS DUBOM MIX C05/08"                  → "PIX QRS DUBOM MIX C"
 *   "Clube Teste - Parcela 9/12"                → "Clube Teste"
 */
export function limparDescricao(texto) {
  let t = consertarTexto(texto).replace(/ /g, ' ').trim();
  t = t.replace(/\s+\*/g, '*');                          // "Zp     *Iupp" → "Zp*Iupp"
  t = t.split(/\s{2,}/)[0];                              // Itaú: nome  cidade  país
  t = t.replace(/\s*-\s*parcela\s+\d+\s*(\/|de)\s*\d+\s*$/i, '');
  t = t.replace(/\s*\d{2}\/\d{2}$/, '');                 // Itaú conta: data grudada no fim
  return t.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Chave do "lugar", usada para lembrar a categoria (regras aprendidas):
 * sem prefixos do banco (PIX QRS, PAG BOLETO, "Ebn *"…), sem números, sem
 * acento, até 4 palavras. Ex.: "Mercadolivre*mercadol  Santo Andre   Bra" e
 * "Mercadolivre*Mercadol" → "mercadolivre mercadol".
 */
export function chaveComerciante(texto) {
  let t = limparDescricao(texto);
  t = t.replace(/^estorno de\s*"?/i, '').replace(/"\s*\(.*\)\s*$/, '').replace(/"/g, '');
  t = t.replace(/^(pix\s+(qrs|transf|qr)|pag\s+boleto|sispag\s+pix|sispag|pay|ted|doc|tar|compra\s+cartao)\s+/i, '');
  t = t.replace(/^[a-z]{1,4}\*\s*/i, '');                // "Ebn*Playstation" → "Playstation"
  return normalizar(t).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(Boolean).slice(0, 4).join(' ');
}

/** "Parcela 9/12", "Parcela 1 de 16" → { k: 9, n: 12 } (ou null). */
export function lerParcela(...textos) {
  for (const t of textos) {
    const m = /parcela\s+(\d+)\s*(?:\/|de)\s*(\d+)/i.exec(String(t ?? ''));
    if (m && Number(m[1]) >= 1 && Number(m[2]) >= Number(m[1])) return { k: Number(m[1]), n: Number(m[2]) };
  }
  return null;
}

/** Número de série do Excel (46174) → 'AAAA-MM-DD'. */
export function excelParaISO(serie) {
  return new Date(Math.round((Number(serie) - 25569) * 86400000)).toISOString().slice(0, 10);
}

/** 'dd/mm/aaaa' | 'aaaa-mm-dd' | série do Excel → 'AAAA-MM-DD' (ou null). */
export function lerData(valor) {
  if (typeof valor === 'number' && valor > 20000 && valor < 80000) return excelParaISO(valor);
  const t = String(valor ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** "- 1.440,47" / "15,94" / -1219.9 (número) → centavos com sinal (ou null). */
export function lerValorComSinal(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  const t = String(valor ?? '').replace(/\s/g, '');
  if (!t) return null;
  const negativo = /^-/.test(t) || /-$/.test(t);
  const centavos = lerValorBR(t.replace(/-/g, ''));
  return centavos === null ? null : (negativo ? -centavos : centavos);
}

/** CSV simples com aspas ("" = aspas dentro do texto). */
export function lerCSV(texto) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  const t = String(texto ?? '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== '')) linhas.push(linha);
  return linhas;
}

const norm = (x) => normalizar(consertarTexto(x));

// =============================================================================
// 2. Leitores de cada formato → { formato, tipo, banco, titulo, vencimento, finalCartao, linhas }
//    linha = { data, descricao (original), valor (centavos, + = saída), parcela, extra }
// =============================================================================

/** Nubank — fatura do cartão em CSV ("date,title,amount"). */
export function lerNubankCSV(texto, nomeArquivo = '') {
  const [cabecalho, ...resto] = lerCSV(texto);
  if (!cabecalho || cabecalho.map((c) => c.trim().toLowerCase()).join(',') !== 'date,title,amount') {
    throw new Error('Não parece a fatura do Nubank (esperado cabeçalho "date,title,amount").');
  }
  // O nome do arquivo traz o vencimento: Nubank_2026-10-14.csv
  const venc = /(\d{4}-\d{2}-\d{2})/.exec(nomeArquivo)?.[1] ?? null;
  const linhas = resto.map(([data, titulo, valor]) => ({
    data: lerData(data), descricao: titulo, valor: lerValorComSinal(valor), parcela: lerParcela(titulo), extra: null,
  })).filter((l) => l.data && l.valor);   // valor 0/null fora
  return { formato: 'nubank-fatura', tipo: 'cartao', banco: 'Nubank', titulo: 'Fatura Nubank', vencimento: venc, finalCartao: null, linhas };
}

/** Acha a linha de cabeçalho de uma planilha pelos nomes (sem acento) das colunas. */
function acharCabecalho(linhas, nomes) {
  for (let i = 0; i < linhas.length; i++) {
    const celulas = (linhas[i] ?? []).map((c) => norm(c));
    const indices = nomes.map((n) => celulas.findIndex((c) => c === norm(n)));
    if (indices.every((x) => x >= 0)) return { linha: i, indices };
  }
  return null;
}

/** Itaú — fatura do cartão (.xlsx), a partir das linhas da 1ª aba. */
export function lerItauFatura(abas) {
  const linhas = abas[0]?.linhas ?? [];
  const cab = acharCabecalho(linhas, ['data', 'lancamento', 'parcelamento', 'valor']);
  if (!cab) throw new Error('Não encontrei a tabela "Data / Lançamento / Parcelamento / Valor" da fatura do Itaú.');
  const [iData, iDesc, iParc, iValor] = cab.indices;

  // Vencimento: coluna "Vencimento" do quadro do cartão (linha de baixo).
  let vencimento = null;
  const cabCartao = acharCabecalho(linhas, ['vencimento']);
  if (cabCartao) vencimento = lerData(linhas[cabCartao.linha + 1]?.[cabCartao.indices[0]]);
  const textoTodo = linhas.slice(0, cab.linha).flat().filter(Boolean).map(String).join(' ');
  const finalCartao = /final\s+(\d{4})/i.exec(textoTodo)?.[1] ?? null;
  const titulo = linhas.slice(0, cab.linha).flat().map(String).find((c) => /^fatura/i.test(c.trim()))?.trim() ?? 'Fatura Itaú';

  const saida = [];
  for (const l of linhas.slice(cab.linha + 1)) {
    const data = lerData(l?.[iData]);
    const valor = lerValorComSinal(l?.[iValor]);
    if (!data || !valor || !String(l?.[iDesc] ?? '').trim()) continue; // "Subtotal", "Controle De Saldo" (0), vazias
    saida.push({
      data, descricao: consertarTexto(l[iDesc]), valor, parcela: lerParcela(l[iParc], l[iDesc]),
      extra: l.slice(iValor + 1).filter((c) => c !== null && c !== '').map(String).join(' · ') || null,
    });
  }
  return { formato: 'itau-fatura', tipo: 'cartao', banco: 'Itaú', titulo, vencimento, finalCartao, linhas: saida };
}

/** Itaú — extrato da conta corrente (.xls), aba "Lançamentos". */
export function lerItauConta(abas) {
  const aba = abas.find((a) => norm(a.nome) === 'lancamentos') ?? abas[0];
  const linhas = aba?.linhas ?? [];
  const cab = acharCabecalho(linhas, ['data', 'lancamento', 'valor (r$)']);
  if (!cab) throw new Error('Não encontrei a tabela "data / lançamento / valor (R$)" do extrato do Itaú.');
  const [iData, iDesc, iValor] = cab.indices;
  const saida = [];
  for (const l of linhas.slice(cab.linha + 1)) {
    const data = lerData(l?.[iData]);
    const bruto = l?.[iValor];
    if (!data || bruto === '' || bruto === null || bruto === undefined) continue; // linhas de SALDO
    const valor = lerValorComSinal(bruto);
    if (valor === null || valor === 0) continue;
    // No extrato, negativo = saída. Aqui, saída é positivo.
    saida.push({ data, descricao: consertarTexto(l[iDesc]), valor: -valor, parcela: null, extra: null });
  }
  return { formato: 'itau-conta', tipo: 'conta', banco: 'Itaú', titulo: 'Extrato Itaú (conta)', vencimento: null, finalCartao: null, linhas: saida };
}

/** OFX (qualquer banco): conta corrente ou cartão. */
export function lerOFX(texto) {
  const t = String(texto ?? '');
  if (!/<OFX>/i.test(t)) throw new Error('Arquivo OFX inválido.');
  const tipo = /<CCSTMTRS>|<CREDITCARDMSGSRSV1>/i.test(t) ? 'cartao' : 'conta';
  const campo = (bloco, nome) => new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco)?.[1]?.trim() ?? '';
  const linhas = [...t.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)].map((m) => {
    const b = m[1];
    const d = campo(b, 'DTPOSTED');
    const valor = lerValorComSinal(campo(b, 'TRNAMT').replace('.', ','));
    const descricao = consertarTexto(campo(b, 'MEMO') || campo(b, 'NAME'));
    return {
      data: d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
      descricao, valor: valor === null ? null : -valor, parcela: lerParcela(descricao), extra: campo(b, 'FITID') || null,
    };
  }).filter((l) => l.data && l.valor);
  const banco = campo(t, 'ORG') || 'OFX';
  return { formato: `ofx-${tipo}`, tipo, banco, titulo: `${tipo === 'cartao' ? 'Fatura' : 'Extrato'} ${banco} (OFX)`, vencimento: null, finalCartao: null, linhas };
}

/**
 * Descobre o formato e lê. `conteudo` = { texto } (CSV/OFX) ou { abas } (planilha).
 * @returns resultado do leitor certo, ou lança Error com mensagem clara.
 */
export function lerArquivo(nomeArquivo, conteudo) {
  const nome = String(nomeArquivo ?? '').toLowerCase();
  if (conteudo.abas) {
    const texto = conteudo.abas.flatMap((a) => a.linhas.slice(0, 20).flat()).map((c) => norm(c)).join(' | ');
    if (texto.includes('parcelamento') && /fatura/.test(texto)) return lerItauFatura(conteudo.abas);
    if (texto.includes('lancamento') && texto.includes('saldos r')) return lerItauConta(conteudo.abas);
    throw new Error('Planilha não reconhecida. Por enquanto: fatura do cartão Itaú (.xlsx) e extrato da conta Itaú (.xls).');
  }
  const texto = String(conteudo.texto ?? '');
  if (/<OFX>/i.test(texto) || nome.endsWith('.ofx')) return lerOFX(texto);
  if (/^﻿?date,title,amount/i.test(texto.trim())) return lerNubankCSV(texto, nomeArquivo);
  throw new Error('Arquivo não reconhecido. Use: fatura Nubank (.csv), fatura Itaú (.xlsx), extrato Itaú (.xls) ou OFX.');
}

// =============================================================================
// 3. Classificação: ignorar? categoria? forma de pagamento?
// =============================================================================

/** Linhas que NÃO viram lançamento, com o motivo mostrado na prévia. */
const IGNORAR = [
  { tipo: 'cartao', sinal: -1, re: /pagamento (recebido|efetuado|com saldo)|pagto|controle de saldo/, motivo: 'Pagamento da fatura (não é gasto)' },
  { tipo: 'conta', sinal: 1, re: /fatura paga|pag boleto nu pagamentos|pagamento (de )?fatura|pgto fatura|nubank fatura/, motivo: 'Pagamento de fatura de cartão — as compras entram pela importação da fatura' },
  { tipo: 'conta', sinal: 1, re: /\baplic|aplicacao|\bcdb\b|\blci\b|\blca\b|tesouro|poupanca/, motivo: 'Aplicação em investimento (dinheiro guardado, não é gasto)' },
  { tipo: 'conta', sinal: -1, re: /resgate|\bresg\b/, motivo: 'Resgate de investimento (não é ganho)' },
  { tipo: 'conta', sinal: -1, re: /rend pago aplic|rendimento aplic/, motivo: 'Rendimento automático da conta (centavos) — marque se quiser importar' },
];

/**
 * Palavras-chave → categoria (nome das categorias padrão). A primeira que
 * casar vale. Os padrões são aplicados ao texto NORMALIZADO (minúsculas, sem
 * acento, pontuação virou espaço): "Apple.Com/Bill" → "apple com bill". O que a pessoa corrigir vira regra aprendida, que tem
 * prioridade sobre esta lista.
 */
const DICIONARIO = [
  // ---- gastos
  ['despesa', /financiamento|financeira|\bcfi\b|consorcio|emprestimo|credito pessoal|parcela contrato/, 'Financiamentos'],
  ['despesa', /\biof\b|anuidade|mensalidade plano|tar pacote|tarifa|\bjuros\b|\bipva\b|\biptu\b|detran|darf|receita federal/, 'Impostos/Taxas'],
  ['despesa', /netflix|spotify|youtube ?premium|google (one|g1|storage)|apple com bill|icloud|microsoft|amazon ?prime|prime video|disney|\bhbo\b|\bmax\b|globoplay|deezer|paddle|tunemymusic|openai|chatgpt|socio ?torcedor/, 'Assinaturas'],
  ['despesa', /ifood|rappi|ze delivery|burger|mc ?donald|\bbk\b|hamburg|pizza|restaurante|lanchonete|lanches|churrasc|sushi|\bjapa\b|outback|subway|habib|\bcafe\b|cafeteria|doceria|sorvet/, 'Restaurante/Delivery'],
  ['despesa', /supermercado|\bmercado\b|mercadinho|atacad|assai|carrefour|hortifruti|sacolao|acougue|\bsuper\b|padaria|panificadora/, 'Alimentação/Mercado'],
  ['despesa', /posto|shell|ipiranga|petrobras|\bbr\b|combustivel|uber|\b99\b|cabify|estacionamento|estapar|sem parar|tagitau|tag ita|conectcar|veloe|pedagio|tokio marine|porto seguro|azul seguros|lava ?jato/, 'Transporte/Combustível'],
  ['despesa', /drogari|farmacia|droga ?raia|drogasil|pacheco|araujo|arauj|pague menos|unimed|assistencia a saude|plano de saude|hospital|laborat|clinica|odonto|dentista|psicolog|amil|hapvida|bradesco saude/, 'Saúde'],
  ['despesa', /cemig|copasa|sabesp|enel|light|energisa|\bcpfl\b|energia|agua|gas natural|comgas|vivo|claro|\btim\b|\boi\b|telecom|internet|net servicos/, 'Contas'],
  ['despesa', /aluguel|condominio|imobiliaria|securitizadora|financiamento habitacional/, 'Moradia'],
  ['despesa', /escola|colegio|faculdade|universidade|curso|udemy|alura|livraria/, 'Educação'],
  ['despesa', /playstation|steam|xbox|nintendo|cinema|ingresso|sympla|teatro|show|hotel|airbnb|booking|decolar|latam|gol linhas|azul linhas|viagem/, 'Lazer'],
  ['despesa', /renner|riachuelo|\bc a\b|\bcea\b|zara|hering|centauro|netshoes|marisa|pernambucanas|calcad/, 'Vestuário'],
  ['despesa', /petz|cobasi|pet ?shop|veterin|racao/, 'Pets'],
  ['despesa', /oficina|pecas|auto ?pecas|leroy|telhanorte|material de construcao|eletricista|encanador|chaveiro/, 'Manutenção'],
  // ---- ganhos
  ['receita', /sispag|salario|folha|pagto salario/, 'Salário'],
  ['receita', /pro ?labore/, 'Pró-labore'],
  ['receita', /rend pago|rendimento|juros sobre|dividendo/, 'Rendimentos/Investimentos'],
  ['receita', /estorno|devolucao|reembolso|cashback/, 'Reembolso'],
  ['receita', /aluguel/, 'Aluguel'],
];

/** Forma de pagamento de uma saída da conta. */
export function formaDaConta(descricao) {
  const d = norm(descricao);
  if (/^pix|\bpix\b/.test(d)) return 'pix';
  if (/boleto/.test(d)) return 'boleto';
  if (/^pay |debito|compra cartao|cartao/.test(d)) return 'debito';
  if (/^ted|^doc|transf/.test(d)) return 'outro';
  return 'debito';
}

/**
 * Categoria sugerida: regra aprendida → dicionário → "Outros".
 * @returns {{categoriaId:string|null, fonte:'aprendida'|'dicionario'|'padrao'}}
 */
export function sugerirCategoria(descricao, tipo, { regras = [], categorias = [] }) {
  const doTipo = categorias.filter((c) => c.tipo === tipo && c.ativa !== false);
  const porNome = (nome) => doTipo.find((c) => norm(c.nome) === norm(nome));
  const chave = chaveComerciante(descricao);
  const regra = regras
    .filter((r) => r.tipo === tipo && (chave === r.padrao || chave.startsWith(`${r.padrao} `)))
    .sort((a, b) => b.padrao.length - a.padrao.length)[0];
  if (regra && doTipo.some((c) => c.id === regra.categoria_id)) return { categoriaId: regra.categoria_id, fonte: 'aprendida' };
  const texto = norm(limparDescricao(descricao));
  for (const [t, re, nome] of DICIONARIO) {
    if (t === tipo && re.test(texto) && porNome(nome)) return { categoriaId: porNome(nome).id, fonte: 'dicionario' };
  }
  return { categoriaId: (porNome('Outros') ?? doTipo.at(-1))?.id ?? null, fonte: 'padrao' };
}

// =============================================================================
// 4. Análise: cada linha → item da prévia
// =============================================================================

const diasEntre = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
const mesesEntre = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
};

/** Parcelas de uma linha de fatura: da parcela k até N, a partir da fatura informada. */
export function parcelasDaFatura({ valor, parcela, competencia, cartao }) {
  const restantes = parcela ? parcela.n - parcela.k + 1 : 1;
  const qtd = restantes > MAX_PARCELAS ? 1 : restantes;
  return Array.from({ length: qtd }, (_, i) => {
    const comp = somarMesesCompetencia(competencia, i);
    const [ano, mes] = comp.split('-').map(Number);
    const dia = diaAjustado(ano, mes, cartao.dia_vencimento);
    return {
      numero: i + 1, total: qtd, valor_centavos: valor, competencia: comp,
      data_vencimento: `${comp.slice(0, 8)}${String(dia).padStart(2, '0')}`,
    };
  });
}

/**
 * Analisa o arquivo lido e devolve os itens da prévia.
 *
 * @param {object} p
 * @param {object} p.arquivo        resultado de lerArquivo()
 * @param {string} p.userId         quem está importando
 * @param {object} [p.cartao]       cartão escolhido (obrigatório se arquivo.tipo === 'cartao')
 * @param {string} [p.competencia]  mês da fatura 'AAAA-MM-01' (cartão)
 * @param {Array}  p.categorias     categorias da família
 * @param {Array}  [p.regras]       regras aprendidas (regras_categoria)
 * @param {object} [p.existentes]   { idsExistentes:Set, despesas:[], parcelas:[], receitas:[] } do servidor
 * @returns {Promise<Array>} itens (ver montarItem)
 */
export async function analisar({ arquivo, userId, cartao = null, competencia = null, categorias, regras = [], existentes = {} }) {
  const cartaoArq = arquivo.tipo === 'cartao';
  if (cartaoArq && (!cartao || !competencia)) throw new Error('Escolha o cartão e o mês da fatura.');
  const ids = existentes.idsExistentes ?? new Set();
  const despesasExist = existentes.despesas ?? [];
  const parcelasExist = existentes.parcelas ?? [];
  const receitasExist = existentes.receitas ?? [];
  const usadas = new Set(); // registros existentes já casados com alguma linha (cada um casa uma vez)

  // Chave de cada linha; "ocorrência" separa linhas idênticas no mesmo arquivo
  // (ex.: duas passagens de R$ 50 no pedágio no mesmo dia).
  const vistos = new Map();
  const ref = cartaoArq ? `cartao:${cartao.id}` : `conta:${arquivo.formato}`;
  const itens = [];
  for (const [n, linha] of arquivo.linhas.entries()) {
    const base = [ref, linha.data, linha.valor, norm(linha.descricao), linha.parcela ? `${linha.parcela.k}/${linha.parcela.n}` : ''].join('|');
    const ocorrencia = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, ocorrencia);
    const chave = `${userId}|${base}|${ocorrencia}`;
    itens.push({ n, linha, chave, id: await idDeterministico('importacao', chave) });
  }

  // Estornos do cartão: casa com a compra do mesmo valor no mesmo arquivo.
  const estornados = new Set();
  if (cartaoArq) {
    for (const it of itens) {
      if (!(it.linha.valor < 0 && /estorno/i.test(it.linha.descricao))) continue;
      const alvo = itens.find((o) => o !== it && !estornados.has(o) && o.linha.valor === -it.linha.valor
        && chaveComerciante(o.linha.descricao).split(' ')[0] === chaveComerciante(it.linha.descricao).split(' ')[0]);
      if (alvo) { estornados.add(it); estornados.add(alvo); }
    }
  }

  return itens.map((it) => {
    const { linha } = it;
    const texto = norm(linha.descricao);
    const saida = linha.valor > 0;
    const tipo = saida ? 'despesa' : 'receita';
    const descricao = limparDescricao(linha.descricao) || 'Lançamento importado';
    const item = {
      ...it, tipo, descricao, localNome: descricao.slice(0, 80), data: linha.data,
      valor: Math.abs(linha.valor), parcela: linha.parcela, situacao: 'novo', motivo: null,
      selecionado: true, forma: null, parcelas: [], competencia: null,
    };

    // ---- Ignorados ----------------------------------------------------------
    const ignorar = (motivo) => Object.assign(item, { situacao: 'ignorado', motivo, selecionado: false });
    if (estornados.has(it)) ignorar('Compra estornada no mesmo mês (compra e estorno se anulam)');
    else if (cartaoArq && linha.valor < 0) {
      const regra = IGNORAR.find((r) => r.tipo === 'cartao' && r.re.test(texto));
      ignorar(regra?.motivo ?? (/estorno/.test(texto)
        ? 'Estorno de compra de outra fatura — se a compra já está no app, exclua-a em Lançamentos'
        : 'Crédito na fatura (não é gasto nem ganho)'));
    } else {
      const regra = IGNORAR.find((r) => r.tipo === arquivo.tipo && r.sinal === Math.sign(linha.valor) && r.re.test(texto));
      if (regra) ignorar(regra.motivo);
    }

    // ---- Categoria, forma e parcelas ------------------------------------
    const sug = sugerirCategoria(linha.descricao, tipo, { regras, categorias });
    item.categoriaId = sug.categoriaId;
    item.categoriaSugerida = sug.categoriaId;
    item.fonteCategoria = sug.fonte;
    if (tipo === 'despesa') {
      if (cartaoArq) {
        item.forma = 'credito';
        item.competencia = competencia;
        item.parcelas = parcelasDaFatura({ valor: item.valor, parcela: linha.parcela, competencia, cartao });
        if (linha.parcela && linha.parcela.n - linha.parcela.k + 1 > MAX_PARCELAS) {
          item.aviso = `Mais de ${MAX_PARCELAS} parcelas restantes: entra só a parcela deste mês.`;
        }
      } else {
        item.forma = formaDaConta(linha.descricao);
        item.competencia = competenciaDe(linha.data);
        item.parcelas = [{ numero: 1, total: 1, valor_centavos: item.valor, competencia: item.competencia, data_vencimento: linha.data }];
      }
    }
    if (item.situacao === 'ignorado') return item;

    // ---- Já importado (mesmo id) ------------------------------------------
    if (ids.has(it.id)) {
      return Object.assign(item, { situacao: 'ja_importado', motivo: 'Já importado antes', selecionado: false });
    }

    // ---- Parece já lançado (digitado, Carteira, recorrência ou outra importação)
    const parecido = (existente, descricaoExistente, valorExistente = item.valor) => {
      usadas.add(existente);
      const diferente = valorExistente !== item.valor
        ? ` — ${moeda(valorExistente)} no app × ${moeda(item.valor)} no arquivo. Se for o mesmo, deixe desmarcado e corrija o valor em Lançamentos`
        : ' — marque se for outro';
      return Object.assign(item, { situacao: 'provavel_duplicado', selecionado: false, duplicadoDe: descricaoExistente,
        motivo: `Parece já lançado: ${descricaoExistente ?? 'lançamento'}${diferente}` });
    };
    // Lançamento gerado por RECORRÊNCIA (pensão, aluguel…) pode ter valor um
    // pouco diferente do que caiu de verdade: aceita até 10% e ±5 dias (v1.3.1).
    const valorBate = (existente, valorExistente, dias, { dataExata = 3 } = {}) =>
      (valorExistente === item.valor && dias <= dataExata)
      || (existente.origem === 'recorrencia' && dias <= 5 && Math.abs(valorExistente - item.valor) <= Math.round(0.1 * Math.max(valorExistente, item.valor)));
    const melhor = (candidatos, valorDe) => candidatos.find((c) => valorDe(c) === item.valor) ?? candidatos[0];
    const descDespesa = (id) => {
      const d = despesasExist.find((x) => x.id === id);
      return d ? (d.descricao || d.local_nome || 'gasto') : 'gasto';
    };
    if (tipo === 'despesa' && cartaoArq) {
      // Parcela 2+ : a data da linha é a da fatura → casa pela fatura (mês exato) e valor.
      // À vista / 1ª parcela: casa pelo valor E pela data da compra (±5 dias) —
      // senão a assinatura do mês passado (mesmo valor) pareceria repetida.
      const k = linha.parcela?.k ?? 1;
      const tolerancia = Math.max(1, linha.parcela?.n ?? 1);
      const achado = parcelasExist.find((p) => {
        if (usadas.has(p) || p.cartao_id !== cartao.id) return false;
        if (k > 1) return p.competencia === competencia && Math.abs(p.valor_centavos - item.valor) <= 1;
        const d = despesasExist.find((x) => x.id === p.despesa_id);
        if (!d?.data_compra || Math.abs(mesesEntre(p.competencia, competencia)) > 1) return false;
        const dias = diasEntre(d.data_compra, linha.data);
        return (dias <= 5 && Math.abs(p.valor_centavos - item.valor) <= tolerancia)
          || (d.origem === 'recorrencia' && valorBate(d, p.valor_centavos, dias));
      });
      if (achado) return parecido(achado, descDespesa(achado.despesa_id), achado.valor_centavos);
    } else if (tipo === 'despesa') {
      const achado = melhor(despesasExist.filter((d) => !usadas.has(d) && d.forma_pagamento !== 'credito'
        && valorBate(d, d.valor_total_centavos, diasEntre(d.data_compra, linha.data))), (d) => d.valor_total_centavos);
      if (achado) return parecido(achado, achado.descricao || achado.local_nome, achado.valor_total_centavos);
    } else {
      const achado = melhor(receitasExist.filter((r) => !usadas.has(r)
        && valorBate(r, r.valor_centavos, diasEntre(r.data, linha.data))), (r) => r.valor_centavos);
      if (achado) return parecido(achado, achado.descricao || 'ganho', achado.valor_centavos);
    }
    return item;
  });
}

// =============================================================================
// 5. Item confirmado → item da fila; categorias trocadas → regras aprendidas
// =============================================================================

/** Categorias que são compromisso todo mês → lançamento "Fixo" (Painel: fixos × variáveis). */
const CATEGORIAS_FIXAS = {
  despesa: ['Financiamentos', 'Moradia', 'Contas', 'Assinaturas'],
  receita: ['Salário', 'Pró-labore', 'Aluguel'],
};
export function naturezaPorCategoria(categoria) {
  if (!categoria) return 'variavel';
  return (CATEGORIAS_FIXAS[categoria.tipo] ?? []).some((n) => norm(n) === norm(categoria.nome)) ? 'fixa' : 'variavel';
}

/**
 * Monta o lançamento no formato da fila (o mesmo do gasto/ganho digitado).
 * @param {object} item     de analisar() (com categoriaId escolhida)
 * @param {object} p
 * @param {object} p.arquivo  resultado de lerArquivo()
 * @param {object} p.perfil   { id, household_id }
 * @param {object} [p.cartao]
 * @param {Array}  [p.categorias]  para a natureza (Fixo/Variável) pela categoria
 */
export function montarLancamento(item, { arquivo, perfil, cartao = null, categorias = [] }) {
  const natureza = naturezaPorCategoria(categorias.find((c) => c.id === item.categoriaId));
  const origem = arquivo.tipo === 'cartao' ? 'importacao_fatura' : 'importacao_conta';
  const nota = [`Importado: ${arquivo.titulo}`, item.parcela ? `parcela ${item.parcela.k} de ${item.parcela.n}` : null]
    .filter(Boolean).join(' · ');
  if (item.tipo === 'receita') {
    return {
      tipo: 'receita', id: item.id, user_id: perfil.id,
      dados: {
        id: item.id, household_id: perfil.household_id, user_id: perfil.id, data: item.data, valor_centavos: item.valor,
        categoria_id: item.categoriaId, descricao: item.descricao, natureza, origem,
        recorrencia_id: null, competencia_recorrencia: null, observacao: nota,
      },
    };
  }
  const parcelas = item.parcelas;
  const total = parcelas.reduce((s, p) => s + p.valor_centavos, 0);
  const descricao = item.parcela && parcelas.length > 1
    ? `${item.descricao} (${item.parcela.k}/${item.parcela.n})`.slice(0, 120) : item.descricao;
  return {
    tipo: 'despesa', id: item.id, user_id: perfil.id, parcelas,
    dados: {
      id: item.id, data_compra: item.data, valor_total_centavos: total, descricao, categoria_id: item.categoriaId,
      forma_pagamento: item.forma, cartao_id: item.forma === 'credito' ? cartao.id : null, qtd_parcelas: parcelas.length,
      natureza, latitude: null, longitude: null, precisao_metros: null, local_nome: item.localNome || null,
      origem, recorrencia_id: null, competencia_recorrencia: null, observacao: nota, valor_a_vista_centavos: null,
    },
  };
}

/** Categorias trocadas pela pessoa (nos itens importados) → regras para a próxima vez. */
export function regrasAprendidas(itens) {
  const regras = new Map();
  for (const it of itens) {
    if (!it.selecionado || !it.categoriaId || it.categoriaId === it.categoriaSugerida) continue;
    const padrao = chaveComerciante(it.linha.descricao);
    if (padrao.length < 2) continue;
    regras.set(`${it.tipo}|${padrao}`, { tipo: it.tipo, padrao, categoria_id: it.categoriaId });
  }
  return [...regras.values()];
}

/** Totais para o resumo da prévia. */
export function resumo(itens) {
  const sel = itens.filter((i) => i.selecionado);
  return {
    total: itens.length,
    selecionados: sel.length,
    gastos: sel.filter((i) => i.tipo === 'despesa').reduce((s, i) => s + i.valor, 0),
    ganhos: sel.filter((i) => i.tipo === 'receita').reduce((s, i) => s + i.valor, 0),
    porSituacao: itens.reduce((acc, i) => ({ ...acc, [i.situacao]: (acc[i.situacao] ?? 0) + 1 }), {}),
  };
}

/** Sugere o cartão cadastrado do arquivo: pelo final (Itaú) ou pelo banco no apelido (Nubank). */
export function sugerirCartao(arquivo, cartoes, userId) {
  const meus = cartoes.filter((c) => c.ativo !== false && c.user_id === userId);
  if (arquivo.finalCartao) {
    const porFinal = meus.find((c) => c.ultimos4 === arquivo.finalCartao);
    if (porFinal) return porFinal;
  }
  const banco = norm(arquivo.banco).split(' ')[0];
  const porBanco = meus.filter((c) => norm(c.apelido).includes(banco));
  return porBanco.length === 1 ? porBanco[0] : null;
}
