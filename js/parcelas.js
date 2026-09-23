/**
 * =============================================================================
 * js/parcelas.js — Cálculo de parcelas e competência de fatura
 * -----------------------------------------------------------------------------
 * ÚNICA fonte da regra de parcelamento do sistema (docs/DECISOES.md, D-05).
 * Função pura: não acessa tela, banco nem relógio — recebe tudo por parâmetro
 * e devolve sempre o mesmo resultado para a mesma entrada. Por isso é fácil
 * de testar (tests/js/parcelas.test.js) e roda igual com ou sem internet.
 *
 * Regras (docs/REQUISITOS.md):
 *   RN-11  Toda despesa gera parcelas. À vista = 1 parcela no mês da compra.
 *   RN-12  valor / N em centavos; a sobra do arredondamento vai na 1ª parcela.
 *   RN-13  Compra ANTES do dia de fechamento → fatura que fecha no mês da
 *          compra. NO dia ou DEPOIS → fatura que fecha no mês seguinte.
 *   RN-14  Vencimento: se dia_vencimento ≤ dia_fechamento, vence no mês
 *          seguinte ao fechamento; senão, no mesmo mês do fechamento.
 *          Competência = mês do vencimento. Demais parcelas: +1 mês cada.
 *   RN-15  Dia inexistente no mês (29/30/31) → último dia do mês.
 *
 * Usado por: js/ui/novo-gasto.js (prévia "12x de R$ 83,33 — 1ª em Nov/26")
 *            e js/sync.js (parcelas enviadas junto com a despesa).
 * =============================================================================
 */

/** Formas de pagamento aceitas (espelha a constraint do banco). */
export const FORMAS_PAGAMENTO = ['pix', 'debito', 'credito', 'dinheiro', 'boleto', 'outro'];

/** Limite de parcelas (espelha a constraint do banco: 1 a 24). */
export const MAX_PARCELAS = 24;

// -----------------------------------------------------------------------------
// Utilitários de data — trabalhamos só com {ano, mes, dia} (mês de 1 a 12),
// sem objetos Date, para não sofrer com fuso horário nem horário de verão.
// -----------------------------------------------------------------------------

/** Quantos dias tem o mês (fevereiro considera ano bissexto). */
export function diasNoMes(ano, mes) {
  // Dia 0 do mês seguinte = último dia deste mês. UTC evita efeito de fuso.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Soma `n` meses a {ano, mes}. Ex.: dez/2026 + 2 = fev/2027. */
export function somarMeses(ano, mes, n) {
  const indice = ano * 12 + (mes - 1) + n; // meses desde o "ano zero"
  return { ano: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

/** Ajusta o dia ao tamanho do mês (RN-15): 31 em fevereiro vira 28 ou 29. */
export function diaAjustado(ano, mes, dia) {
  return Math.min(dia, diasNoMes(ano, mes));
}

/** 'AAAA-MM-DD' → {ano, mes, dia}. Lança erro se a data for inválida. */
export function lerData(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ''));
  if (!m) throw new Error(`Data inválida: "${texto}" (use AAAA-MM-DD).`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) {
    throw new Error(`Data inexistente: "${texto}".`);
  }
  return { ano, mes, dia };
}

/** {ano, mes, dia} → 'AAAA-MM-DD'. */
export function formatarData(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Regra do cartão
// -----------------------------------------------------------------------------

/**
 * Descobre em qual fatura cai uma compra no cartão.
 *
 * @param {{ano:number, mes:number, dia:number}} compra
 * @param {{dia_fechamento:number, dia_vencimento:number}} cartao
 * @returns {{fechamento:{ano,mes}, vencimento:{ano,mes}}} mês de fechamento e
 *          mês de vencimento da fatura (o vencimento é a competência).
 */
export function faturaDaCompra(compra, cartao) {
  // Dia de fechamento efetivo no mês da compra (ex.: fecha dia 31 → em
  // fevereiro fecha dia 28/29).
  const fechamentoNoMes = diaAjustado(compra.ano, compra.mes, cartao.dia_fechamento);

  // RN-13: antes do fechamento → fatura deste mês; no dia ou depois → próxima.
  const fechamento = compra.dia < fechamentoNoMes
    ? { ano: compra.ano, mes: compra.mes }
    : somarMeses(compra.ano, compra.mes, 1);

  // RN-14: vencimento no mês seguinte ao fechamento quando o dia de
  // vencimento não é maior que o de fechamento; senão, no mesmo mês.
  const vencimento = cartao.dia_vencimento <= cartao.dia_fechamento
    ? somarMeses(fechamento.ano, fechamento.mes, 1)
    : { ...fechamento };

  return { fechamento, vencimento };
}

// -----------------------------------------------------------------------------
// Função principal
// -----------------------------------------------------------------------------

/**
 * Calcula as parcelas de uma despesa.
 *
 * @param {object} p
 * @param {number} p.valorTotalCentavos  inteiro > 0 (R$ 10,50 = 1050)
 * @param {number} [p.qtdParcelas=1]     1 a 24 (só o crédito aceita > 1)
 * @param {string} p.dataCompra          'AAAA-MM-DD'
 * @param {string} p.formaPagamento      um de FORMAS_PAGAMENTO
 * @param {{dia_fechamento:number, dia_vencimento:number}} [p.cartao]
 *        obrigatório no crédito
 * @returns {Array<{numero:number, total:number, valor_centavos:number,
 *                  competencia:string, data_vencimento:string}>}
 *          no mesmo formato que a RPC salvar_despesa() espera.
 * @throws {Error} com mensagem em português se algum dado for inválido.
 */
export function calcularParcelas({ valorTotalCentavos, qtdParcelas = 1, dataCompra, formaPagamento, cartao }) {
  // ---- Validação (mesmas regras das constraints do banco) -------------------
  if (!Number.isSafeInteger(valorTotalCentavos) || valorTotalCentavos <= 0) {
    throw new Error('O valor precisa ser maior que zero (em centavos inteiros).');
  }
  if (!FORMAS_PAGAMENTO.includes(formaPagamento)) {
    throw new Error(`Forma de pagamento inválida: "${formaPagamento}".`);
  }
  if (!Number.isInteger(qtdParcelas) || qtdParcelas < 1 || qtdParcelas > MAX_PARCELAS) {
    throw new Error(`Parcelas devem ser de 1 a ${MAX_PARCELAS}.`);
  }
  if (formaPagamento !== 'credito' && qtdParcelas !== 1) {
    throw new Error('Parcelamento só existe no cartão de crédito.');
  }
  if (valorTotalCentavos < qtdParcelas) {
    throw new Error('Valor pequeno demais para essa quantidade de parcelas.');
  }
  const compra = lerData(dataCompra);

  // ---- À vista (PIX, débito, dinheiro, boleto, outro): 1 parcela no mês ----
  if (formaPagamento !== 'credito') {
    return [{
      numero: 1,
      total: 1,
      valor_centavos: valorTotalCentavos,
      competencia: formatarData(compra.ano, compra.mes, 1),
      data_vencimento: dataCompra,
    }];
  }

  // ---- Crédito --------------------------------------------------------------
  validarCartao(cartao);
  const { vencimento } = faturaDaCompra(compra, cartao);

  // RN-12: divisão inteira; a sobra (0 a N-1 centavos) vai na 1ª parcela.
  const base = Math.floor(valorTotalCentavos / qtdParcelas);
  const sobra = valorTotalCentavos - base * qtdParcelas;

  const parcelas = [];
  for (let i = 0; i < qtdParcelas; i++) {
    const mes = somarMeses(vencimento.ano, vencimento.mes, i);
    const dia = diaAjustado(mes.ano, mes.mes, cartao.dia_vencimento);
    parcelas.push({
      numero: i + 1,
      total: qtdParcelas,
      valor_centavos: i === 0 ? base + sobra : base,
      competencia: formatarData(mes.ano, mes.mes, 1),
      data_vencimento: formatarData(mes.ano, mes.mes, dia),
    });
  }
  return parcelas;
}

/** Garante que o cartão tem dias de fechamento/vencimento válidos (1–31). */
function validarCartao(cartao) {
  const ok = (d) => Number.isInteger(d) && d >= 1 && d <= 31;
  if (!cartao || !ok(cartao.dia_fechamento) || !ok(cartao.dia_vencimento)) {
    throw new Error('No crédito é preciso escolher um cartão com dias de fechamento e vencimento válidos.');
  }
}
