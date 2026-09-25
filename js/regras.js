/**
 * =============================================================================
 * js/regras.js — Motor de regras da Saúde Financeira (RF-70, RF-71)
 * -----------------------------------------------------------------------------
 * Olha os números do mês e gera:
 *   * ALERTAS (insights): o que chama atenção, com severidade
 *     'info' | 'atencao' | 'critico';
 *   * TAREFAS: ações concretas para melhorar — só uma tarefa aberta por regra
 *     (o banco também impede duplicar: índice uq_tarefas_regra_aberta).
 *
 * TODOS OS LIMITES FICAM EM `LIMITES` (logo abaixo) — é aqui que se ajusta
 * "30% acima da média", "80% do orçamento", etc. Mudou? Rode `npm test`.
 *
 * Cada regra é uma função pura: recebe o CONTEXTO do mês (já filtrado pela
 * visão: família ou uma pessoa) e devolve null (nada a dizer) ou um alerta.
 * Testado em tests/js/regras.test.js.
 * =============================================================================
 */
import { somarMesesCompetencia, competenciaDe, moeda, percentual, mesAbrev } from './formato.js';
import { recorrenciaVigente } from './dashboard.js';

// =============================================================================
// CONFIGURAÇÃO — ajuste aqui
// =============================================================================
export const LIMITES = {
  /** Orçamento: atenção a partir de 80%, crítico a partir de 100%. */
  orcamentoAtencao: 0.8,
  orcamentoCritico: 1.0,
  /** Categoria acima da média dos meses anteriores. */
  acimaDaMediaPct: 0.3,          // 30% acima…
  acimaDaMediaMeses: 3,          // …da média dos últimos 3 meses
  acimaDaMediaMinimo: 10000,     // só categorias com média ≥ R$ 100 (evita ruído)
  /** Parcelas futuras (média dos próximos meses) sobre a renda média mensal. */
  parcelasFuturasPct: 0.3,
  parcelasFuturasMeses: 3,       // olha os próximos 3 meses
  rendaMediaMeses: 3,            // renda média dos últimos 3 meses
  /** Gastos fixos sobre a renda do mês. */
  fixosPct: 0.5,
  /** Taxa de poupança mínima saudável. */
  poupancaMinimaPct: 10,
  /** Muitas compras pequenas numa categoria de "pequenos gastos". */
  comprasPequenasQtd: 15,        // mais de 15 lançamentos…
  comprasPequenasValor: 3000,    // …abaixo de R$ 30…
  comprasPequenasCategoria: /restaurante|delivery|lanche|padaria|caf[eé]/i, // …nessas categorias
  /** Assinaturas: revisão a cada 3 meses (jan, abr, jul, out). */
  assinaturasCategoria: /assinatura|streaming/i,
  assinaturasMeses: [1, 4, 7, 10],
  /** "Mês sem ganho" só depois deste dia do mês (antes disso é cedo). */
  semReceitaAposDia: 10,
};

/** Ordem de gravidade para ordenar alertas na tela. */
export const PESO_SEVERIDADE = { critico: 3, atencao: 2, info: 1 };

// =============================================================================
// CONTEXTO: prepara os números que as regras usam
// =============================================================================

/**
 * @param {object} p
 * @param {string} p.competencia        mês avaliado 'AAAA-MM-01'
 * @param {string} p.hoje               'AAAA-MM-DD' (São Paulo)
 * @param {string} p.visao              'familia' | user_id
 * @param {Array}  p.resumo             vw_resumo_mensal (meses anteriores + atual)
 * @param {Array}  p.parcelas           vw_parcelas_detalhe (meses anteriores até futuros)
 * @param {Array}  p.orcamentos
 * @param {Array}  p.recorrencias
 * @param {Array}  p.categorias
 */
export function montarContexto({ competencia, hoje, visao, resumo, parcelas, orcamentos, recorrencias, categorias }) {
  const naVisao = (l) => visao === 'familia' || l.user_id === visao;
  const alvo = visao === 'familia' ? null : visao;
  const linhaDo = (c) => resumo.find((r) => r.competencia === c && (r.user_id ?? null) === alvo);
  const mes = linhaDo(competencia) ?? {};
  const minhas = parcelas.filter(naVisao);

  // Gasto por categoria num mês.
  const porCategoria = (c) => {
    const m = new Map();
    for (const p of minhas) if (p.competencia === c) m.set(p.categoria_id, (m.get(p.categoria_id) ?? 0) + p.valor_centavos);
    return m;
  };

  const mesesAnteriores = (n) => Array.from({ length: n }, (_, i) => somarMesesCompetencia(competencia, -(i + 1)));

  // Renda média: meses anteriores + atual que tenham ganho registrado.
  const rendas = [competencia, ...mesesAnteriores(LIMITES.rendaMediaMeses - 1)]
    .map((c) => linhaDo(c)?.receitas_centavos ?? 0).filter((v) => v > 0);

  return {
    competencia,
    hoje,
    visao,
    receitas: mes.receitas_centavos ?? 0,
    despesas: mes.despesas_centavos ?? 0,
    fixas: mes.despesas_fixas_centavos ?? 0,
    taxaPoupanca: mes.taxa_poupanca_pct ?? null,
    rendaMedia: rendas.length ? rendas.reduce((s, v) => s + v, 0) / rendas.length : 0,
    gastoCategoria: porCategoria(competencia),
    gastoCategoriaAnteriores: mesesAnteriores(LIMITES.acimaDaMediaMeses).map(porCategoria),
    parcelasFuturas: Array.from({ length: LIMITES.parcelasFuturasMeses }, (_, i) => {
      const c = somarMesesCompetencia(competencia, i + 1);
      return minhas.filter((p) => p.competencia === c && p.forma_pagamento === 'credito').reduce((s, p) => s + p.valor_centavos, 0);
    }),
    // Compras (não parcelas) do mês: total === 1 garante uma linha por compra.
    comprasDoMes: minhas.filter((p) => p.competencia === competencia && p.total === 1),
    orcamentos: orcamentos.filter((o) => (o.user_id ?? null) === alvo),
    recorrencias: recorrencias.filter(naVisao).filter((r) => recorrenciaVigente(r, competencia)),
    categoria: (id) => categorias.find((c) => c.id === id),
  };
}

// =============================================================================
// AS REGRAS
// =============================================================================
// Cada regra: { codigo, avaliar(ctx) → null | { severidade, mensagem, dados, tarefa? } }
// tarefa: { titulo, descricao, prioridade (1 alta · 2 média · 3 baixa) }

export const REGRAS = [
  {
    codigo: 'DESPESA_MAIOR_RECEITA',
    avaliar(ctx) {
      if (ctx.receitas <= 0 || ctx.despesas <= ctx.receitas) return null;
      const falta = ctx.despesas - ctx.receitas;
      return {
        severidade: 'critico',
        mensagem: `Os gastos (${moeda(ctx.despesas)}) passaram os ganhos (${moeda(ctx.receitas)}) em ${moeda(falta)}.`,
        dados: { receitas: ctx.receitas, despesas: ctx.despesas, diferenca: falta },
        tarefa: {
          titulo: 'Fechar o mês no azul',
          descricao: `Faltam ${moeda(falta)} para empatar. Revise os maiores gastos variáveis do mês e segure novas compras parceladas.`,
          prioridade: 1,
        },
      };
    },
  },

  {
    codigo: 'ORCAMENTO_CATEGORIA',
    avaliar(ctx) {
      const itens = ctx.orcamentos.map((o) => {
        const gasto = ctx.gastoCategoria.get(o.categoria_id) ?? 0;
        return { categoria_id: o.categoria_id, nome: ctx.categoria(o.categoria_id)?.nome ?? '—', gasto, orcado: o.valor_mensal_centavos, fracao: gasto / o.valor_mensal_centavos };
      }).filter((i) => i.fracao >= LIMITES.orcamentoAtencao).sort((a, b) => b.fracao - a.fracao);
      if (itens.length === 0) return null;
      const estourados = itens.filter((i) => i.fracao >= LIMITES.orcamentoCritico);
      const lista = itens.map((i) => `${i.nome} ${Math.round(i.fracao * 100)}%`).join(', ');
      return {
        severidade: estourados.length ? 'critico' : 'atencao',
        mensagem: estourados.length
          ? `Orçamento estourado: ${lista}.`
          : `Orçamento chegando ao limite: ${lista}.`,
        dados: { categorias: itens.map(({ categoria_id, nome, gasto, orcado }) => ({ categoria_id, nome, gasto, orcado })) },
        tarefa: estourados.length ? {
          titulo: `Segurar gastos em ${estourados.map((i) => i.nome).join(', ')}`,
          descricao: 'O orçamento do mês já foi ultrapassado. Evite novos gastos nessas categorias até o mês virar ou reveja se o orçamento está realista.',
          prioridade: 1,
        } : undefined,
      };
    },
  },

  {
    codigo: 'CATEGORIA_ACIMA_MEDIA',
    avaliar(ctx) {
      const n = ctx.gastoCategoriaAnteriores.length;
      const itens = [];
      for (const [categoriaId, gasto] of ctx.gastoCategoria) {
        const media = ctx.gastoCategoriaAnteriores.reduce((s, m) => s + (m.get(categoriaId) ?? 0), 0) / n;
        if (media >= LIMITES.acimaDaMediaMinimo && gasto > media * (1 + LIMITES.acimaDaMediaPct)) {
          itens.push({ categoria_id: categoriaId, nome: ctx.categoria(categoriaId)?.nome ?? '—', gasto, media: Math.round(media), aumento: gasto / media - 1 });
        }
      }
      if (itens.length === 0) return null;
      itens.sort((a, b) => b.aumento - a.aumento);
      return {
        severidade: 'atencao',
        mensagem: `Acima da média dos últimos ${n} meses: ${itens.map((i) => `${i.nome} +${Math.round(i.aumento * 100)}%`).join(', ')}.`,
        dados: { categorias: itens },
        tarefa: {
          titulo: `Entender o aumento em ${itens[0].nome}`,
          descricao: `${itens[0].nome}: ${moeda(itens[0].gasto)} neste mês contra média de ${moeda(itens[0].media)}. Foi pontual ou virou hábito?`,
          prioridade: 2,
        },
      };
    },
  },

  {
    codigo: 'PARCELAS_FUTURAS_ALTAS',
    avaliar(ctx) {
      if (ctx.rendaMedia <= 0) return null;
      const media = ctx.parcelasFuturas.reduce((s, v) => s + v, 0) / ctx.parcelasFuturas.length;
      const fracao = media / ctx.rendaMedia;
      if (fracao <= LIMITES.parcelasFuturasPct) return null;
      return {
        severidade: 'atencao',
        mensagem: `Parcelas já comprometem ${percentual(fracao * 100)} da renda média nos próximos ${ctx.parcelasFuturas.length} meses (${moeda(Math.round(media))}/mês).`,
        dados: { mediaParcelas: Math.round(media), rendaMedia: Math.round(ctx.rendaMedia), meses: ctx.parcelasFuturas },
        tarefa: {
          titulo: 'Pausar novas compras parceladas',
          descricao: `As parcelas dos próximos meses já levam ${percentual(fracao * 100)} da renda. Evite parcelar até esse número cair abaixo de ${Math.round(LIMITES.parcelasFuturasPct * 100)}%.`,
          prioridade: 1,
        },
      };
    },
  },

  {
    codigo: 'FIXOS_ACIMA_LIMITE',
    avaliar(ctx) {
      if (ctx.receitas <= 0 || ctx.fixas / ctx.receitas <= LIMITES.fixosPct) return null;
      const fracao = ctx.fixas / ctx.receitas;
      return {
        severidade: 'atencao',
        mensagem: `Gastos fixos são ${percentual(fracao * 100)} da renda do mês (limite saudável: ${Math.round(LIMITES.fixosPct * 100)}%).`,
        dados: { fixas: ctx.fixas, receitas: ctx.receitas },
        tarefa: {
          titulo: 'Revisar contas fixas',
          descricao: 'Liste as recorrências (Mais → Recorrências) e veja o que dá para renegociar, trocar de plano ou cancelar: internet, celular, seguros, assinaturas.',
          prioridade: 2,
        },
      };
    },
  },

  {
    codigo: 'POUPANCA_BAIXA',
    avaliar(ctx) {
      if (ctx.receitas <= 0 || ctx.taxaPoupanca == null || ctx.taxaPoupanca >= LIMITES.poupancaMinimaPct) return null;
      return {
        severidade: ctx.taxaPoupanca < 0 ? 'critico' : 'atencao',
        mensagem: `Taxa de poupança em ${percentual(ctx.taxaPoupanca)} (meta: pelo menos ${LIMITES.poupancaMinimaPct}%).`,
        dados: { taxaPoupanca: ctx.taxaPoupanca },
        tarefa: {
          titulo: `Separar ${LIMITES.poupancaMinimaPct}% da renda assim que ela entrar`,
          descricao: 'Pague-se primeiro: no dia do salário, transfira a meta de poupança para outra conta antes de gastar.',
          prioridade: 2,
        },
      };
    },
  },

  {
    codigo: 'MUITAS_COMPRAS_PEQUENAS',
    avaliar(ctx) {
      const pequenas = ctx.comprasDoMes.filter((p) =>
        p.valor_centavos < LIMITES.comprasPequenasValor
        && LIMITES.comprasPequenasCategoria.test(ctx.categoria(p.categoria_id)?.nome ?? p.categoria_nome ?? ''));
      if (pequenas.length <= LIMITES.comprasPequenasQtd) return null;
      const total = pequenas.reduce((s, p) => s + p.valor_centavos, 0);
      return {
        severidade: 'info',
        mensagem: `${pequenas.length} compras pequenas (< ${moeda(LIMITES.comprasPequenasValor)}) em lanches/delivery somaram ${moeda(total)} no mês.`,
        dados: { quantidade: pequenas.length, total },
        tarefa: {
          titulo: 'Combinar um limite semanal para lanches e delivery',
          descricao: `Foram ${pequenas.length} compras pequenas (${moeda(total)}). Um valor semanal combinado ajuda a perceber o total.`,
          prioridade: 3,
        },
      };
    },
  },

  {
    codigo: 'REVISAR_ASSINATURAS',
    avaliar(ctx) {
      const mes = Number(ctx.competencia.slice(5, 7));
      if (!LIMITES.assinaturasMeses.includes(mes)) return null;
      const assinaturas = ctx.recorrencias.filter((r) => r.tipo === 'despesa'
        && LIMITES.assinaturasCategoria.test(ctx.categoria(r.categoria_id)?.nome ?? ''));
      if (assinaturas.length === 0) return null;
      const total = assinaturas.reduce((s, r) => s + r.valor_centavos, 0);
      return {
        severidade: 'info',
        mensagem: `Revisão trimestral: ${assinaturas.length} assinatura(s) somando ${moeda(total)}/mês — ${assinaturas.map((r) => r.descricao).join(', ')}.`,
        dados: { assinaturas: assinaturas.map((r) => ({ descricao: r.descricao, valor: r.valor_centavos })), total },
        tarefa: {
          titulo: `Revisar assinaturas (${mesAbrev(ctx.competencia)})`,
          descricao: `Vocês ainda usam todas? ${assinaturas.map((r) => `${r.descricao} (${moeda(r.valor_centavos)})`).join('; ')}.`,
          prioridade: 3,
        },
      };
    },
  },

  {
    codigo: 'SEM_RECEITA',
    avaliar(ctx) {
      if (ctx.receitas > 0) return null;
      const mesAtual = competenciaDe(ctx.hoje) === ctx.competencia;
      if (mesAtual && Number(ctx.hoje.slice(8, 10)) < LIMITES.semReceitaAposDia) return null;
      if (ctx.competencia > competenciaDe(ctx.hoje)) return null; // mês futuro
      return {
        severidade: 'atencao',
        mensagem: 'Nenhum ganho registrado neste mês — sem ele, saldo e poupança não fazem sentido.',
        dados: {},
        tarefa: {
          titulo: 'Registrar os ganhos do mês',
          descricao: 'Lance salário/pró-labore em Novo ganho, ou cadastre como recorrência (Mais → Recorrências) para entrar sozinho.',
          prioridade: 1,
        },
      };
    },
  },
];

// =============================================================================
// Execução
// =============================================================================

/**
 * Avalia todas as regras para uma visão.
 * @returns {Array<{regra_codigo, severidade, mensagem, dados, tarefa?}>}
 *          ordenado do mais grave para o menos grave
 */
export function avaliar(contexto) {
  const resultado = [];
  for (const regra of REGRAS) {
    const r = regra.avaliar(contexto);
    if (r) resultado.push({ regra_codigo: regra.codigo, ...r });
  }
  return resultado.sort((a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade]);
}

/**
 * Das tarefas sugeridas, as que ainda não existem abertas (mesma regra).
 * Tarefas de regra são sempre da FAMÍLIA (user_id nulo), para não duplicar
 * uma por pessoa.
 */
export function tarefasNovas(alertas, tarefasAbertas) {
  const jaAbertas = new Set(tarefasAbertas.filter((t) => t.status === 'aberta' && t.regra_codigo).map((t) => t.regra_codigo));
  return alertas.filter((a) => a.tarefa && !jaAbertas.has(a.regra_codigo)).map((a) => ({
    titulo: a.tarefa.titulo,
    descricao: a.tarefa.descricao,
    prioridade: a.tarefa.prioridade,
    origem: 'regra',
    regra_codigo: a.regra_codigo,
    user_id: null,
  }));
}
