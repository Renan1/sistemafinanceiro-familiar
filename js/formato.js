/**
 * =============================================================================
 * js/formato.js — Formatação pt-BR (moeda, datas) e datas no fuso de São Paulo
 * -----------------------------------------------------------------------------
 * Regra do projeto: valores circulam SEMPRE em centavos (inteiros) e datas
 * como texto 'AAAA-MM-DD'. A conversão para "R$ 1.234,56" e "23/09/2026"
 * acontece só na hora de exibir, por meio destas funções. (RNF-30)
 *
 * Sem dependências. Testado em tests/js/formato.test.js.
 * =============================================================================
 */

export const FUSO = 'America/Sao_Paulo';

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Centavos → "R$ 1.234,56".
 * O Intl usa espaço não separável depois do "R$"; trocamos por espaço comum
 * para facilitar comparações e cópia.
 */
export function moeda(centavos) {
  return fmtMoeda.format((Number(centavos) || 0) / 100).replace(/ /g, ' ');
}

/** 'AAAA-MM-DD' → 'dd/mm/aaaa'. */
export function dataBR(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** 'AAAA-MM-DD' (qualquer dia) → 'Out/26'. Usado na prévia de parcelas. */
export function mesAbrev(iso) {
  const [a, m] = String(iso).split('-');
  return `${MESES_ABREV[Number(m) - 1]}/${a.slice(2)}`;
}

/** 'AAAA-MM-DD' → 'setembro de 2026'. */
export function mesExtenso(iso) {
  const [a, m] = String(iso).split('-');
  return `${MESES_NOME[Number(m) - 1]} de ${a}`;
}

/** Data de hoje ('AAAA-MM-DD') no fuso de São Paulo, independente do aparelho. */
export function hojeSP(agora = new Date()) {
  // 'en-CA' formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(agora);
}

/** 1º dia do mês de uma data: '2026-09-23' → '2026-09-01' (a "competência"). */
export function competenciaDe(iso) {
  return `${String(iso).slice(0, 7)}-01`;
}

/** Soma meses a uma competência: ('2026-12-01', 1) → '2027-01-01'. */
export function somarMesesCompetencia(competencia, n) {
  const [a, m] = competencia.split('-').map(Number);
  const indice = a * 12 + (m - 1) + n;
  const ano = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/** Percentual com 1 casa decimal: 14.8 → "14,8%". null → "—". */
export function percentual(valor) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '—';
  return `${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Data/hora ISO → "23/09/2026 18:05" no fuso de São Paulo (logs, auditoria). */
export function dataHoraBR(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Texto digitado em reais → centavos. Aceita "1.234,56", "1234,5", "1234.56",
 * "R$ 80". Devolve null se não for um valor válido.
 */
export function lerValorBR(texto) {
  let t = String(texto ?? '').replace(/[R$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');   // formato brasileiro
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "1.234" = mil
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Centavos → texto para campo de edição: 123456 → "1.234,56". */
export function valorParaCampo(centavos) {
  return ((Number(centavos) || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
