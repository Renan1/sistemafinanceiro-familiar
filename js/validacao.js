/**
 * =============================================================================
 * js/validacao.js — Validações de formulário (espelham as regras do banco)
 * -----------------------------------------------------------------------------
 * O banco já recusa dados inválidos (constraints em sql/001_schema.sql). Estas
 * funções validam ANTES, no aparelho, para dar uma mensagem clara na hora —
 * inclusive sem internet. (RNF-22)
 *
 * Todas devolvem uma lista de problemas (array de textos). Lista vazia = ok.
 * Testado em tests/js/validacao.test.js.
 * =============================================================================
 */

/** Política de senha (RNF-01 / D-21). Mantenha igual à configurada no Supabase. */
export const POLITICA_SENHA = {
  minimo: 8,
  regras: [
    { teste: (s) => /[a-z]/.test(s), texto: 'uma letra minúscula' },
    { teste: (s) => /[A-Z]/.test(s), texto: 'uma letra MAIÚSCULA' },
    { teste: (s) => /[0-9]/.test(s), texto: 'um número' },
    { teste: (s) => /[^A-Za-z0-9]/.test(s), texto: 'um caractere especial (!@#$%…)' },
  ],
};

/** Confere a senha contra a política. Ex.: ['mínimo de 8 caracteres', 'um número']. */
export function validarSenha(senha) {
  const s = String(senha ?? '');
  const faltando = [];
  if (s.length < POLITICA_SENHA.minimo) faltando.push(`mínimo de ${POLITICA_SENHA.minimo} caracteres`);
  for (const r of POLITICA_SENHA.regras) if (!r.teste(s)) faltando.push(r.texto);
  return faltando;
}

/** Validação básica de e-mail (o Supabase faz a definitiva). */
export function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim()) ? [] : ['e-mail inválido'];
}

/** Maior valor aceito num lançamento: R$ 99.999.999,99 (10 dígitos no teclado). */
export const VALOR_MAXIMO_CENTAVOS = 9_999_999_999;

/**
 * Valida um gasto antes de salvar.
 * @param {object} g  { valorCentavos, categoriaId, formaPagamento, cartaoId, qtdParcelas, data }
 */
export function validarGasto(g) {
  const erros = [];
  if (!Number.isSafeInteger(g.valorCentavos) || g.valorCentavos <= 0) erros.push('Digite o valor.');
  else if (g.valorCentavos > VALOR_MAXIMO_CENTAVOS) erros.push('Valor alto demais.');
  if (!g.categoriaId) erros.push('Escolha a categoria.');
  if (!g.formaPagamento) erros.push('Escolha a forma de pagamento.');
  if (g.formaPagamento === 'credito' && !g.cartaoId) erros.push('Escolha o cartão.');
  if (g.formaPagamento === 'credito' && g.valorCentavos > 0 && g.valorCentavos < g.qtdParcelas) {
    erros.push('Valor pequeno demais para tantas parcelas.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.data ?? '')) erros.push('Data inválida.');
  return erros;
}

/** Valida um ganho antes de salvar. */
export function validarGanho(g) {
  const erros = [];
  if (!Number.isSafeInteger(g.valorCentavos) || g.valorCentavos <= 0) erros.push('Digite o valor.');
  else if (g.valorCentavos > VALOR_MAXIMO_CENTAVOS) erros.push('Valor alto demais.');
  if (!g.categoriaId) erros.push('Escolha a categoria.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.data ?? '')) erros.push('Data inválida.');
  return erros;
}

/** Valida o cadastro de cartão (mesmas regras da tabela cartoes). */
export function validarCartao(c) {
  const erros = [];
  const dia = (d) => Number.isInteger(d) && d >= 1 && d <= 31;
  if (!String(c.apelido ?? '').trim()) erros.push('Dê um apelido ao cartão (ex.: "Nubank Renan").');
  if (!c.bandeira) erros.push('Escolha a bandeira.');
  if (!/^\d{4}$/.test(String(c.ultimos4 ?? ''))) erros.push('Informe os 4 últimos números.');
  if (!dia(c.dia_fechamento)) erros.push('Dia de fechamento deve ser de 1 a 31.');
  if (!dia(c.dia_vencimento)) erros.push('Dia de vencimento deve ser de 1 a 31.');
  if (c.limite_centavos != null && !(c.limite_centavos > 0)) erros.push('Limite deve ser maior que zero.');
  return erros;
}
