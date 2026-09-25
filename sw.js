/**
 * =============================================================================
 * sw.js — Service Worker: faz o app abrir e funcionar SEM INTERNET (RNF-13)
 * -----------------------------------------------------------------------------
 * O navegador instala este "trabalhador" no primeiro acesso. Ele guarda uma
 * cópia de todos os arquivos do app (HTML, CSS, JS, ícones e a biblioteca do
 * Supabase) e, nas próximas aberturas, entrega essa cópia na hora — com ou
 * sem sinal.
 *
 * O que NÃO passa pelo cache: as chamadas ao Supabase (dados e login). Dados
 * offline ficam no IndexedDB (js/offline.js), nunca aqui.
 *
 * ATUALIZAÇÃO: a cada publicação, o GitHub Actions troca __VERSAO__ abaixo
 * pelo número do commit. Isso muda o nome do cache → o navegador baixa a nova
 * versão em segundo plano e o app mostra "Nova versão — toque para atualizar".
 * =============================================================================
 */

const VERSAO = '__VERSAO__';
const CACHE = `financas-${VERSAO}`;

/** Arquivos do app ("casca") guardados na instalação. */
const ARQUIVOS = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/carteira.js',
  'js/config.js',
  'js/dashboard.js',
  'js/db.js',
  'js/estado.js',
  'js/exportacao.js',
  'js/formato.js',
  'js/geo.js',
  'js/libs.js',
  'js/log.js',
  'js/mapa.js',
  'js/offline.js',
  'js/parcelas.js',
  'js/recorrencias.js',
  'js/regras.js',
  'js/saude.js',
  'js/sync.js',
  'js/validacao.js',
  'js/ui/atalho.js',
  'js/ui/caixa.js',
  'js/ui/categorias.js',
  'js/ui/componentes.js',
  'js/ui/dom.js',
  'js/ui/exportar.js',
  'js/ui/graficos.js',
  'js/ui/lancamentos.js',
  'js/ui/login.js',
  'js/ui/mais.js',
  'js/ui/novo-ganho.js',
  'js/ui/novo-gasto.js',
  'js/ui/orcamentos.js',
  'js/ui/painel.js',
  'js/ui/perfil.js',
  'js/ui/recorrencias.js',
  'js/ui/saude.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js',
  // Painel (js/libs.js): gráficos e mapa. As "tiles" das ruas não ficam em cache.
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
];

/** Hosts cujas respostas podem ser guardadas (bibliotecas por CDN). */
const CDNS = ['cdn.jsdelivr.net', 'unpkg.com'];

// ---- Instalação: baixa e guarda tudo -----------------------------------------
self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' ignora o cache HTTP do navegador → sempre a versão nova.
    await Promise.all(ARQUIVOS.map(async (url) => {
      try {
        const resposta = await fetch(new Request(url, { cache: 'reload' }));
        if (resposta.ok) await cache.put(url, resposta);
      } catch { /* um arquivo opcional falhando não impede a instalação */ }
    }));
  })());
});

// ---- Ativação: apaga caches de versões antigas -------------------------------
self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith('financas-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// O app pede para ativar a nova versão quando você toca em "atualizar".
self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'ATUALIZAR_AGORA') self.skipWaiting();
});

// ---- Requisições -------------------------------------------------------------
self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;                        // envios vão direto à rede
  const url = new URL(req.url);

  const mesmoSite = url.origin === self.location.origin;
  const deCdn = CDNS.includes(url.hostname);
  if (!mesmoSite && !deCdn) return;                         // Supabase etc.: sem cache

  // Abrir o app (navegação): entrega o index.html guardado se estiver sem rede.
  if (req.mode === 'navigate') {
    evento.respondWith(fetch(req).catch(async () =>
      (await caches.match('index.html')) ?? (await caches.match('./')) ?? Response.error()));
    return;
  }

  // No PC (versão não publicada): rede primeiro, para ver as alterações na hora.
  if (VERSAO === '__VERSAO__' && mesmoSite) {
    evento.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // Arquivos do app e bibliotecas: cache primeiro (rápido e offline);
  // se não estiver guardado, busca na rede e guarda.
  evento.respondWith((async () => {
    const guardado = await caches.match(req, { ignoreSearch: mesmoSite });
    if (guardado) return guardado;
    const resposta = await fetch(req);
    if (resposta.ok && (mesmoSite || resposta.type === 'cors')) {
      const cache = await caches.open(CACHE);
      cache.put(req, resposta.clone());
    }
    return resposta;
  })());
});
