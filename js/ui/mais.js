/**
 * =============================================================================
 * js/ui/mais.js — Aba "Mais": perfil, cartões, diagnóstico e sair
 * -----------------------------------------------------------------------------
 *   * Perfil (js/ui/perfil.js), Categorias (js/ui/categorias.js),
 *     Recorrências (js/ui/recorrencias.js), Orçamentos (js/ui/orcamentos.js).
 *   * Cartões (aqui): cadastrar, editar e excluir/arquivar.
 *   * Diagnóstico: logs do app (RNF-41), situação da fila e do app.
 *   * Sair.
 * Fase 5: exportação JSON/CSV.
 * =============================================================================
 */
import { h, trocar, avisar, confirmar, formularioDialogo } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { contarFila } from '../offline.js';
import { estadoSync, sincronizar } from '../sync.js';
import { moeda, dataHoraBR, lerValorBR, valorParaCampo } from '../formato.js';
import { validarCartao } from '../validacao.js';
import { estado, atualizarDoServidor, nomeMembro } from '../estado.js';

const BANDEIRAS = [
  ['mastercard', 'Mastercard'], ['visa', 'Visa'], ['elo', 'Elo'],
  ['amex', 'American Express'], ['hipercard', 'Hipercard'], ['outra', 'Outra'],
];

// =============================================================================
// Menu
// =============================================================================

export function montarMais(raiz, { navegar, aoSair, versao }) {
  const item = (icone, texto, destino, sub) => h('button', { type: 'button', class: 'menu-item', onclick: () => navegar(destino) },
    h('span', { class: 'menu-icone' }, icone),
    h('span', { class: 'menu-texto' }, texto, sub ? h('small', {}, sub) : null),
    h('span', { class: 'menu-seta' }, '›'));

  const emBreve = (icone, texto, fase) => h('div', { class: 'menu-item desativado' },
    h('span', { class: 'menu-icone' }, icone),
    h('span', { class: 'menu-texto' }, texto, h('small', {}, `chega na ${fase}`)));

  trocar(raiz, h('section', { class: 'tela' },
    h('div', { class: 'perfil-topo' },
      h('span', { class: 'avatar', style: { background: estado.perfil?.cor_identificacao } }, (estado.perfil?.nome ?? '?')[0]),
      h('div', {}, h('strong', {}, estado.perfil?.nome ?? ''), h('small', {}, 'Família · ', estado.membros.map((m) => m.nome).join(' e ')))),
    h('div', { class: 'menu' },
      item('🔁', 'Recorrências', '#/mais/recorrencias', 'gastos e ganhos fixos do mês'),
      item('💳', 'Cartões', '#/mais/cartoes', `${estado.cartoes.filter((c) => c.ativo).length} ativo(s)`),
      item('🏷️', 'Categorias', '#/mais/categorias', 'criar, editar, excluir'),
      item('🎯', 'Orçamentos', '#/mais/orcamentos', 'limite mensal por categoria'),
      item('👤', 'Perfil', '#/mais/perfil', 'nome, cor e senha'),
      emBreve('📤', 'Exportar dados (JSON/CSV)', 'Fase 5'),
      item('🩺', 'Diagnóstico e logs', '#/mais/diagnostico')),
    h('div', { class: 'menu' },
      h('button', {
        type: 'button', class: 'menu-item perigo',
        onclick: async () => {
          const { pendentes } = await contarFila(estado.perfil?.id);
          const texto = pendentes > 0
            ? `Você tem ${pendentes} lançamento(s) ainda não enviado(s). Eles ficam guardados neste aparelho e serão enviados quando você entrar de novo. Sair mesmo assim?`
            : 'Sair da conta neste aparelho?';
          if (await confirmar(texto, { sim: 'Sair', perigoso: true })) aoSair();
        },
      }, h('span', { class: 'menu-icone' }, '🚪'), h('span', { class: 'menu-texto' }, 'Sair'))),
    h('p', { class: 'dica centro' }, `Versão ${versao}`)));
}

// =============================================================================
// Cartões
// =============================================================================

export function montarCartoes(raiz, { navegar }) {
  const lista = h('div', { class: 'lista' });
  const form = formularioCartao(async () => { await recarregar(); });

  async function recarregar() {
    await atualizarDoServidor(estado.perfil.id);
    desenhar();
  }

  function desenhar() {
    const cartoes = [...estado.cartoes].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.apelido.localeCompare(b.apelido));
    if (cartoes.length === 0) { trocar(lista, h('p', { class: 'vazio' }, 'Nenhum cartão cadastrado ainda.')); return; }
    trocar(lista, cartoes.map((c) => {
      const meu = c.user_id === estado.perfil.id;
      return h('div', { class: `item${c.ativo ? '' : ' arquivado'}` },
        h('span', { class: 'item-icone' }, '💳'),
        h('div', { class: 'item-texto' },
          h('strong', {}, `${c.apelido} ••${c.ultimos4}`),
          h('small', {}, [
            BANDEIRAS.find(([v]) => v === c.bandeira)?.[1] ?? c.bandeira,
            `fecha dia ${c.dia_fechamento}`, `vence dia ${c.dia_vencimento}`,
            c.limite_centavos ? `limite ${moeda(c.limite_centavos)}` : null,
            meu ? null : `de ${nomeMembro(c.user_id)}`,
            c.ativo ? null : 'ARQUIVADO',
          ].filter(Boolean).join(' · '))),
        meu && c.ativo ? h('div', { class: 'item-acoes' },
          h('button', { type: 'button', class: 'link', onclick: () => editar(c) }, 'Editar'),
          h('button', { type: 'button', class: 'link perigo', onclick: () => excluir(c) }, 'Excluir')) : null);
    }));
  }

  async function editar(c) {
    const v = await formularioDialogo({
      titulo: `Editar ${c.apelido}`,
      texto: 'Mudar fechamento/vencimento vale para as PRÓXIMAS compras; as já lançadas mantêm as faturas calculadas.',
      campos: [
        { nome: 'apelido', rotulo: 'Apelido', valor: c.apelido, atributos: { maxlength: '40' } },
        { nome: 'dia_fechamento', rotulo: 'Fecha dia', tipo: 'number', valor: String(c.dia_fechamento), atributos: { min: '1', max: '31' } },
        { nome: 'dia_vencimento', rotulo: 'Vence dia', tipo: 'number', valor: String(c.dia_vencimento), atributos: { min: '1', max: '31' } },
        { nome: 'limite', rotulo: 'Limite (R$, opcional)', valor: c.limite_centavos ? valorParaCampo(c.limite_centavos) : '', atributos: { inputmode: 'decimal' } },
      ],
      validar: (x) => validarCartao({ ...c, apelido: x.apelido, dia_fechamento: Number(x.dia_fechamento), dia_vencimento: Number(x.dia_vencimento),
        limite_centavos: x.limite.trim() ? lerValorBR(x.limite) : null })[0] ?? null,
    });
    if (!v) return;
    try {
      await db.atualizarCartao(c.id, {
        apelido: v.apelido.trim(), dia_fechamento: Number(v.dia_fechamento), dia_vencimento: Number(v.dia_vencimento),
        limite_centavos: v.limite.trim() ? lerValorBR(v.limite) : null,
      });
      avisar('Cartão atualizado ✓', { tipo: 'ok' });
      await recarregar();
    } catch (e) {
      avisar(e.tipo === 'rede' ? 'Sem internet — precisa de conexão.' : e.message, { tipo: 'erro' });
    }
  }

  async function excluir(c) {
    const ok = await confirmar(`Excluir o cartão "${c.apelido} ••${c.ultimos4}"? Se ele já tiver compras, será ARQUIVADO (some das telas, mas o histórico continua).`, { sim: 'Excluir', perigoso: true });
    if (!ok) return;
    try {
      const resultado = await db.excluirCartao(c.id);
      avisar(resultado === 'arquivado' ? 'Cartão arquivado (tinha compras) ✓' : 'Cartão excluído ✓', { tipo: 'ok' });
      log.info('cartoes', `Cartão ${resultado}`, { id: c.id });
      await recarregar();
    } catch (e) {
      avisar(e.tipo === 'rede' ? 'Sem internet — excluir cartão precisa de conexão.' : e.message, { tipo: 'erro' });
    }
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    h('h2', {}, 'Cartões de crédito'),
    lista,
    h('h3', { class: 'rotulo' }, 'Novo cartão'),
    form));
  desenhar();
}

/** Formulário de novo cartão. Cadastro precisa de internet (vai direto ao banco). */
function formularioCartao(aoSalvar) {
  const campo = (props) => h('input', { class: 'campo', ...props });
  const apelido = campo({ placeholder: 'Apelido (ex.: Nubank Renan)', maxlength: '40' });
  const bandeira = h('select', { class: 'campo' },
    h('option', { value: '' }, 'Bandeira…'), BANDEIRAS.map(([v, t]) => h('option', { value: v }, t)));
  const ultimos4 = campo({ placeholder: '4 últimos números', inputmode: 'numeric', maxlength: '4', pattern: '[0-9]{4}' });
  const fechamento = campo({ placeholder: 'Fecha dia', inputmode: 'numeric', type: 'number', min: '1', max: '31' });
  const vencimento = campo({ placeholder: 'Vence dia', inputmode: 'numeric', type: 'number', min: '1', max: '31' });
  const limite = campo({ placeholder: 'Limite em R$ (opcional)', inputmode: 'decimal' });
  const mensagem = h('p', { class: 'mensagem-form', role: 'alert' });
  const botao = h('button', { type: 'submit', class: 'btn btn-primario' }, 'Salvar cartão');

  return h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      const limiteReais = limite.value.trim().replace(/\./g, '').replace(',', '.');
      const cartao = {
        apelido: apelido.value.trim(),
        bandeira: bandeira.value,
        ultimos4: ultimos4.value.trim(),
        dia_fechamento: Number(fechamento.value),
        dia_vencimento: Number(vencimento.value),
        limite_centavos: limiteReais ? Math.round(Number(limiteReais) * 100) : null,
      };
      const erros = validarCartao(cartao);
      if (erros.length) { mensagem.textContent = erros.join(' '); return; }
      botao.disabled = true;
      try {
        await db.criarCartao(cartao);
        log.info('cartoes', 'Cartão criado', { apelido: cartao.apelido });
        avisar('Cartão cadastrado ✓', { tipo: 'ok' });
        e.target.reset();
        mensagem.textContent = '';
        await aoSalvar();
      } catch (erro) {
        mensagem.textContent = erro.tipo === 'rede' ? 'Sem internet — o cadastro de cartão precisa de conexão.' : erro.message;
      } finally {
        botao.disabled = false;
      }
    },
  }, apelido, bandeira, ultimos4,
  h('div', { class: 'linha-2' }, fechamento, vencimento),
  h('p', { class: 'dica' }, 'Compra antes do dia de fechamento entra na fatura do mês; no dia ou depois, na seguinte.'),
  limite, botao, mensagem);
}

// =============================================================================
// Diagnóstico e logs
// =============================================================================

export function montarDiagnostico(raiz, { navegar, versao, build }) {
  const info = h('dl', { class: 'info' });
  const areaLogs = h('pre', { class: 'logs' });

  async function desenharInfo() {
    const fila = await contarFila(estado.perfil?.id);
    const sw = navigator.serviceWorker?.controller ? 'ativo' : 'não ativo';
    const linhas = [
      ['Versão', `${versao} (${build})`],
      ['Usuário', `${estado.perfil?.nome} · ${estado.perfil?.id?.slice(0, 8)}…`],
      ['Internet', navigator.onLine ? 'conectado' : 'sem conexão'],
      ['Pendentes de envio', String(fila.pendentes)],
      ['Recusados pelo servidor', String(fila.comErro)],
      ['Última sincronização', estadoSync.ultimoSucesso ? dataHoraBR(estadoSync.ultimoSucesso) : '—'],
      ['Último erro de envio', estadoSync.ultimoErro ?? '—'],
      ['Modo offline (Service Worker)', sw],
      ['Instalado na Tela de Início', matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'sim' : 'não'],
    ];
    trocar(info, linhas.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  function desenharLogs() {
    const registros = log.todos().slice(-200).reverse();
    areaLogs.textContent = registros.length
      ? registros.map((r) => `${dataHoraBR(r.em)} ${r.nivel.toUpperCase()} [${r.modulo}] ${r.mensagem}${r.dados ? ` ${JSON.stringify(r.dados)}` : ''}`).join('\n')
      : 'Nenhum registro.';
  }

  const baixar = () => {
    const blob = new Blob([log.comoTexto()], { type: 'text/plain;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `financas-logs-${new Date().toISOString().slice(0, 10)}.txt` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(log.comoTexto()); avisar('Logs copiados ✓', { tipo: 'ok' }); }
    catch { avisar('Não foi possível copiar; use "Baixar".', { tipo: 'aviso' }); }
  };

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    info,
    h('div', { class: 'botoes' },
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: async () => { await sincronizar('manual'); desenharInfo(); } }, '⟳ Sincronizar agora'),
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: copiar }, 'Copiar logs'),
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: baixar }, 'Baixar logs'),
      h('button', {
        type: 'button', class: 'btn btn-secundario',
        onclick: async () => { if (await confirmar('Apagar os logs deste aparelho?')) { log.limpar(); desenharLogs(); } },
      }, 'Limpar logs')),
    h('h3', { class: 'rotulo' }, 'Registros (mais recentes primeiro)'),
    areaLogs));

  desenharInfo();
  desenharLogs();
  return log.ouvir(() => desenharLogs());
}
