/**
 * =============================================================================
 * tests/js/parcelas.test.js — Testes de calcularParcelas()
 * -----------------------------------------------------------------------------
 * Como rodar (PowerShell, na pasta do projeto):   npm test
 * Usa o executor de testes nativo do Node (node:test) — nada para instalar.
 * Também roda no GitHub Actions a cada envio.
 *
 * Cartões usados nos testes:
 *   NUBANK  fecha dia 5,  vence dia 12  → vencimento > fechamento: vence no
 *           MESMO mês do fechamento.
 *   ITAU    fecha dia 28, vence dia 5   → vencimento ≤ fechamento: vence no
 *           mês SEGUINTE ao fechamento.
 * =============================================================================
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcularParcelas, diasNoMes, somarMeses, totalPelaParcela, jurosDaCompra } from '../../js/parcelas.js';

const NUBANK = { dia_fechamento: 5, dia_vencimento: 12 };
const ITAU = { dia_fechamento: 28, dia_vencimento: 5 };

/** Atalho: compra no crédito. */
const credito = (valorTotalCentavos, qtdParcelas, dataCompra, cartao) =>
  calcularParcelas({ valorTotalCentavos, qtdParcelas, dataCompra, formaPagamento: 'credito', cartao });

/** Só os campos que costumamos conferir. */
const resumo = (parcelas) => parcelas.map((p) => [p.valor_centavos, p.competencia, p.data_vencimento]);

describe('Critério de aceite CA-02', () => {
  test('R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33 nas faturas corretas', () => {
    // Compra dia 20/09, depois do fechamento (5) → fatura fecha 05/10, vence 12/10.
    assert.deepEqual(resumo(credito(100000, 3, '2026-09-20', NUBANK)), [
      [33334, '2026-10-01', '2026-10-12'],
      [33333, '2026-11-01', '2026-11-12'],
      [33333, '2026-12-01', '2026-12-12'],
    ]);
  });
});

describe('Fechamento da fatura (RN-13)', () => {
  test('compra ANTES do fechamento entra na fatura do mês', () => {
    const [p] = credito(5000, 1, '2026-09-04', NUBANK);
    assert.equal(p.competencia, '2026-09-01');
    assert.equal(p.data_vencimento, '2026-09-12');
  });

  test('compra NO DIA do fechamento vai para a fatura seguinte', () => {
    const [p] = credito(5000, 1, '2026-09-05', NUBANK);
    assert.equal(p.competencia, '2026-10-01');
    assert.equal(p.data_vencimento, '2026-10-12');
  });

  test('compra DEPOIS do fechamento vai para a fatura seguinte', () => {
    const [p] = credito(5000, 1, '2026-09-06', NUBANK);
    assert.equal(p.competencia, '2026-10-01');
  });
});

describe('Vencimento (RN-14)', () => {
  test('vencimento ≤ fechamento: vence no mês seguinte ao fechamento', () => {
    // Compra 10/09 (antes do dia 28) → fecha 28/09 → vence 05/10.
    const [p] = credito(5000, 1, '2026-09-10', ITAU);
    assert.equal(p.competencia, '2026-10-01');
    assert.equal(p.data_vencimento, '2026-10-05');
  });

  test('vencimento ≤ fechamento, compra no fechamento: pula dois meses', () => {
    // Compra 28/09 → fecha 28/10 → vence 05/11.
    const [p] = credito(5000, 1, '2026-09-28', ITAU);
    assert.equal(p.data_vencimento, '2026-11-05');
  });

  test('vencimento = fechamento conta como "no mês seguinte"', () => {
    const [p] = credito(5000, 1, '2026-09-01', { dia_fechamento: 10, dia_vencimento: 10 });
    assert.equal(p.data_vencimento, '2026-10-10');
  });
});

describe('Virada de ano', () => {
  test('compra em dezembro após o fechamento cai em janeiro do ano seguinte', () => {
    assert.deepEqual(resumo(credito(30000, 3, '2026-12-20', NUBANK)), [
      [10000, '2027-01-01', '2027-01-12'],
      [10000, '2027-02-01', '2027-02-12'],
      [10000, '2027-03-01', '2027-03-12'],
    ]);
  });

  test('cartão que vence no mês seguinte: dezembro → fevereiro', () => {
    // Compra 29/12 (após fechar dia 28) → fecha 28/01/27 → vence 05/02/27.
    const [p] = credito(5000, 1, '2026-12-29', ITAU);
    assert.equal(p.data_vencimento, '2027-02-05');
  });

  test('12x começando em novembro atravessa o ano corretamente', () => {
    const ps = credito(120000, 12, '2026-10-20', NUBANK);
    assert.equal(ps[0].competencia, '2026-11-01');
    assert.equal(ps[1].competencia, '2026-12-01');
    assert.equal(ps[2].competencia, '2027-01-01');
    assert.equal(ps[11].competencia, '2027-10-01');
  });
});

describe('Meses curtos e fevereiro (RN-15)', () => {
  const VENCE_31 = { dia_fechamento: 25, dia_vencimento: 31 };

  test('vencimento dia 31 em fevereiro (ano comum) → 28/02', () => {
    const [p] = credito(5000, 1, '2027-01-26', VENCE_31);
    assert.equal(p.data_vencimento, '2027-02-28');
  });

  test('vencimento dia 31 em fevereiro (ano bissexto) → 29/02', () => {
    const [p] = credito(5000, 1, '2028-01-26', VENCE_31);
    assert.equal(p.data_vencimento, '2028-02-29');
  });

  test('parcelas seguintes voltam ao dia 31 quando o mês tem 31 dias', () => {
    assert.deepEqual(credito(30000, 3, '2027-01-26', VENCE_31).map((p) => p.data_vencimento),
      ['2027-02-28', '2027-03-31', '2027-04-30']);
  });

  test('fechamento dia 31 em fevereiro fecha no último dia do mês', () => {
    // Fevereiro/2027 tem 28 dias: compra 28/02 é NO fechamento → próxima fatura.
    const cartao = { dia_fechamento: 31, dia_vencimento: 10 };
    assert.equal(credito(5000, 1, '2027-02-27', cartao)[0].data_vencimento, '2027-03-10');
    assert.equal(credito(5000, 1, '2027-02-28', cartao)[0].data_vencimento, '2027-04-10');
  });

  test('diasNoMes e somarMeses', () => {
    assert.equal(diasNoMes(2027, 2), 28);
    assert.equal(diasNoMes(2028, 2), 29);
    assert.equal(diasNoMes(2026, 4), 30);
    assert.deepEqual(somarMeses(2026, 12, 1), { ano: 2027, mes: 1 });
    assert.deepEqual(somarMeses(2026, 11, 14), { ano: 2028, mes: 1 });
  });
});

describe('Quantidade de parcelas e arredondamento (RN-12)', () => {
  test('1x no crédito: uma parcela com o valor total', () => {
    const ps = credito(12345, 1, '2026-09-20', NUBANK);
    assert.equal(ps.length, 1);
    assert.equal(ps[0].valor_centavos, 12345);
    assert.equal(ps[0].numero, 1);
    assert.equal(ps[0].total, 1);
  });

  test('12x de R$ 1.000,00: sobra de 4 centavos vai na 1ª', () => {
    const ps = credito(100000, 12, '2026-09-20', NUBANK);
    assert.equal(ps.length, 12);
    assert.equal(ps[0].valor_centavos, 8337);
    assert.ok(ps.slice(1).every((p) => p.valor_centavos === 8333));
    assert.deepEqual(ps.map((p) => p.numero), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.ok(ps.every((p) => p.total === 12));
  });

  test('24x (máximo) funciona', () => {
    assert.equal(credito(240000, 24, '2026-09-20', NUBANK).length, 24);
  });

  test('a soma das parcelas é SEMPRE igual ao total (1.000 combinações)', () => {
    let semente = 42; // gerador pseudoaleatório fixo: o teste é repetível
    const aleatorio = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(aleatorio() * 24);
      const total = n + Math.floor(aleatorio() * 10_000_000);
      const ps = credito(total, n, '2026-09-20', NUBANK);
      const soma = ps.reduce((s, p) => s + p.valor_centavos, 0);
      assert.equal(soma, total, `total=${total} n=${n}`);
      assert.ok(ps.every((p) => p.valor_centavos > 0));
      assert.ok(ps[0].valor_centavos - ps[ps.length - 1].valor_centavos < n, 'sobra menor que N');
    }
  });
});

describe('Pagamento à vista (RN-11)', () => {
  for (const forma of ['pix', 'debito', 'dinheiro', 'boleto', 'outro']) {
    test(`${forma}: 1 parcela na competência do mês da compra`, () => {
      assert.deepEqual(calcularParcelas({
        valorTotalCentavos: 4990, dataCompra: '2026-09-23', formaPagamento: forma,
      }), [{ numero: 1, total: 1, valor_centavos: 4990, competencia: '2026-09-01', data_vencimento: '2026-09-23' }]);
    });
  }
});

describe('Validações (mesmas regras do banco)', () => {
  const base = { valorTotalCentavos: 1000, dataCompra: '2026-09-20', formaPagamento: 'pix' };

  test('valor zero, negativo ou com fração é recusado', () => {
    assert.throws(() => calcularParcelas({ ...base, valorTotalCentavos: 0 }), /maior que zero/);
    assert.throws(() => calcularParcelas({ ...base, valorTotalCentavos: -5 }), /maior que zero/);
    assert.throws(() => calcularParcelas({ ...base, valorTotalCentavos: 10.5 }), /maior que zero/);
  });

  test('mais de 24 ou menos de 1 parcela é recusado', () => {
    assert.throws(() => credito(100000, 25, '2026-09-20', NUBANK), /1 a 24/);
    assert.throws(() => credito(100000, 0, '2026-09-20', NUBANK), /1 a 24/);
  });

  test('parcelamento fora do crédito é recusado', () => {
    assert.throws(() => calcularParcelas({ ...base, qtdParcelas: 2 }), /só existe no cartão/);
  });

  test('crédito sem cartão é recusado', () => {
    assert.throws(() => credito(1000, 1, '2026-09-20', undefined), /escolher um cartão/);
    assert.throws(() => credito(1000, 1, '2026-09-20', { dia_fechamento: 0, dia_vencimento: 10 }),
      /escolher um cartão/);
  });

  test('valor menor que o número de parcelas é recusado (parcela de 0 centavos)', () => {
    assert.throws(() => credito(2, 3, '2026-09-20', NUBANK), /pequeno demais/);
  });

  test('data inválida ou inexistente é recusada', () => {
    assert.throws(() => calcularParcelas({ ...base, dataCompra: '20/09/2026' }), /Data inválida/);
    assert.throws(() => calcularParcelas({ ...base, dataCompra: '2026-02-30' }), /inexistente/);
  });

  test('forma de pagamento desconhecida é recusada', () => {
    assert.throws(() => calcularParcelas({ ...base, formaPagamento: 'cheque' }), /inválida/);
  });
});

describe('Compra com juros informada pela parcela (v1.1 — RF-15)', () => {
  const cartao = { dia_fechamento: 5, dia_vencimento: 12 };

  test('12x de R$ 189,90 → total R$ 2.278,80 e 12 parcelas iguais à da loja', () => {
    const total = totalPelaParcela(18990, 12);
    assert.equal(total, 227880);
    const ps = calcularParcelas({ valorTotalCentavos: total, qtdParcelas: 12, dataCompra: '2026-09-25', formaPagamento: 'credito', cartao });
    assert.equal(ps.length, 12);
    assert.ok(ps.every((p) => p.valor_centavos === 18990));
  });

  test('parcela inválida ou parcelas fora de 1..24 dão erro claro', () => {
    assert.throws(() => totalPelaParcela(0, 3), /maior que zero/);
    assert.throws(() => totalPelaParcela(1000, 25), /1 a 24/);
  });

  test('juros e taxa ao mês: R$ 1.000 à vista ou 12x de R$ 94,56 ≈ 2% a.m.', () => {
    const r = jurosDaCompra({ totalCentavos: 9456 * 12, aVistaCentavos: 100000, qtdParcelas: 12 });
    assert.equal(r.jurosCentavos, 13472);
    assert.equal(r.jurosPct, 13.5);
    assert.equal(r.taxaMensalPct, 2);
  });

  test('sem juros (à vista = total) → juros zero e sem taxa', () => {
    assert.deepEqual(jurosDaCompra({ totalCentavos: 60000, aVistaCentavos: 60000, qtdParcelas: 6 }),
      { jurosCentavos: 0, jurosPct: 0, taxaMensalPct: null });
  });

  test('à vista maior que o total é recusado', () => {
    assert.throws(() => jurosDaCompra({ totalCentavos: 50000, aVistaCentavos: 60000, qtdParcelas: 5 }), /não pode ser maior/);
  });
});
