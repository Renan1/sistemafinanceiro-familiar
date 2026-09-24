/**
 * =============================================================================
 * js/mapa.js — Mapa dos gastos do mês (RF-63)
 * -----------------------------------------------------------------------------
 * Mostra, com Leaflet + OpenStreetMap, os gastos que têm localização:
 *   * cada gasto é um ponto na cor da categoria;
 *   * pontos próximos se AGRUPAM (círculo com a quantidade) — toque para abrir;
 *   * tocar num ponto mostra valor, data, categoria, descrição e quem gastou.
 * Só gastos com localização aparecem (quem negou a permissão não aparece).
 * O desenho das ruas vem da internet (tiles do OpenStreetMap).
 * =============================================================================
 */
import { carregarLeaflet } from './libs.js';
import { moeda, dataBR } from './formato.js';

/** Escapa texto para o popup do mapa (que aceita HTML). */
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Desenha o mapa dentro de `elemento`.
 * @param {HTMLElement} elemento
 * @param {Array} gastos  [{latitude, longitude, valor_total_centavos, data_compra, descricao, local_nome, user_id, categoria_id}]
 * @param {{categoria:(id)=>object, pessoa:(userId)=>string}} ajuda
 * @returns {Promise<{remover:()=>void}>}
 */
export async function desenharMapa(elemento, gastos, { categoria, pessoa }) {
  const L = await carregarLeaflet();
  const mapa = L.map(elemento, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  const grupo = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40 });
  const pontos = [];
  for (const g of gastos) {
    const cat = categoria(g.categoria_id);
    const ponto = [Number(g.latitude), Number(g.longitude)];
    pontos.push(ponto);
    L.circleMarker(ponto, {
      radius: 8,              // ≥ 8px: fácil de tocar
      color: '#ffffff',       // anel claro separa pontos sobrepostos
      weight: 2,
      fillColor: cat?.cor ?? '#8E8E93',
      fillOpacity: 0.9,
    }).bindPopup(
      `<strong>${esc(moeda(g.valor_total_centavos))}</strong><br>`
      + `${esc(cat?.icone ?? '')} ${esc(cat?.nome ?? '')}<br>`
      + `${esc(dataBR(g.data_compra))} · ${esc(pessoa(g.user_id))}`
      + (g.descricao ? `<br>${esc(g.descricao)}` : '')
      + (g.local_nome ? `<br>📍 ${esc(g.local_nome)}` : ''),
    ).addTo(grupo);
  }
  mapa.addLayer(grupo);

  if (pontos.length === 1) mapa.setView(pontos[0], 15);
  else mapa.fitBounds(L.latLngBounds(pontos), { padding: [24, 24], maxZoom: 15 });

  // O container pode ter mudado de tamanho enquanto o Leaflet carregava.
  setTimeout(() => mapa.invalidateSize(), 50);
  return { remover: () => mapa.remove() };
}
