/**
 * =============================================================================
 * js/app.js — Ponto de entrada do aplicativo
 * -----------------------------------------------------------------------------
 * Ordem de inicialização:
 *   1. Registra o Service Worker (app abre sem internet — RNF-13).
 *   2. Lê js/config.js (URL/chave do Supabase, gerado no deploy — D-07).
 *   3. Cria o cliente do Supabase.
 *   4. Decide a tela inicial SEM depender de internet:
 *        - há dados guardados no aparelho + sessão guardada → abre o app já;
 *        - senão → tela de login.
 *   5. Em segundo plano: atualiza cadastros do servidor e envia a fila.
 *
 * Navegação: por "hash" na URL (#/gasto, #/ganho, #/lancamentos, #/painel,
 * #/mais…). Funciona no GitHub Pages sem configuração de servidor.
 * =============================================================================
 */
import { log } from './log.js';
import * as db from './db.js';
import { h, trocar, avisar } from './ui/dom.js';
import { indicadorSync } from './ui/componentes.js';
import { contarFila, ouvirFila, limparCache, listarFila } from './offline.js';
import { sincronizar, definirUsuario, ligarGatilhos, ouvirSync, estadoSync } from './sync.js';
import { estado, carregarDoAparelho, atualizarDoServidor, limparEstado } from './estado.js';
import { gerarPendentes } from './recorrencias.js';
import { enfileirar } from './offline.js';
import { hojeSP, competenciaDe } from './formato.js';
import { montarLogin, montarNovaSenha } from './ui/login.js';
import { montarNovoGasto } from './ui/novo-gasto.js';
import { montarNovoGanho } from './ui/novo-ganho.js';
import { montarLancamentos } from './ui/lancamentos.js';
import { montarPainel } from './ui/painel.js';
import { montarMais, montarCartoes, montarDiagnostico } from './ui/mais.js';
import { montarRecorrencias } from './ui/recorrencias.js';
import { montarCategorias } from './ui/categorias.js';
import { montarOrcamentos } from './ui/orcamentos.js';
import { montarPerfil } from './ui/perfil.js';
import { montarSaude } from './ui/saude.js';
import { montarExportar } from './ui/exportar.js';
import { reavaliarSeNecessario } from './saude.js';

const VERSAO = '1.0.0';
let BUILD = 'local';

// ---- Elementos fixos do index.html -----------------------------------------
const elTopo = document.getElementById('topo');
const elConteudo = document.getElementById('conteudo');
const elAbas = document.getElementById('abas');

/** Rotas: hash → { título, aba destacada, função que monta a tela } */
const ROTAS = {
  '#/gasto': { titulo: 'Novo gasto', aba: 'gasto', montar: montarNovoGasto },
  '#/ganho': { titulo: 'Novo ganho', aba: 'ganho', montar: montarNovoGanho },
  '#/lancamentos': { titulo: 'Lançamentos', aba: 'lancamentos', montar: montarLancamentos },
  '#/painel': { titulo: 'Painel', aba: 'painel', montar: montarPainel },
  '#/mais': { titulo: 'Mais', aba: 'mais', montar: montarMais },
  '#/mais/cartoes': { titulo: 'Cartões', aba: 'mais', montar: montarCartoes },
  '#/mais/diagnostico': { titulo: 'Diagnóstico', aba: 'mais', montar: montarDiagnostico },
  '#/mais/recorrencias': { titulo: 'Recorrências', aba: 'mais', montar: montarRecorrencias },
  '#/mais/categorias': { titulo: 'Categorias', aba: 'mais', montar: montarCategorias },
  '#/mais/orcamentos': { titulo: 'Orçamentos', aba: 'mais', montar: montarOrcamentos },
  '#/mais/perfil': { titulo: 'Perfil', aba: 'mais', montar: montarPerfil },
  '#/saude': { titulo: 'Saúde', aba: 'saude', montar: montarSaude },
  '#/mais/exportar': { titulo: 'Exportar', aba: 'mais', montar: montarExportar },
  // Edição de um lançamento (aberta a partir de Lançamentos).
  '#/editar': { titulo: 'Editar', aba: 'lancamentos', montar: montarEdicao },
};

/** Lançamento em edição (preenchido por editar() antes de navegar). */
let emEdicao = null;

/** Chamado pela lista de Lançamentos ao tocar num lançamento próprio. */
function editar(tipo, registro) {
  emEdicao = { tipo, registro };
  navegar('#/editar');
}

function montarEdicao(raiz, ctx) {
  if (!emEdicao) { // ex.: recarregou a página na tela de edição
    history.replaceState(null, '', '#/lancamentos');
    return montarLancamentos(raiz, ctx);
  }
  const { tipo, registro } = emEdicao;
  document.querySelector('#topo .titulo').textContent = tipo === 'despesa' ? 'Editar gasto' : 'Editar ganho';
  return tipo === 'despesa'
    ? montarNovoGasto(raiz, { ...ctx, edicao: registro })
    : montarNovoGanho(raiz, { ...ctx, edicao: registro });
}
const ROTA_INICIAL = '#/gasto';

let limparTelaAtual = null;
let appMontado = false;
let recuperandoSenha = false;
const indicador = indicadorSync({ aoTocar: () => sincronizar('manual') });

// =============================================================================
// Inicialização
// =============================================================================

async function iniciar() {
  log.info('app', `Iniciando versão ${VERSAO}`, { online: navigator.onLine });
  registrarServiceWorker();

  // 1) Configuração
  let config;
  try {
    ({ CONFIG: config } = await import('./config.js'));
    BUILD = config.build ?? 'local';
  } catch (e) {
    log.erro('app', 'js/config.js não encontrado', e);
    return telaErro('Configuração ausente',
      'O arquivo js/config.js não foi encontrado. No computador, copie js/config.exemplo.js para js/config.js e preencha a URL e a chave. Em produção ele é gerado pelo GitHub Actions.');
  }

  // 2) Cliente do Supabase
  try {
    db.iniciar(config);
  } catch (e) {
    log.erro('app', 'Falha ao iniciar Supabase', e);
    return telaErro('Sem conexão no primeiro acesso', 'Abra o app uma vez com internet para ele se instalar neste aparelho.');
  }

  db.ouvirAuth(aoMudarLogin);
  ligarGatilhos();
  ouvirFila(atualizarIndicador);
  ouvirSync(atualizarIndicador);
  window.addEventListener('online', atualizarIndicador);
  window.addEventListener('online', () => rotinasDeAbertura());
  window.addEventListener('offline', atualizarIndicador);

  // 3) Tela inicial sem depender de internet
  const temDados = await carregarDoAparelho();
  if (temDados && db.situacaoLocal() === 'logado') {
    abrirApp();
    atualizarDoServidor(estado.perfil.id)
      .then((atualizou) => { if (atualizou) rotinasDeAbertura(); })
      .catch(mostrarErroFamilia);
  } else {
    const user = db.situacaoLocal() === 'logado' ? await db.usuarioAtual() : null;
    if (user) await entrouComo(user);
    else await mostrarLogin();
  }
}

/** Reage a login/logout/renovação/recuperação de senha. */
function aoMudarLogin(evento) {
  log.info('auth', `Evento de login: ${evento}`);
  if (evento === 'PASSWORD_RECOVERY') {
    recuperandoSenha = true;
    montarNovaSenha(prepararTelaCheia(), {
      aoConcluir: async () => { recuperandoSenha = false; const u = await db.usuarioAtual(); if (u) entrouComo(u); },
    });
  } else if (evento === 'SIGNED_OUT' && appMontado && !recuperandoSenha) {
    // Sessão encerrada (ex.: senha trocada em outro aparelho). A fila fica.
    estadoSync.precisaLogin = true;
    atualizarIndicador();
    avisar('Sua sessão terminou. Entre novamente para continuar enviando.', { tipo: 'aviso', duracao: 6000 });
    mostrarLogin();
  }
}

/** Depois do login: baixa os dados da família e abre o app. */
async function entrouComo(user) {
  try {
    await atualizarDoServidor(user.id);
  } catch (e) {
    return mostrarErroFamilia(e);
  }
  if (!estado.perfil) {
    return telaErro('Sem conexão', 'Não foi possível baixar seus dados. Verifique a internet e tente de novo.');
  }
  abrirApp();
  rotinasDeAbertura();
}

/**
 * Rotinas ao abrir o app com internet, NESTA ORDEM:
 *   1. gerar os lançamentos fixos do mês (recorrências);
 *   2. sincronizar (para o servidor ter tudo);
 *   3. avaliar as regras da Saúde (no máximo a cada 6 h) e atualizar o selo.
 */
async function rotinasDeAbertura() {
  await gerarRecorrencias();
  await sincronizar('abertura-rotinas');
  await reavaliarSeNecessario();
  atualizarSelo();
}

/** Selo na aba Saúde: alertas da família não lidos no mês atual. */
async function atualizarSelo() {
  const selo = elAbas.querySelector('a[data-aba="saude"] .selo-aba');
  if (!selo || !navigator.onLine) return;
  try {
    const insights = await db.listarInsights(competenciaDe(hojeSP()));
    const n = insights.filter((i) => !i.lido && i.user_id == null && i.severidade !== 'info').length;
    selo.textContent = n ? String(n) : '';
    selo.hidden = !n;
  } catch { /* sem selo: não é crítico */ }
}

/**
 * Cria os lançamentos dos gastos/ganhos fixos que ainda não existem (RF-31).
 * Só com internet: precisa consultar o que já foi gerado (js/recorrencias.js).
 */
async function gerarRecorrencias() {
  if (!navigator.onLine || !estado.perfil) return;
  try {
    const criados = await gerarPendentes({
      userId: estado.perfil.id,
      recorrencias: estado.recorrencias,
      cartoes: estado.cartoes,
      competenciaAtual: competenciaDe(hojeSP()),
      jaGeradasNoServidor: db.chavesRecorrenciaGeradas,
      fila: await listarFila(estado.perfil.id),
      enfileirar,
    });
    if (criados > 0) {
      log.info('recorrencias', `${criados} lançamento(s) fixo(s) gerado(s)`);
      avisar(`🔁 ${criados} lançamento(s) fixo(s) do mês adicionado(s)`, { tipo: 'info', duracao: 4000 });
      sincronizar('recorrencias');
    }
  } catch (e) {
    log.aviso('recorrencias', 'Não foi possível gerar os lançamentos fixos agora', e);
  }
}

function mostrarErroFamilia(e) {
  telaErro('Conta sem família', e.message);
}

async function mostrarLogin() {
  appMontado = false;
  const pendentes = (await listarFila()).filter((i) => i.estado === 'pendente').length;
  montarLogin(prepararTelaCheia(), { aoEntrar: entrouComo, pendentes });
}

/** Abre o app (abas, topo, rota atual). */
function abrirApp() {
  definirUsuario(estado.perfil.id);
  document.body.classList.remove('sem-abas');
  if (!appMontado) {
    appMontado = true;
    montarAbas();
    window.addEventListener('hashchange', rotear);
  }
  rotear();
  atualizarIndicador();
  sincronizar('abertura');
}

async function sairDaConta() {
  appMontado = false; // antes do signOut: evita o aviso de "sessão terminou"
  window.removeEventListener('hashchange', rotear);
  await db.sair();
  await limparCache();
  limparEstado();
  location.hash = '';
  mostrarLogin();
}

// =============================================================================
// Navegação
// =============================================================================

function navegar(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

function rotear() {
  if (!appMontado) return;
  const rota = ROTAS[location.hash] ?? ROTAS[ROTA_INICIAL];
  if (!ROTAS[location.hash]) history.replaceState(null, '', ROTA_INICIAL);

  if (typeof limparTelaAtual === 'function') limparTelaAtual();
  limparTelaAtual = null;
  if (location.hash !== '#/editar') emEdicao = null;

  document.title = `${rota.titulo} · Finanças da Família`;
  trocar(elTopo, h('h1', { class: 'titulo' }, rota.titulo), indicador.elemento);
  elAbas.querySelectorAll('a').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === rota.aba));
  elConteudo.scrollTop = 0;

  try {
    limparTelaAtual = rota.montar(elConteudo, {
      navegar, editar, gerarRecorrencias, aoMudarAlertas: atualizarSelo, aoSair: sairDaConta, versao: VERSAO, build: BUILD,
    });
  } catch (e) {
    log.erro('app', `Erro ao abrir a tela ${location.hash}`, e);
    trocar(elConteudo, h('p', { class: 'vazio' }, 'Erro ao abrir esta tela. Veja Mais → Diagnóstico.'));
  }
}

function montarAbas() {
  const abas = [
    ['gasto', '#/gasto', '➖', 'Gasto'],
    ['ganho', '#/ganho', '➕', 'Ganho'],
    ['lancamentos', '#/lancamentos', '📋', 'Lançam.'],
    ['painel', '#/painel', '📊', 'Painel'],
    ['saude', '#/saude', '🩺', 'Saúde'],
    ['mais', '#/mais', '☰', 'Mais'],
  ];
  trocar(elAbas, abas.map(([aba, href, icone, texto]) => h('a', { href, dataset: { aba }, 'aria-label': texto },
    h('span', { class: 'aba-icone', 'aria-hidden': 'true' }, icone),
    aba === 'saude' ? h('span', { class: 'selo-aba', hidden: true, 'aria-label': 'alertas não lidos' }) : null,
    h('span', {}, texto))));
}

/** Telas sem abas (login, erro). */
function prepararTelaCheia() {
  if (typeof limparTelaAtual === 'function') limparTelaAtual();
  limparTelaAtual = null;
  document.body.classList.add('sem-abas');
  trocar(elTopo);
  trocar(elAbas);
  return elConteudo;
}

function telaErro(titulo, texto) {
  trocar(prepararTelaCheia(), h('section', { class: 'tela-login' },
    h('h1', {}, titulo), h('p', {}, texto),
    h('button', { type: 'button', class: 'btn btn-primario', onclick: () => location.reload() }, 'Tentar de novo')));
}

// =============================================================================
// Indicador de sincronização
// =============================================================================

async function atualizarIndicador() {
  const { pendentes, comErro } = await contarFila(estado.perfil?.id);
  indicador.atualizar({
    pendentes, comErro,
    sincronizando: estadoSync.sincronizando,
    precisaLogin: estadoSync.precisaLogin,
    online: navigator.onLine,
  });
}

// =============================================================================
// Service Worker (cache do app para abrir sem internet) e atualizações
// =============================================================================

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log.aviso('app', 'Navegador sem Service Worker: o app não abrirá sem internet');
    return;
  }
  navigator.serviceWorker.register('sw.js').then((reg) => {
    log.info('app', 'Service Worker registrado');
    // Nova versão publicada: oferece atualizar (não recarrega sozinho no meio de um lançamento).
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      novo?.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) oferecerAtualizacao(novo);
      });
    });
  }).catch((e) => log.erro('app', 'Falha ao registrar Service Worker', e));

  // Só recarrega quando uma versão NOVA assume (atualização). Na primeira
  // instalação não havia controlador: recarregar ali atrapalharia o uso.
  const eraControlado = Boolean(navigator.serviceWorker.controller);
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregando || !eraControlado) return;
    recarregando = true;
    location.reload();
  });
}

function oferecerAtualizacao(worker) {
  log.info('app', 'Nova versão disponível');
  const faixa = h('button', {
    type: 'button', class: 'faixa-atualizacao',
    onclick: () => worker.postMessage({ tipo: 'ATUALIZAR_AGORA' }),
  }, '✨ Nova versão disponível — toque para atualizar');
  document.body.append(faixa);
}

iniciar();
