/**
 * =============================================================================
 * js/libs.js — Bibliotecas externas carregadas SOB DEMANDA (Chart.js, Leaflet e,
 *              na importação de extrato, o leitor de planilhas num worker)
 * -----------------------------------------------------------------------------
 * Gráficos e mapa só são baixados quando você abre o Painel — assim a tela de
 * gasto (a mais usada, no ato da compra) continua leve e rápida.
 *
 * Versões fixas (D-24). O Service Worker guarda tudo em cache: depois do
 * primeiro acesso ao Painel, os gráficos funcionam sem internet (o mapa
 * precisa de internet para baixar o desenho das ruas).
 *
 * Se mudar alguma versão aqui, mude também a lista do sw.js (o teste
 * tests/js/service-worker.test.js confere).
 * =============================================================================
 */

export const LIBS = {
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  leafletJs: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  leafletCss: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  clusterJs: 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  clusterCss: 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  clusterCssPadrao: 'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
};

const carregando = new Map();

/** Carrega um <script> uma única vez (chamadas repetidas reaproveitam). */
function script(url) {
  if (!carregando.has(url)) {
    carregando.set(url, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url;
      el.crossOrigin = 'anonymous';
      el.onload = resolve;
      el.onerror = () => { carregando.delete(url); reject(new Error(`Não foi possível carregar ${url}`)); };
      document.head.append(el);
    }));
  }
  return carregando.get(url);
}

/** Carrega uma folha de estilo uma única vez. */
function estilo(url) {
  if (!document.querySelector(`link[href="${url}"]`)) {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = url;
    el.crossOrigin = 'anonymous';
    document.head.append(el);
  }
}

/** Chart.js pronto para uso (globalThis.Chart). */
export async function carregarChart() {
  await script(LIBS.chart);
  return globalThis.Chart;
}

/** Leaflet + agrupamento de pontos (globalThis.L). */
export async function carregarLeaflet() {
  estilo(LIBS.leafletCss);
  estilo(LIBS.clusterCss);
  estilo(LIBS.clusterCssPadrao);
  await script(LIBS.leafletJs);
  await script(LIBS.clusterJs); // depende do Leaflet já carregado
  return globalThis.L;
}

/**
 * Lê uma planilha (.xls / .xlsx) num Web Worker isolado (js/planilha-worker.js)
 * e devolve as linhas de cada aba: [{ nome, linhas: [[célula, …], …] }].
 * Encerra o worker se passar do tempo limite (arquivo estranho/travado).
 * @param {ArrayBuffer} bytes
 */
export function lerPlanilha(bytes, { limiteMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./planilha-worker.js', import.meta.url));
    const fim = (fn, valor) => { clearTimeout(timer); worker.terminate(); fn(valor); };
    const timer = setTimeout(() => fim(reject, new Error('A leitura da planilha demorou demais.')), limiteMs);
    worker.onmessage = (e) => (e.data?.ok ? fim(resolve, e.data.abas) : fim(reject, new Error(`Não foi possível ler a planilha: ${e.data?.erro}`)));
    worker.onerror = (e) => { e.preventDefault?.(); fim(reject, new Error('Não foi possível carregar o leitor de planilhas (precisa de internet).')); };
    worker.postMessage(bytes, [bytes]);
  });
}
