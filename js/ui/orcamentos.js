/**
 * =============================================================================
 * js/ui/orcamentos.js — Orçamento mensal por categoria (RF-55)
 * -----------------------------------------------------------------------------
 * Defina quanto pretendem gastar por mês em cada categoria:
 *   * da FAMÍLIA (soma dos dois) ou individual (só você / só a Camilla).
 * O Painel (Fase 4) compara orçamento × realizado, e a Saúde Financeira
 * (Fase 5) alerta em 80% (atenção) e 100% (crítico).
 * Orçamentos são da família: ambos podem alterar. Precisa de internet.
 * =============================================================================
 */
import { h, trocar, avisar, formularioDialogo } from './dom.js';
import { chips } from './componentes.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { moeda, lerValorBR, valorParaCampo } from '../formato.js';
import { estado, categoriasOrdenadas, membrosOrdenados } from '../estado.js';

let escopo = 'familia'; // 'familia' | id de um membro

export function montarOrcamentos(raiz, { navegar }) {
  let orcamentos = [];
  const lista = h('div', { class: 'lista' });
  const total = h('div', { class: 'totais' });
  const aviso = h('p', { class: 'dica' });

  const opcoes = [
    { valor: 'familia', rotulo: 'Família' },
    ...membrosOrdenados().map((m) => ({ valor: m.id, rotulo: m.id === estado.perfil.id ? 'Eu' : m.nome })),
  ];
  const seletor = chips({ opcoes, valor: escopo, rotulo: 'Orçamento de', rolavel: false, aoEscolher: (v) => { escopo = v; desenhar(); } });

  const userIdEscopo = () => (escopo === 'familia' ? null : escopo);

  async function carregar() {
    aviso.textContent = 'Carregando…';
    try {
      orcamentos = await db.listarOrcamentos();
      aviso.textContent = '';
    } catch (e) {
      aviso.textContent = e.tipo === 'rede' ? 'Sem internet — orçamentos precisam de conexão.' : e.message;
    }
    desenhar();
  }

  function desenhar() {
    const doEscopo = orcamentos.filter((o) => o.user_id === userIdEscopo());
    const soma = doEscopo.reduce((s, o) => s + o.valor_mensal_centavos, 0);
    trocar(total, h('span', {}, 'Total orçado por mês', h('strong', {}, moeda(soma))),
      h('span', {}, 'Categorias com orçamento', h('strong', {}, String(doEscopo.length))));

    trocar(lista, categoriasOrdenadas('despesa').sort((a, b) => a.ordem - b.ordem).map((c) => {
      const o = doEscopo.find((x) => x.categoria_id === c.id);
      return h('div', { class: 'item clicavel linha-orcamento', onclick: () => editar(c, o) },
        h('span', { class: 'item-icone', style: { '--cor-cat': c.cor } }, c.icone),
        h('div', { class: 'item-texto' }, h('strong', {}, c.nome), h('small', {}, o ? 'por mês' : 'sem orçamento')),
        h('span', { class: 'item-valor' }, o ? moeda(o.valor_mensal_centavos) : '—'),
        h('span', { class: 'item-seta' }, '›'));
    }));
  }

  async function editar(categoria, orcamento) {
    const quem = opcoes.find((o) => o.valor === escopo)?.rotulo;
    const v = await formularioDialogo({
      titulo: `${categoria.icone} ${categoria.nome}`,
      texto: `Orçamento mensal — ${quem}. Deixe vazio para remover.`,
      campos: [{ nome: 'valor', rotulo: 'Valor por mês (R$)', valor: orcamento ? valorParaCampo(orcamento.valor_mensal_centavos) : '', atributos: { inputmode: 'decimal', placeholder: 'ex.: 1.200,00' } }],
      validar: (x) => (x.valor.trim() && !(lerValorBR(x.valor) > 0) ? 'Valor inválido.' : null),
    });
    if (!v) return;
    try {
      if (!v.valor.trim()) {
        if (orcamento) await db.excluirOrcamento(orcamento.id);
      } else {
        await db.salvarOrcamento({ id: orcamento?.id, categoria_id: categoria.id, user_id: userIdEscopo(), valor_mensal_centavos: lerValorBR(v.valor) });
      }
      log.info('orcamentos', 'Orçamento salvo', { categoria: categoria.nome, escopo });
      avisar('Orçamento salvo ✓', { tipo: 'ok' });
      await carregar();
    } catch (e) {
      avisar(e.tipo === 'rede' ? 'Sem internet — tente de novo com conexão.' : e.message, { tipo: 'erro' });
    }
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    seletor.elemento, aviso, total, lista,
    h('p', { class: 'dica' }, 'Toque numa categoria para definir o valor. O Painel mostrará orçado × realizado na Fase 4, e os alertas de 80%/100% chegam na Fase 5.')));
  carregar();
}
