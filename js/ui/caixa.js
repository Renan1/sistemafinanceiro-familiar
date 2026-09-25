/**
 * =============================================================================
 * js/ui/caixa.js — Caixa de entrada da Carteira do iPhone (v1.2 — RF-16)
 * -----------------------------------------------------------------------------
 * Lista as compras que o Atalho do iPhone mandou e ainda não viraram gasto
 * (só as da própria pessoa). Para cada uma:
 *   * "Lançar"   → abre a tela de gasto já preenchida (js/ui/novo-gasto.js);
 *   * "Descartar" → a compra sai da caixa sem virar gasto.
 * Compras já lançadas neste aparelho, mas ainda não enviadas (sem sinal),
 * aparecem como "⏳ lançada, aguardando envio".
 *
 * Precisa de internet para listar (os itens chegam pelo servidor).
 * Configurar o atalho: Mais → Atalho do iPhone (js/ui/atalho.js).
 * =============================================================================
 */
import { h, trocar, avisar, confirmar } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { listarFila } from '../offline.js';
import { moeda, dataHoraBR } from '../formato.js';
import { estado, guardarItemDaCaixa } from '../estado.js';

export function montarCaixa(raiz, { navegar }) {
  const lista = h('div', { class: 'lista' });
  const situacao = h('p', { class: 'dica' }, 'Carregando…');

  async function carregar() {
    if (!navigator.onLine) {
      situacao.textContent = 'Sem internet: a caixa de entrada aparece quando houver sinal.';
      trocar(lista);
      return;
    }
    try {
      const [itens, fila] = await Promise.all([db.listarCaixaPendente(estado.perfil.id), listarFila(estado.perfil.id)]);
      const naFila = new Set(fila.map((i) => i.caixaId).filter(Boolean));
      desenhar(itens, naFila);
    } catch (e) {
      log.aviso('caixa', 'Não foi possível carregar a caixa de entrada', e);
      situacao.textContent = `Não foi possível carregar: ${e.message}`;
    }
  }

  function desenhar(itens, naFila) {
    const pendentes = itens.filter((i) => !naFila.has(i.id));
    situacao.textContent = pendentes.length
      ? `${pendentes.length} compra(s) para lançar. Toque em "Lançar", confira a categoria e salve.`
      : 'Nada para lançar ✓';
    trocar(lista, itens.map((i) => {
      const aguardando = naFila.has(i.id);
      return h('div', { class: `item item-caixa${aguardando ? ' pendente' : ''}` },
        h('div', { class: 'item-texto' },
          h('strong', {}, i.estabelecimento ?? 'Compra sem nome'),
          h('small', {}, [dataHoraBR(i.recebido_em), i.cartao_nome, aguardando ? '⏳ lançada, aguardando envio' : null].filter(Boolean).join(' · '))),
        h('strong', { class: 'item-valor' }, moeda(i.valor_centavos)),
        aguardando ? null : h('div', { class: 'item-acoes' },
          h('button', { type: 'button', class: 'btn btn-primario btn-pequeno', onclick: () => lancar(i) }, 'Lançar'),
          h('button', { type: 'button', class: 'link perigo', onclick: () => descartar(i) }, 'Descartar')));
    }));
  }

  function lancar(item) {
    guardarItemDaCaixa(item);
    navegar('#/gasto');
  }

  async function descartar(item) {
    if (!(await confirmar(`Descartar ${moeda(item.valor_centavos)}${item.estabelecimento ? ` em ${item.estabelecimento}` : ''}? Ela não vira gasto.`,
      { sim: 'Descartar', perigoso: true }))) return;
    try {
      await db.marcarCaixa(item.id, 'descartado');
      log.info('caixa', 'Compra da Carteira descartada', { id: item.id });
      avisar('Compra descartada', { tipo: 'ok' });
      carregar();
    } catch (e) {
      avisar(e.message, { tipo: 'erro' });
    }
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('div', { class: 'cabecalho-edicao' },
      h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/gasto') }, '‹ Novo gasto'),
      h('button', { type: 'button', class: 'link', onclick: carregar }, '⟳ Atualizar')),
    h('p', { class: 'secao-sub' }, 'Compras pagas com a Carteira do iPhone (aproximação), enviadas pelo Atalho.'),
    situacao,
    lista,
    h('p', { class: 'dica' }, 'Ainda não configurou? ',
      h('button', { type: 'button', class: 'link', onclick: () => navegar('#/mais/atalho') }, 'Mais → Atalho do iPhone'))));
  carregar();
}
