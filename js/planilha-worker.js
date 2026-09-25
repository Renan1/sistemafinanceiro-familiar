/**
 * =============================================================================
 * js/planilha-worker.js — Lê planilhas (.xls / .xlsx) ISOLADO do app (v1.3)
 * -----------------------------------------------------------------------------
 * Roda como Web Worker (processo separado da página): recebe os bytes do
 * arquivo, usa a biblioteca SheetJS e devolve só as LINHAS de cada aba
 * (textos e números). Por que isolado (D-47):
 *   * a versão da SheetJS disponível no CDN público (0.18.5) tem falhas
 *     conhecidas com arquivos maliciosos; aqui, mesmo que alguém engane você
 *     com um arquivo "envenenado", ele não alcança a página, o login nem os
 *     dados — o worker não tem acesso a nada disso;
 *   * se a leitura travar, a página encerra o worker (tempo limite).
 * O arquivo nunca sai do aparelho.
 *
 * Usado por: js/libs.js (lerPlanilha).
 * =============================================================================
 */
/* global XLSX */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

self.onmessage = (evento) => {
  try {
    const livro = XLSX.read(evento.data, { type: 'array', cellDates: false });
    const abas = livro.SheetNames.map((nome) => ({
      nome,
      linhas: XLSX.utils.sheet_to_json(livro.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false }),
    }));
    self.postMessage({ ok: true, abas });
  } catch (e) {
    self.postMessage({ ok: false, erro: String(e?.message ?? e) });
  }
};
