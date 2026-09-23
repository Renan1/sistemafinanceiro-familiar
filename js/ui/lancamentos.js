/**
 * =============================================================================
 * js/ui/lancamentos.js — Lista de lançamentos do mês (versão da Fase 2)
 * -----------------------------------------------------------------------------
 * Nesta fase: mostra os PENDENTES deste aparelho (ainda não enviados) e os
 * lançamentos do mês já gravados no Supabase — suficiente para conferir que
 * o gasto registrado chegou.
 * Fase 3: filtros (pessoa, categoria, forma, fixo/variável), busca, editar
 * e excluir os próprios lançamentos.
 * =============================================================================
 */
import { h, trocar, avisar, confirmar } from './dom.js';
import * as db from '../db.js';
import { listarFila, removerDaFila, ouvirFila, gravarCache, lerCache } from '../offline.js';
import { tentarDeNovo } from '../sync.js';
import { moeda, dataBR, mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia } from '../formato.js';
import { estado, categoriaPorId, nomeMembro, cartaoPorId } from '../estado.js';

const ROTULO_FORMA = { pix: 'PIX', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', boleto: 'Boleto', outro: 'Outro' };

export function montarLancamentos(raiz) {
  let competencia = competenciaDe(hojeSP());
  const titulo = h('h2', { class: 'titulo-mes' });
  const areaPendentes = h('div');
  const areaLista = h('div', { class: 'lista' });

  const navMes = h('div', { class: 'nav-mes' },
    h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
    titulo,
    h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›'));

  function mudarMes(n) {
    competencia = somarMesesCompetencia(competencia, n);
    carregar();
  }

  async function desenharPendentes() {
    const fila = await listarFila(estado.perfil?.id);
    if (fila.length === 0) { trocar(areaPendentes); return; }
    trocar(areaPendentes,
      h('h3', { class: 'rotulo' }, `Neste aparelho, aguardando envio (${fila.length})`),
      h('div', { class: 'lista' }, fila.map((item) => linhaPendente(item))));
  }

  function linhaPendente(item) {
    const d = item.dados;
    const valor = item.tipo === 'despesa' ? d.valor_total_centavos : d.valor_centavos;
    const cat = categoriaPorId(d.categoria_id);
    return h('div', { class: `item pendente${item.estado === 'erro' ? ' com-erro' : ''}` },
      h('span', { class: 'item-icone' }, item.estado === 'erro' ? '⚠️' : '⏳'),
      h('div', { class: 'item-texto' },
        h('strong', {}, d.descricao || cat?.nome || '—'),
        h('small', {}, `${dataBR(d.data_compra ?? d.data)} · ${item.estado === 'erro' ? `Recusado: ${item.ultimo_erro}` : 'aguardando sinal'}`),
        item.estado === 'erro' ? h('div', { class: 'item-acoes' },
          h('button', { type: 'button', class: 'link', onclick: () => tentarDeNovo(item.chave) }, 'Tentar de novo'),
          h('button', {
            type: 'button', class: 'link perigo',
            onclick: async () => {
              if (await confirmar('Descartar este lançamento? Ele não foi enviado e será apagado deste aparelho.', { sim: 'Descartar', perigoso: true })) {
                await removerDaFila(item.chave);
              }
            },
          }, 'Descartar')) : null),
      h('span', { class: `item-valor ${item.tipo === 'receita' ? 'positivo' : ''}` },
        `${item.tipo === 'receita' ? '+' : '−'} ${moeda(valor)}`));
  }

  async function carregar() {
    titulo.textContent = mesExtenso(competencia);
    const chaveCache = `lancamentos:${competencia}`;
    const guardado = await lerCache(chaveCache);
    if (guardado) desenharLista(guardado, true);
    else trocar(areaLista, h('p', { class: 'vazio' }, 'Carregando…'));

    try {
      const dados = await db.listarLancamentosDoMes(competencia, somarMesesCompetencia(competencia, 1));
      await gravarCache(chaveCache, dados);
      desenharLista(dados, false);
    } catch (e) {
      if (!guardado) trocar(areaLista, h('p', { class: 'vazio' }, e.tipo === 'rede' ? 'Sem internet — conecte-se para ver os lançamentos deste mês.' : e.message));
      else if (e.tipo !== 'rede') avisar(e.message, { tipo: 'erro' });
    }
  }

  function desenharLista({ despesas, receitas }, doCache) {
    const itens = [
      ...receitas.map((r) => ({ tipo: 'receita', data: r.data, valor: r.valor_centavos, ...r })),
      ...despesas.map((d) => ({ tipo: 'despesa', data: d.data_compra, valor: d.valor_total_centavos, ...d })),
    ].sort((a, b) => b.data.localeCompare(a.data));

    if (itens.length === 0) {
      trocar(areaLista, h('p', { class: 'vazio' }, 'Nenhum lançamento neste mês.'));
      return;
    }
    trocar(areaLista,
      doCache ? h('p', { class: 'dica' }, 'Mostrando a última cópia guardada no aparelho.') : null,
      itens.map((i) => {
        const cat = categoriaPorId(i.categoria_id);
        const detalhes = [dataBR(i.data), nomeMembro(i.user_id)];
        if (i.tipo === 'despesa') {
          detalhes.push(ROTULO_FORMA[i.forma_pagamento] ?? i.forma_pagamento);
          if (i.forma_pagamento === 'credito') {
            const cartao = cartaoPorId(i.cartao_id);
            if (cartao) detalhes.push(cartao.apelido);
            if (i.qtd_parcelas > 1) detalhes.push(`${i.qtd_parcelas}x`);
          }
          if (i.latitude != null) detalhes.push('📍');
        }
        if (i.natureza === 'fixa') detalhes.push('fixo');
        return h('div', { class: 'item' },
          h('span', { class: 'item-icone', style: { '--cor-cat': cat?.cor ?? '#8E8E93' } }, cat?.icone ?? '•'),
          h('div', { class: 'item-texto' },
            h('strong', {}, i.descricao || cat?.nome || '—'),
            h('small', {}, detalhes.join(' · '))),
          h('span', { class: `item-valor ${i.tipo === 'receita' ? 'positivo' : ''}` },
            `${i.tipo === 'receita' ? '+' : '−'} ${moeda(i.valor)}`));
      }));
  }

  trocar(raiz, h('section', { class: 'tela' },
    navMes,
    areaPendentes,
    areaLista,
    h('p', { class: 'dica' }, 'Filtros, busca, editar e excluir chegam na Fase 3.')));

  desenharPendentes();
  carregar();
  const desligar = ouvirFila(() => { desenharPendentes(); carregar(); });
  return desligar;
}
