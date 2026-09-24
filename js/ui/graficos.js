/**
 * =============================================================================
 * js/ui/graficos.js — Gráficos do Painel (Chart.js) no padrão visual do app
 * -----------------------------------------------------------------------------
 * Regras de visualização seguidas (guia de dataviz do projeto):
 *   * cores por PAPEL, sempre as mesmas: Ganhos = azul, Gastos = laranja,
 *     Fixos = violeta (validadas para daltonismo, claro e escuro);
 *   * cor segue a ENTIDADE: categorias usam a cor da própria categoria;
 *   * um eixo só, grade fina e discreta, barras finas com cantos de 4px;
 *   * textos (valores, rótulos) na cor do texto, nunca na cor da série;
 *   * legenda sempre que houver 2+ séries; dica (tooltip) ao tocar;
 *   * todo gráfico tem "Ver números" (tabela) — acessível e sem depender de cor.
 * As cores vêm das variáveis CSS (css/app.css), então o tema escuro funciona.
 * =============================================================================
 */
import { h } from './dom.js';
import { carregarChart } from '../libs.js';
import { moeda } from '../formato.js';

const compacto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
/** Centavos → "R$ 1,2 mil" (eixos). */
export const moedaCompacta = (centavos) => compacto.format((centavos ?? 0) / 100).replace(/ /g, ' ');

/** Lê as cores atuais do tema (claro/escuro) das variáveis CSS. */
export function tema() {
  const css = getComputedStyle(document.documentElement);
  const v = (nome) => css.getPropertyValue(nome).trim();
  return {
    texto: v('--texto'), texto2: v('--texto-2'), linha: v('--linha'), superficie: v('--superficie'),
    ganhos: v('--serie-ganhos'), gastos: v('--serie-gastos'), fixos: v('--serie-fixos'),
    fonte: getComputedStyle(document.body).fontFamily,
  };
}

/** Opções comuns a todos os gráficos. */
function base(t, { legenda }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: legenda,
        position: 'bottom',
        labels: { color: t.texto2, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, font: { family: t.fonte, size: 12 } },
      },
      tooltip: {
        backgroundColor: t.texto, titleColor: t.superficie, bodyColor: t.superficie,
        titleFont: { family: t.fonte }, bodyFont: { family: t.fonte }, padding: 10, cornerRadius: 8,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ?? ctx.label}: ${moeda(ctx.raw)}` },
      },
    },
  };
}

/**
 * Barras verticais ou horizontais, simples, agrupadas ou empilhadas.
 * @param {HTMLCanvasElement} canvas
 * @param {{rotulos:string[], series:Array<{nome:string, dados:number[], cor:string}>, empilhado?:boolean, horizontal?:boolean}} p
 */
export async function barras(canvas, { rotulos, series, empilhado = false, horizontal = false }) {
  const Chart = await carregarChart();
  const t = tema();
  const eixoValor = {
    stacked: empilhado,
    beginAtZero: true,
    grid: { color: t.linha, lineWidth: 0.5 },
    border: { display: false },
    ticks: { color: t.texto2, font: { family: t.fonte, size: 11 }, callback: (v) => moedaCompacta(v), maxTicksLimit: 5 },
  };
  const eixoCategoria = {
    stacked: empilhado,
    grid: { display: false },
    border: { color: t.linha },
    ticks: { color: t.texto2, font: { family: t.fonte, size: 11 } },
  };
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rotulos,
      datasets: series.map((s) => ({
        label: s.nome,
        data: s.dados,
        backgroundColor: s.cor,
        borderRadius: 4,
        borderSkipped: empilhado ? false : 'start', // cantos arredondados na ponta
        // Empilhado: 2px da cor do fundo separam os segmentos (sem bordas desenhadas).
        borderColor: empilhado ? t.superficie : 'transparent',
        borderWidth: empilhado ? 2 : 0,
        maxBarThickness: horizontal ? 16 : 18,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
      })),
    },
    options: {
      ...base(t, { legenda: series.length > 1 }),
      indexAxis: horizontal ? 'y' : 'x',
      scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
    },
  });
}

/** Rosca (partes de um todo, ≤ 6 fatias). A legenda é a lista ao lado (HTML). */
export async function rosca(canvas, { fatias }) {
  const Chart = await carregarChart();
  const t = tema();
  const opcoes = base(t, { legenda: false });
  opcoes.interaction = { mode: 'nearest', intersect: true };
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: fatias.map((f) => f.nome),
      datasets: [{
        data: fatias.map((f) => f.total),
        backgroundColor: fatias.map((f) => f.cor),
        borderColor: t.superficie, // 2px de fundo entre as fatias
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: { ...opcoes, cutout: '62%' },
  });
}

/**
 * "Ver números": tabela com os valores do gráfico (acessibilidade e conferência).
 * @param {string[]} cabecalho  ex.: ['Mês', 'Ganhos', 'Gastos']
 * @param {Array<Array<string>>} linhas  já formatadas
 */
export function tabelaNumeros(cabecalho, linhas) {
  return h('details', { class: 'ver-numeros' },
    h('summary', {}, 'Ver números'),
    h('table', {},
      h('thead', {}, h('tr', {}, cabecalho.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, linhas.map((l) => h('tr', {}, l.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', {}, c))))))));
}
