/**
 * =============================================================================
 * js/ui/painel.js — Dashboard (versão da Fase 2: bloco de conciliação)
 * -----------------------------------------------------------------------------
 * Filtros no topo: MÊS e VISÃO (Eu / cônjuge / Família) — decisão D-18.
 * Nesta fase mostra os números da conciliação vindos da view
 * vw_resumo_mensal: ganhos, gastos (pela competência das parcelas), saldo,
 * taxa de poupança e % de gastos fixos sobre a renda.
 * Fase 4: previsto × realizado, gráficos e mapa.
 * =============================================================================
 */
import { h, trocar } from './dom.js';
import * as db from '../db.js';
import { lerCache, gravarCache } from '../offline.js';
import { chips } from './componentes.js';
import { moeda, percentual, mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia } from '../formato.js';
import { estado } from '../estado.js';

export function montarPainel(raiz) {
  let competencia = competenciaDe(hojeSP());
  let visao = 'familia'; // 'familia' | id de um membro
  let linhas = [];

  const titulo = h('h2', { class: 'titulo-mes' });
  const areaCards = h('div', { class: 'cards' });
  const aviso = h('p', { class: 'dica' });

  const opcoesVisao = [
    { valor: estado.perfil.id, rotulo: 'Eu' },
    ...estado.membros.filter((m) => m.id !== estado.perfil.id).map((m) => ({ valor: m.id, rotulo: m.nome })),
    { valor: 'familia', rotulo: 'Família' },
  ];
  const seletorVisao = chips({
    opcoes: opcoesVisao, valor: visao, rotulo: 'Visão', rolavel: false,
    aoEscolher: (v) => { visao = v; desenhar(); },
  });

  const mudarMes = (n) => { competencia = somarMesesCompetencia(competencia, n); carregar(); };

  async function carregar() {
    titulo.textContent = mesExtenso(competencia);
    const chave = `resumo:${competencia}`;
    linhas = (await lerCache(chave)) ?? [];
    aviso.textContent = linhas.length ? 'Atualizando…' : 'Carregando…';
    desenhar();
    try {
      linhas = await db.resumoDoMes(competencia);
      await gravarCache(chave, linhas);
      aviso.textContent = '';
    } catch (e) {
      aviso.textContent = e.tipo === 'rede' ? 'Sem internet — mostrando a última cópia guardada.' : e.message;
    }
    desenhar();
  }

  function desenhar() {
    const linha = linhas.find((l) => (visao === 'familia' ? l.user_id === null : l.user_id === visao)) ?? {};
    const receitas = linha.receitas_centavos ?? 0;
    const despesas = linha.despesas_centavos ?? 0;
    const saldo = receitas - despesas;

    trocar(areaCards,
      card('Ganhos', moeda(receitas), 'positivo'),
      card('Gastos', moeda(despesas), 'negativo'),
      card('Saldo do mês', moeda(saldo), saldo >= 0 ? 'positivo' : 'negativo'),
      card('Taxa de poupança', percentual(linha.taxa_poupanca_pct), (linha.taxa_poupanca_pct ?? 0) >= 10 ? 'positivo' : 'atencao'),
      card('Gastos fixos', moeda(linha.despesas_fixas_centavos ?? 0), '', `${percentual(linha.fixos_sobre_renda_pct)} da renda`),
      card('Gastos variáveis', moeda(linha.despesas_variaveis_centavos ?? 0)),
      card('No cartão (faturas do mês)', moeda(linha.despesas_cartao_centavos ?? 0)),
    );
    if (receitas === 0 && linhas.length > 0 && !aviso.textContent) {
      aviso.textContent = '💡 Nenhum ganho registrado neste mês — lance os ganhos para a conciliação fazer sentido.';
    }
  }

  function card(rotulo, valor, classe = '', sub) {
    return h('div', { class: `card ${classe}` },
      h('span', { class: 'card-rotulo' }, rotulo),
      h('strong', { class: 'card-valor' }, valor),
      sub ? h('small', {}, sub) : null);
  }

  trocar(raiz, h('section', { class: 'tela' },
    h('div', { class: 'nav-mes' },
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      titulo,
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›')),
    seletorVisao.elemento,
    aviso,
    areaCards,
    h('p', { class: 'dica' }, 'Gastos contam pelo mês da fatura (competência). Gráficos, previsto × realizado e mapa chegam na Fase 4.')));

  carregar();
}
