/**
 * =============================================================================
 * js/ui/exportar.js — Mais → Exportar dados (RF-80, RF-81)
 * -----------------------------------------------------------------------------
 * Três exportações:
 *   1. JSON do mês para o CLAUDE (formato financas-familia/export@1) —
 *      a rotina mensal: gere no começo do mês seguinte e envie para a Skill
 *      "Consultor Financeiro Familiar". Sem e-mails, ids ou GPS.
 *   2. CSV do mês — abre no Excel / Google Planilhas.
 *   3. Backup completo (JSON com todas as tabelas) — guarde no seu PC/nuvem;
 *      o plano gratuito do Supabase não faz backup automático.
 *
 * No iPhone, compartilhar arquivo precisa de um toque direto do usuário:
 * por isso é em 2 passos — "Gerar" (busca os dados) e depois
 * "Compartilhar" / "Baixar" (instantâneo).
 * =============================================================================
 */
import { h, trocar, avisar } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { montarExport, montarCSV, nomeArquivo, FORMATO_BACKUP } from '../exportacao.js';
import { mesExtenso, hojeSP, competenciaDe, somarMesesCompetencia } from '../formato.js';
import { estado } from '../estado.js';

/** Mês sugerido: o anterior (a rotina é analisar o mês que acabou). */
let competencia = null;

export function montarExportar(raiz, { navegar }) {
  competencia ??= somarMesesCompetencia(competenciaDe(hojeSP()), -1);
  const titulo = h('h2', { class: 'titulo-mes' });
  const resultado = h('div');

  const mudarMes = (n) => { competencia = somarMesesCompetencia(competencia, n); titulo.textContent = mesExtenso(competencia); trocar(resultado); };

  /** Gera o arquivo e mostra os botões Compartilhar / Baixar. */
  async function gerar(tipo, botao) {
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Gerando…';
    try {
      const arquivo = await montarArquivo(tipo);
      log.info('exportar', `Arquivo gerado: ${arquivo.nome}`, { bytes: arquivo.conteudo.length });
      mostrarPronto(arquivo);
    } catch (e) {
      log.erro('exportar', 'Falha ao exportar', e);
      avisar(e.tipo === 'rede' ? 'Sem internet — a exportação busca os dados no servidor.' : e.message, { tipo: 'erro' });
    } finally {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }

  async function montarArquivo(tipo) {
    if (tipo === 'backup') {
      const tabelas = await db.backupCompleto();
      return {
        nome: `financas-backup-${hojeSP()}.json`, tipoMime: 'application/json',
        conteudo: JSON.stringify({ formato: FORMATO_BACKUP, gerado_em: new Date().toISOString(), tabelas }, null, 2),
        descricao: `Backup completo (${Object.values(tabelas).reduce((s, t) => s + t.length, 0)} registros)`,
      };
    }
    const dados = await db.dadosExportacao(competencia, {
      inicio6: somarMesesCompetencia(competencia, -5),
      fim12: somarMesesCompetencia(competencia, 12),
      proxima: somarMesesCompetencia(competencia, 1),
    });
    const comum = { membros: estado.membros, categorias: estado.categorias, cartoes: estado.cartoes };
    if (tipo === 'csv') {
      return {
        nome: nomeArquivo(competencia, 'csv'), tipoMime: 'text/csv',
        conteudo: montarCSV({ ...comum, despesas: dados.despesas, receitas: dados.receitas }),
        descricao: `${dados.despesas.length + dados.receitas.length} lançamento(s) de ${mesExtenso(competencia)}`,
      };
    }
    const exp = montarExport({ ...comum, competencia, familia: dados.familia, recorrencias: estado.recorrencias, dados });
    return {
      nome: nomeArquivo(competencia, 'json'), tipoMime: 'application/json',
      conteudo: JSON.stringify(exp, null, 2),
      descricao: `Resumo de ${mesExtenso(competencia)} para o Claude`,
    };
  }

  function mostrarPronto(arq) {
    const arquivo = new File([arq.conteudo], arq.nome, { type: arq.tipoMime });
    const podeCompartilhar = Boolean(navigator.canShare?.({ files: [arquivo] }));
    trocar(resultado, h('div', { class: 'secao pronto' },
      h('strong', {}, `✅ ${arq.nome}`),
      h('p', { class: 'secao-sub' }, arq.descricao),
      h('div', { class: 'botoes' },
        podeCompartilhar ? h('button', {
          type: 'button', class: 'btn btn-primario',
          onclick: () => navigator.share({ files: [arquivo], title: arq.nome }).catch((e) => {
            if (e.name !== 'AbortError') avisar('Não foi possível compartilhar; use "Baixar".', { tipo: 'aviso' });
          }),
        }, '📤 Compartilhar') : null,
        h('button', { type: 'button', class: `btn ${podeCompartilhar ? 'btn-secundario' : 'btn-primario'}`, onclick: () => baixar(arquivo) }, '⬇️ Baixar'))));
  }

  function baixar(arquivo) {
    const a = h('a', { href: URL.createObjectURL(arquivo), download: arquivo.name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  const botao = (texto, tipo, classe = 'btn-secundario') => {
    const b = h('button', { type: 'button', class: `btn ${classe} btn-largo`, onclick: () => gerar(tipo, b) }, texto);
    return b;
  };

  titulo.textContent = mesExtenso(competencia);
  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    h('div', { class: 'nav-mes' },
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }, '‹'),
      titulo,
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }, '›')),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '✨ Análise do mês com o Claude'),
      h('ol', { class: 'passos' },
        h('li', {}, 'Gere o JSON do mês abaixo e toque em Compartilhar (ou Baixar).'),
        h('li', {}, 'No Claude, anexe o arquivo e peça: "Analise com o Consultor Financeiro Familiar".'),
        h('li', {}, 'Copie o bloco de tarefas da resposta e cole em Saúde → Importar tarefas do Claude.')),
      botao('Gerar JSON do mês (para o Claude)', 'json', 'btn-primario')),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '📊 Planilha do mês'),
      h('p', { class: 'secao-sub' }, 'Lançamentos do mês em CSV — abre no Excel ou Google Planilhas.'),
      botao('Gerar CSV do mês', 'csv')),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '💾 Backup completo'),
      h('p', { class: 'secao-sub' }, 'Todos os dados da família em um arquivo. O plano gratuito do Supabase não faz backup automático: guarde um por mês no PC ou na nuvem.'),
      botao('Gerar backup completo', 'backup')),

    resultado,
    h('p', { class: 'dica' }, 'O JSON para o Claude não leva e-mails, identificadores internos nem coordenadas de GPS.')));
}
