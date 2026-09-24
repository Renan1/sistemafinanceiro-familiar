/**
 * =============================================================================
 * js/ui/recorrencias.js — Gastos e ganhos fixos mensais (RF-30 a RF-32)
 * -----------------------------------------------------------------------------
 * Cadastre UMA vez o que se repete todo mês (salário, aluguel, internet,
 * streaming…). O app cria o lançamento de cada mês sozinho, ao abrir com
 * internet (js/recorrencias.js).
 *
 * Ações (só nas suas; as do cônjuge aparecem para consulta):
 *   * Pausar / Retomar  — pausada não gera lançamentos.
 *   * Alterar valor a partir de um mês — preserva o histórico (sql/004).
 *   * Encerrar — define o último mês.
 *   * Excluir — some o cadastro; lançamentos já gerados CONTINUAM.
 * Todas precisam de internet (vão direto ao banco).
 * =============================================================================
 */
import { h, trocar, avisar, confirmar, formularioDialogo } from './dom.js';
import { chips, segmentado } from './componentes.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { moeda, mesAbrev, hojeSP, competenciaDe, lerValorBR, valorParaCampo } from '../formato.js';
import { estado, atualizarDoServidor, categoriasOrdenadas, categoriaPorId, cartoesAtivos, cartaoPorId, nomeMembro } from '../estado.js';

const FORMAS = [['pix', 'PIX'], ['debito', 'Débito'], ['credito', 'Crédito'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['outro', 'Outro']];

/** Situação para exibir: ativa, pausada ou encerrada (data_fim no passado). */
function situacao(r) {
  if (r.data_fim && r.data_fim < hojeSP()) return 'encerrada';
  return r.ativa ? 'ativa' : 'pausada';
}

export function montarRecorrencias(raiz, { navegar, gerarRecorrencias }) {
  const lista = h('div');
  const formulario = h('div');

  const erroDe = (e) => (e.tipo === 'rede' ? 'Sem internet — recorrências precisam de conexão.' : e.message);

  async function recarregar() {
    await atualizarDoServidor(estado.perfil.id);
    desenhar();
  }

  function desenhar() {
    const grupos = { despesa: [], receita: [] };
    for (const r of estado.recorrencias) grupos[r.tipo]?.push(r);
    const ordenar = (a, b) => ['ativa', 'pausada', 'encerrada'].indexOf(situacao(a)) - ['ativa', 'pausada', 'encerrada'].indexOf(situacao(b))
      || a.descricao.localeCompare(b.descricao);

    const total = (tipo) => grupos[tipo].filter((r) => situacao(r) === 'ativa').reduce((s, r) => s + r.valor_centavos, 0);

    trocar(lista,
      h('div', { class: 'totais' },
        h('span', {}, 'Ganhos fixos/mês', h('strong', { class: 'positivo' }, moeda(total('receita')))),
        h('span', {}, 'Gastos fixos/mês', h('strong', {}, moeda(total('despesa'))))),
      ['receita', 'despesa'].map((tipo) => [
        h('h3', { class: 'rotulo' }, tipo === 'receita' ? 'Ganhos fixos' : 'Gastos fixos'),
        grupos[tipo].length
          ? h('div', { class: 'lista' }, grupos[tipo].sort(ordenar).map(linha))
          : h('p', { class: 'vazio' }, 'Nenhum cadastrado.'),
      ]));
  }

  function linha(r) {
    const cat = categoriaPorId(r.categoria_id);
    const meu = r.user_id === estado.perfil.id;
    const sit = situacao(r);
    const detalhes = [`todo dia ${r.dia_do_mes}`, cat?.nome, nomeMembro(r.user_id)];
    if (r.tipo === 'despesa') detalhes.push(FORMAS.find(([v]) => v === r.forma_pagamento)?.[1]);
    if (r.cartao_id) detalhes.push(cartaoPorId(r.cartao_id)?.apelido);
    detalhes.push(`desde ${mesAbrev(r.data_inicio)}`);
    if (r.data_fim) detalhes.push(`até ${mesAbrev(r.data_fim)}`);

    return h('div', { class: `item${sit !== 'ativa' ? ' arquivado' : ''}${meu ? ' clicavel' : ''}`, onclick: () => (meu ? acoes(r) : null) },
      h('span', { class: 'item-icone', style: { '--cor-cat': cat?.cor ?? '#8E8E93' } }, cat?.icone ?? '🔁'),
      h('div', { class: 'item-texto' },
        h('strong', {}, r.descricao, sit !== 'ativa' ? h('span', { class: `selo ${sit}` }, sit) : null),
        h('small', {}, detalhes.filter(Boolean).join(' · '))),
      h('span', { class: `item-valor ${r.tipo === 'receita' ? 'positivo' : ''}` }, moeda(r.valor_centavos)),
      meu ? h('span', { class: 'item-seta' }, '›') : null);
  }

  /** Menu de ações de uma recorrência sua. */
  async function acoes(r) {
    const sit = situacao(r);
    const opcoes = [
      sit !== 'encerrada' ? { valor: 'valor', rotulo: '💲 Alterar valor a partir de um mês' } : null,
      sit === 'ativa' ? { valor: 'pausar', rotulo: '⏸ Pausar (não gera lançamentos)' } : null,
      sit === 'pausada' ? { valor: 'retomar', rotulo: '▶️ Retomar' } : null,
      sit !== 'encerrada' ? { valor: 'encerrar', rotulo: '⏹ Encerrar (último mês)' } : null,
      { valor: 'excluir', rotulo: '🗑 Excluir cadastro' },
    ].filter(Boolean);
    const escolha = await formularioDialogo({
      titulo: r.descricao, texto: `${moeda(r.valor_centavos)} todo dia ${r.dia_do_mes}`, confirmar: 'Continuar',
      campos: [{ nome: 'acao', rotulo: 'O que deseja fazer?', tipo: 'select', opcoes }],
    });
    if (!escolha) return;

    try {
      if (escolha.acao === 'valor') await alterarValor(r);
      else if (escolha.acao === 'pausar') await db.atualizarRecorrencia(r.id, { ativa: false });
      else if (escolha.acao === 'retomar') await db.atualizarRecorrencia(r.id, { ativa: true });
      else if (escolha.acao === 'encerrar') await encerrar(r);
      else if (escolha.acao === 'excluir') {
        if (!await confirmar(`Excluir "${r.descricao}"? Os lançamentos já gerados continuam; só não serão criados novos.`, { sim: 'Excluir', perigoso: true })) return;
        await db.excluirRecorrencia(r.id);
      }
      log.info('recorrencias', `Ação "${escolha.acao}"`, { id: r.id });
      avisar('Pronto ✓', { tipo: 'ok' });
      await recarregar();
      gerarRecorrencias?.();
    } catch (e) {
      if (!e.cancelado) avisar(erroDe(e), { tipo: 'erro' });
    }
  }

  async function alterarValor(r) {
    const mesAtual = competenciaDe(hojeSP()).slice(0, 7);
    const resp = await formularioDialogo({
      titulo: 'Novo valor',
      texto: 'Os meses anteriores continuam com o valor antigo. Lançamentos já gerados a partir do mês escolhido são atualizados.',
      campos: [
        { nome: 'valor', rotulo: 'Novo valor (R$)', valor: valorParaCampo(r.valor_centavos), atributos: { inputmode: 'decimal' } },
        { nome: 'mes', rotulo: 'A partir de', tipo: 'month', valor: mesAtual },
      ],
      validar: (v) => (!(lerValorBR(v.valor) > 0) ? 'Valor inválido.' : !v.mes ? 'Escolha o mês.' : null),
    });
    if (!resp) throw Object.assign(new Error('Cancelado'), { cancelado: true });
    await db.alterarValorRecorrencia(r.id, `${resp.mes}-01`, lerValorBR(resp.valor));
  }

  async function encerrar(r) {
    const resp = await formularioDialogo({
      titulo: 'Encerrar recorrência', texto: 'Qual o ÚLTIMO mês em que ela deve gerar lançamento?',
      campos: [{ nome: 'mes', rotulo: 'Último mês', tipo: 'month', valor: competenciaDe(hojeSP()).slice(0, 7) }],
      validar: (v) => (!v.mes ? 'Escolha o mês.' : null),
    });
    if (!resp) throw Object.assign(new Error('Cancelado'), { cancelado: true });
    // Último dia do mês escolhido.
    const fim = new Date(Date.UTC(...resp.mes.split('-').map(Number), 0)).toISOString().slice(0, 10);
    await db.atualizarRecorrencia(r.id, { data_fim: fim });
  }

  // ---- Formulário de nova recorrência ---------------------------------------
  function desenharFormulario() {
    const f = { tipo: 'despesa', forma: 'pix', cartaoId: null };
    const descricao = h('input', { class: 'campo', placeholder: 'Descrição (ex.: Aluguel, Salário, Internet)', maxlength: '80' });
    const valor = h('input', { class: 'campo', placeholder: 'Valor mensal (R$)', inputmode: 'decimal' });
    const dia = h('input', { class: 'campo', type: 'number', min: '1', max: '31', placeholder: 'Dia do mês (1–31)', inputmode: 'numeric' });
    const inicio = h('input', { class: 'campo', type: 'month', value: competenciaDe(hojeSP()).slice(0, 7), 'aria-label': 'Começa em' });
    const categoria = h('select', { class: 'campo' });
    const areaPagamento = h('div');
    const mensagem = h('p', { class: 'mensagem-form', role: 'alert' });

    const desenharCategorias = () => trocar(categoria,
      h('option', { value: '' }, 'Categoria…'),
      categoriasOrdenadas(f.tipo).map((c) => h('option', { value: c.id }, `${c.icone} ${c.nome}`)));

    const desenharPagamento = () => {
      if (f.tipo === 'receita') { trocar(areaPagamento); return; }
      const cartoes = cartoesAtivos();
      trocar(areaPagamento,
        chips({ opcoes: FORMAS.map(([valor, rotulo]) => ({ valor, rotulo })), valor: f.forma, rotulo: 'Forma de pagamento',
          aoEscolher: (v) => { f.forma = v; desenharPagamento(); } }).elemento,
        f.forma === 'credito'
          ? (cartoes.length
            ? chips({ opcoes: cartoes.map((c) => ({ valor: c.id, rotulo: `${c.apelido} ••${c.ultimos4}` })), valor: (f.cartaoId ??= cartoes[0].id),
              rotulo: 'Cartão', aoEscolher: (v) => { f.cartaoId = v; } }).elemento
            : h('p', { class: 'alerta-inline' }, 'Cadastre um cartão primeiro (Mais → Cartões).'))
          : null);
    };

    const tipo = segmentado({
      rotulo: 'Tipo', valor: f.tipo,
      opcoes: [{ valor: 'despesa', rotulo: 'Gasto fixo' }, { valor: 'receita', rotulo: 'Ganho fixo' }],
      aoEscolher: (v) => { f.tipo = v; desenharCategorias(); desenharPagamento(); },
    });

    const botao = h('button', { type: 'submit', class: 'btn btn-primario' }, 'Salvar recorrência');
    trocar(formulario, h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        const centavos = lerValorBR(valor.value);
        const diaNum = Number(dia.value);
        const erros = [];
        if (!descricao.value.trim()) erros.push('Informe a descrição.');
        if (!(centavos > 0)) erros.push('Valor inválido.');
        if (!categoria.value) erros.push('Escolha a categoria.');
        if (!(diaNum >= 1 && diaNum <= 31)) erros.push('Dia do mês de 1 a 31.');
        if (!inicio.value) erros.push('Informe o mês de início.');
        if (f.tipo === 'despesa' && f.forma === 'credito' && !f.cartaoId) erros.push('Escolha o cartão.');
        if (erros.length) { mensagem.textContent = erros.join(' '); return; }

        botao.disabled = true;
        try {
          await db.criarRecorrencia({
            tipo: f.tipo,
            descricao: descricao.value.trim(),
            valor_centavos: centavos,
            categoria_id: categoria.value,
            forma_pagamento: f.tipo === 'despesa' ? f.forma : null,
            cartao_id: f.tipo === 'despesa' && f.forma === 'credito' ? f.cartaoId : null,
            dia_do_mes: diaNum,
            data_inicio: `${inicio.value}-01`,
          });
          log.info('recorrencias', 'Recorrência criada', { tipo: f.tipo, valor: centavos });
          avisar('Recorrência criada ✓', { tipo: 'ok' });
          e.target.reset();
          inicio.value = competenciaDe(hojeSP()).slice(0, 7);
          mensagem.textContent = '';
          await recarregar();
          gerarRecorrencias?.(); // cria já os lançamentos devidos
        } catch (erro) {
          mensagem.textContent = erroDe(erro);
        } finally {
          botao.disabled = false;
        }
      },
    },
    tipo.elemento, h('div', { style: { height: '8px' } }),
    descricao, valor, categoria, areaPagamento,
    h('div', { class: 'linha-2' }, dia, inicio),
    h('p', { class: 'dica' }, 'Se o início for um mês passado, o app cria os lançamentos desde lá (no máximo 24 meses para trás).'),
    botao, mensagem));
    desenharCategorias();
    desenharPagamento();
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    h('p', { class: 'dica' }, 'Cadastre uma vez o que se repete todo mês. O app lança sozinho a cada mês (ao abrir com internet). Toque numa recorrência sua para alterar.'),
    lista,
    h('h3', { class: 'rotulo' }, 'Nova recorrência'),
    formulario));
  desenhar();
  desenharFormulario();
}
