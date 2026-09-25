/**
 * =============================================================================
 * js/ui/saude.js — Aba "Saúde": alertas, tarefas e tarefas do Claude (RF-72, RF-73)
 * -----------------------------------------------------------------------------
 *   * ALERTAS do mês (motor de regras — js/regras.js), por visão (Eu /
 *     cônjuge / Família), do mais grave ao mais leve. Ícone + texto em cada
 *     severidade (nunca só cor).
 *   * TAREFAS da família: marcar como feita (checkbox), descartar, criar
 *     manualmente — ambos veem e podem concluir.
 *   * IMPORTAR TAREFAS DO CLAUDE: cole a resposta da Skill (ou escolha o
 *     arquivo .json); o app mostra a prévia antes de gravar.
 * Precisa de internet para gravar; sem sinal mostra a última cópia.
 * =============================================================================
 */
import { h, trocar, avisar, confirmar, formularioDialogo } from './dom.js';
import { chips } from './componentes.js';
import * as db from '../db.js';
import { reavaliar } from '../saude.js';
import { lerTarefasDoClaude, semDuplicadas } from '../exportacao.js';
import { PESO_SEVERIDADE } from '../regras.js';
import { lerCache, gravarCache } from '../offline.js';
import { log } from '../log.js';
import { mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia, dataHoraBR } from '../formato.js';
import { estado, membrosOrdenados, nomeMembro } from '../estado.js';

const SEVERIDADE = {
  critico: { icone: '⛔', rotulo: 'Crítico' },
  atencao: { icone: '⚠️', rotulo: 'Atenção' },
  info: { icone: 'ℹ️', rotulo: 'Info' },
};
const PRIORIDADE = { 1: 'alta', 2: 'média', 3: 'baixa' };
const ORIGEM = { regra: '🤖 regra', claude: '✨ Claude', manual: '✍️ manual' };

const filtros = { competencia: null, visao: 'familia', verFeitas: false };

export function montarSaude(raiz, { aoMudarAlertas }) {
  filtros.competencia ??= competenciaDe(hojeSP());
  let insights = [];
  let tarefas = [];

  const titulo = h('h2', { class: 'titulo-mes' });
  const aviso = h('p', { class: 'dica' });
  const areaAlertas = h('div');
  const areaTarefas = h('div');
  const erroDe = (e) => (e.tipo === 'rede' ? 'Sem internet — tente de novo com conexão.' : e.message);

  const opcoesVisao = [
    ...membrosOrdenados().map((m) => ({ valor: m.id, rotulo: m.id === estado.perfil.id ? 'Eu' : m.nome })),
    { valor: 'familia', rotulo: 'Família' },
  ];
  const seletorVisao = chips({ opcoes: opcoesVisao, valor: filtros.visao, rotulo: 'Visão', rolavel: false,
    aoEscolher: (v) => { filtros.visao = v; desenharAlertas(); } });

  const mudarMes = (n) => { filtros.competencia = somarMesesCompetencia(filtros.competencia, n); carregar(); };

  // ---- Dados -------------------------------------------------------------------
  async function carregar({ reavaliarAntes = false } = {}) {
    const competencia = filtros.competencia;
    titulo.textContent = mesExtenso(competencia);
    const guardado = await lerCache(`saude:${competencia}`);
    if (guardado) ({ insights, tarefas } = guardado);
    desenharAlertas();
    desenharTarefas();
    aviso.textContent = reavaliarAntes ? 'Avaliando…' : '';
    try {
      if (reavaliarAntes) {
        const r = await reavaliar(competencia);
        if (r.tarefasCriadas) avisar(`${r.tarefasCriadas} tarefa(s) nova(s) sugerida(s) pelas regras`, { tipo: 'info' });
      }
      [insights, tarefas] = await Promise.all([db.listarInsights(competencia), db.listarTarefas()]);
      if (competencia !== filtros.competencia) return;
      await gravarCache(`saude:${competencia}`, { insights, tarefas });
      aviso.textContent = '';
    } catch (e) {
      aviso.textContent = e.tipo === 'rede' ? (guardado ? 'Sem internet — mostrando a última cópia.' : 'Sem internet.') : e.message;
    }
    desenharAlertas();
    desenharTarefas();
    aoMudarAlertas?.();
  }

  // ---- Alertas -------------------------------------------------------------------
  function desenharAlertas() {
    const alvo = filtros.visao === 'familia' ? null : filtros.visao;
    const lista = insights.filter((i) => (i.user_id ?? null) === alvo)
      .sort((a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade]);
    const naoLidos = lista.filter((i) => !i.lido);

    trocar(areaAlertas,
      h('div', { class: 'cabecalho-secao' },
        h('h3', { class: 'secao-titulo' }, `Alertas${lista.length ? ` (${lista.length})` : ''}`),
        naoLidos.length ? h('button', {
          type: 'button', class: 'link',
          onclick: async () => {
            try {
              await db.marcarInsightsLidos(naoLidos.map((i) => i.id));
              naoLidos.forEach((i) => { i.lido = true; });
              desenharAlertas();
              aoMudarAlertas?.();
            } catch (e) { avisar(erroDe(e), { tipo: 'erro' }); }
          },
        }, 'Marcar como lidos') : null),
      lista.length === 0
        ? h('p', { class: 'vazio saudavel' }, '✅ Nenhum alerta nesta visão. Tudo dentro dos limites!')
        : h('ul', { class: 'lista-alertas' }, lista.map((i) => h('li', { class: `alerta ${i.severidade}${i.lido ? ' lido' : ''}` },
          h('span', { class: 'alerta-icone', 'aria-hidden': 'true' }, SEVERIDADE[i.severidade].icone),
          h('div', {},
            h('strong', { class: 'alerta-sev' }, SEVERIDADE[i.severidade].rotulo, i.lido ? null : h('span', { class: 'selo novo' }, 'novo')),
            h('p', {}, i.mensagem))))));
  }

  // ---- Tarefas -------------------------------------------------------------------
  function desenharTarefas() {
    const abertas = tarefas.filter((t) => t.status === 'aberta').sort((a, b) => a.prioridade - b.prioridade);
    const feitas = tarefas.filter((t) => t.status !== 'aberta');

    trocar(areaTarefas,
      h('div', { class: 'cabecalho-secao' }, h('h3', { class: 'secao-titulo' }, `Tarefas (${abertas.length} abertas)`)),
      abertas.length === 0 ? h('p', { class: 'vazio' }, 'Nenhuma tarefa aberta.') : h('ul', { class: 'lista-tarefas' }, abertas.map(linhaTarefa)),
      h('div', { class: 'botoes' },
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: novaTarefa }, '+ Nova tarefa'),
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: importarDoClaude }, '✨ Importar tarefas do Claude')),
      feitas.length ? h('details', { class: 'feitas', open: filtros.verFeitas, ontoggle: (e) => { filtros.verFeitas = e.target.open; } },
        h('summary', {}, `Concluídas e descartadas (${feitas.length})`),
        h('ul', { class: 'lista-tarefas' }, feitas.map(linhaTarefa))) : null);
  }

  function linhaTarefa(t) {
    const feita = t.status === 'feita';
    const detalhes = [`prioridade ${PRIORIDADE[t.prioridade]}`, ORIGEM[t.origem], t.user_id ? nomeMembro(t.user_id) : 'Família'];
    if (t.concluida_em) detalhes.push(`${t.status === 'feita' ? 'feita' : 'descartada'} em ${dataHoraBR(t.concluida_em)}`);
    return h('li', { class: `tarefa${t.status !== 'aberta' ? ' encerrada' : ''} p${t.prioridade}` },
      h('input', {
        type: 'checkbox', checked: feita, 'aria-label': `Concluir: ${t.titulo}`, disabled: t.status === 'descartada',
        onchange: (e) => mudarStatus(t, e.target.checked ? 'feita' : 'aberta'),
      }),
      h('div', { class: 'tarefa-texto' },
        h('strong', {}, t.titulo),
        t.descricao ? h('p', {}, t.descricao) : null,
        h('small', {}, detalhes.join(' · '))),
      t.status === 'aberta'
        ? h('button', { type: 'button', class: 'link perigo', 'aria-label': 'Descartar', onclick: () => mudarStatus(t, 'descartada') }, '✕')
        : t.status === 'descartada' ? h('button', { type: 'button', class: 'link', onclick: () => mudarStatus(t, 'aberta') }, 'Reabrir') : null);
  }

  async function mudarStatus(t, status) {
    if (status === 'descartada' && !await confirmar(`Descartar "${t.titulo}"?`, { sim: 'Descartar' })) { desenharTarefas(); return; }
    try {
      await db.atualizarTarefa(t.id, { status, concluida_em: status === 'aberta' ? null : new Date().toISOString() });
      Object.assign(t, { status, concluida_em: status === 'aberta' ? null : new Date().toISOString() });
      if (status === 'feita') avisar('Tarefa concluída ✓ 🎉', { tipo: 'ok' });
      log.info('saude', `Tarefa ${status}`, { id: t.id });
      desenharTarefas();
    } catch (e) {
      avisar(erroDe(e), { tipo: 'erro' });
      desenharTarefas();
    }
  }

  async function novaTarefa() {
    const v = await formularioDialogo({
      titulo: 'Nova tarefa',
      campos: [
        { nome: 'titulo', rotulo: 'O que fazer', atributos: { maxlength: '120' } },
        { nome: 'descricao', rotulo: 'Detalhes (opcional)', atributos: { maxlength: '1000' } },
        { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', valor: '2', opcoes: [{ valor: '1', rotulo: 'Alta' }, { valor: '2', rotulo: 'Média' }, { valor: '3', rotulo: 'Baixa' }] },
        { nome: 'responsavel', rotulo: 'Responsável', tipo: 'select', valor: '', opcoes: [{ valor: '', rotulo: 'Família' }, ...membrosOrdenados().map((m) => ({ valor: m.id, rotulo: m.nome }))] },
      ],
      validar: (x) => (!x.titulo.trim() ? 'Descreva a tarefa.' : null),
    });
    if (!v) return;
    try {
      await db.criarTarefas([{ titulo: v.titulo.trim(), descricao: v.descricao.trim() || null, prioridade: Number(v.prioridade), origem: 'manual', user_id: v.responsavel || null }]);
      avisar('Tarefa criada ✓', { tipo: 'ok' });
      carregar();
    } catch (e) { avisar(erroDe(e), { tipo: 'erro' }); }
  }

  // ---- Importar do Claude ------------------------------------------------------------
  async function importarDoClaude() {
    const texto = h('textarea', { class: 'campo area-colar', rows: '8', placeholder: 'Cole aqui a resposta do Claude (o bloco com "financas-familia/tarefas@1")' });
    const arquivo = h('input', { type: 'file', accept: '.json,application/json,text/plain', class: 'campo' });
    arquivo.addEventListener('change', async () => { if (arquivo.files[0]) texto.value = await arquivo.files[0].text(); });
    const erro = h('p', { class: 'mensagem-form', role: 'alert' });

    const resultado = await new Promise((resolve) => {
      const dialogo = h('dialog', { class: 'dialogo dialogo-largo' },
        h('h3', { class: 'dialogo-titulo' }, '✨ Importar tarefas do Claude'),
        h('p', { class: 'dica' }, 'Cole a resposta da Skill "Consultor Financeiro Familiar" ou escolha o arquivo .json.'),
        texto, arquivo, erro,
        h('div', { class: 'dialogo-botoes' },
          h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => fechar(null) }, 'Cancelar'),
          h('button', {
            type: 'button', class: 'btn btn-primario',
            onclick: () => {
              const r = lerTarefasDoClaude(texto.value, estado.membros);
              if (r.tarefas.length === 0) { erro.textContent = r.erros.join(' '); return; }
              fechar(r);
            },
          }, 'Ver prévia')));
      const fechar = (r) => { dialogo.close(); dialogo.remove(); resolve(r); };
      dialogo.addEventListener('cancel', () => fechar(null));
      document.body.append(dialogo);
      dialogo.showModal();
    });
    if (!resultado) return;

    const novas = semDuplicadas(resultado.tarefas, tarefas);
    const repetidas = resultado.tarefas.length - novas.length;
    if (novas.length === 0) { avisar('Essas tarefas já estão abertas — nada novo para importar.', { tipo: 'info' }); return; }
    const previa = novas.map((t) => `• [${PRIORIDADE[t.prioridade]}] ${t.titulo}${t.user_id ? ` (${nomeMembro(t.user_id, { eu: false })})` : ''}`).join('\n');
    const avisos = [...resultado.erros, repetidas ? `${repetidas} já existia(m) aberta(s) e será(ão) ignorada(s).` : null].filter(Boolean).join('\n');
    if (!await confirmar(`Importar ${novas.length} tarefa(s)?\n\n${previa}${avisos ? `\n\n${avisos}` : ''}`, { sim: 'Importar' })) return;
    try {
      const criadas = await db.criarTarefas(novas.map((t) => ({ ...t, origem: 'claude' })));
      log.info('saude', `${criadas} tarefa(s) importada(s) do Claude`);
      avisar(`${criadas} tarefa(s) do Claude importada(s) ✓`, { tipo: 'ok' });
      carregar();
    } catch (e) { avisar(erroDe(e), { tipo: 'erro' }); }
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('div', { class: 'nav-mes' },
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      titulo,
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›')),
    seletorVisao.elemento,
    h('div', { class: 'botoes' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => carregar({ reavaliarAntes: true }) }, '⟳ Reavaliar agora')),
    aviso,
    h('div', { class: 'secao' }, areaAlertas),
    h('div', { class: 'secao' }, areaTarefas),
    h('p', { class: 'dica' }, 'Os alertas são recalculados ao abrir o app (a cada 6 h) e no "Reavaliar agora". Limites em js/regras.js. Para uma análise completa, exporte o mês (Mais → Exportar) e envie para a Skill do Claude.')));

  // Ao abrir a aba: reavalia o mês escolhido (com internet) e mostra.
  carregar({ reavaliarAntes: navigator.onLine });
}
