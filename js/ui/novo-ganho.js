/**
 * =============================================================================
 * js/ui/novo-ganho.js — Tela "Novo ganho" (RF-20 a RF-22)
 * -----------------------------------------------------------------------------
 * Registra os GANHOS DO MÊS: salário, pró-labore, aluguel, freelance,
 * reembolso… São esses valores que, confrontados com os gastos, formam a
 * conciliação do Dashboard e alimentam a Saúde Financeira.
 *
 *   * Ganho VARIÁVEL (freelance, reembolso): lance aqui quando acontecer.
 *   * Ganho FIXO mensal (salário): pode lançar aqui todo mês, ou cadastrar
 *     uma vez como recorrência (Fase 3) para entrar sozinho.
 *
 * Mesmo fluxo do gasto: salva no aparelho primeiro, confirma e envia.
 * =============================================================================
 */
import { h, trocar, avisar, vibrar } from './dom.js';
import { teclado, mostradorValor, gradeCategorias, segmentado } from './componentes.js';
import { moeda, hojeSP } from '../formato.js';
import { validarGanho } from '../validacao.js';
import { enfileirar, listarFila, registrarUsoCategoria, novoId } from '../offline.js';
import { sincronizar } from '../sync.js';
import { log } from '../log.js';
import { estado, categoriasOrdenadas, categoriaPorId } from '../estado.js';

/** Categorias que normalmente são ganhos fixos: já sugerem "Fixo". */
const SUGERE_FIXO = /sal[aá]rio|pr[oó]-?labore|aluguel/i;

export function montarNovoGanho(raiz) {
  const s = { centavos: 0, categoriaId: null, natureza: 'variavel', data: hojeSP(), descricao: '' };

  const mostrador = mostradorValor();
  mostrador.elemento.classList.add('ganho');
  const tec = teclado({ aoMudar: (c) => { s.centavos = c; mostrador.atualizar(c); } });

  const natureza = segmentado({
    rotulo: 'Natureza', valor: s.natureza,
    opcoes: [{ valor: 'variavel', rotulo: 'Variável' }, { valor: 'fixa', rotulo: 'Fixo' }],
    aoEscolher: (v) => { s.natureza = v; },
  });

  const grade = gradeCategorias({
    categorias: categoriasOrdenadas('receita'),
    selecionada: null,
    aoEscolher: (id) => {
      s.categoriaId = id;
      // Salário/pró-labore/aluguel: sugere "Fixo" (pode trocar).
      const nova = SUGERE_FIXO.test(categoriaPorId(id)?.nome ?? '') ? 'fixa' : 'variavel';
      s.natureza = nova;
      natureza.definir(nova);
    },
  });

  const campoData = h('input', {
    type: 'date', class: 'campo-data', value: s.data, 'aria-label': 'Data do recebimento',
    onchange: (e) => { s.data = e.target.value || hojeSP(); },
  });
  const campoDescricao = h('input', {
    type: 'text', class: 'campo', placeholder: 'Descrição (opcional) — ex.: salário setembro',
    maxlength: '120', enterkeyhint: 'done', oninput: (e) => { s.descricao = e.target.value; },
  });

  const botaoSalvar = h('button', { type: 'button', class: 'btn btn-ganho btn-salvar', onclick: salvar }, 'Salvar ganho');

  async function salvar() {
    const erros = validarGanho({ valorCentavos: s.centavos, categoriaId: s.categoriaId, data: s.data });
    if (erros.length) { vibrar(60); avisar(erros[0], { tipo: 'aviso' }); return; }

    botaoSalvar.disabled = true;
    const id = novoId();
    const dados = {
      id,
      household_id: estado.perfil.household_id,
      user_id: estado.perfil.id,
      data: s.data,
      valor_centavos: s.centavos,
      categoria_id: s.categoriaId,
      descricao: s.descricao.trim() || null,
      natureza: s.natureza,
      origem: 'manual',
    };

    try {
      await enfileirar({ tipo: 'receita', id, user_id: estado.perfil.id, dados });
    } catch (e) {
      log.erro('ganho', 'Falha ao guardar no aparelho', e);
      avisar('Não foi possível salvar neste aparelho. Tente de novo.', { tipo: 'erro' });
      botaoSalvar.disabled = false;
      return;
    }

    vibrar(15);
    log.info('ganho', 'Ganho salvo', { id, valor: s.centavos, natureza: s.natureza });
    const aviso = avisar(`Salvo ✓ ${moeda(s.centavos)} — enviando…`, { tipo: 'ok', duracao: 4000 });
    await registrarUsoCategoria(s.categoriaId);
    estado.usoCategorias[s.categoriaId] = (estado.usoCategorias[s.categoriaId] ?? 0) + 1;

    // Limpa para o próximo
    tec.definir(0);
    Object.assign(s, { categoriaId: null, natureza: 'variavel', data: hojeSP(), descricao: '' });
    campoDescricao.value = '';
    campoData.value = s.data;
    natureza.definir('variavel');
    grade.recarregar(categoriasOrdenadas('receita'));
    grade.selecionar(null);
    botaoSalvar.disabled = false;

    await sincronizar('salvar');
    const item = (await listarFila(estado.perfil.id)).find((i) => i.id === id);
    if (!item) aviso.atualizar('Salvo ✓ e sincronizado', 'ok');
    else if (item.estado === 'erro') aviso.atualizar(`Servidor recusou: ${item.ultimo_erro}`, 'erro');
    else aviso.atualizar('Salvo ✓ no aparelho — envia quando tiver sinal', 'ok');
  }

  trocar(raiz,
    h('section', { class: 'tela-lancamento' },
      h('div', { class: 'rolagem' },
        mostrador.elemento,
        h('h2', { class: 'rotulo' }, 'Tipo de ganho'),
        grade.elemento,
        h('div', { class: 'linha-detalhes' }, natureza.elemento, campoData),
        campoDescricao,
        h('p', { class: 'dica' }, '💡 Ganho fixo todo mês (salário)? Na Fase 3 você poderá cadastrá-lo uma vez como recorrência e ele entrará sozinho.'),
      ),
      h('div', { class: 'doca' }, tec.elemento, botaoSalvar),
    ));

  return () => tec.elemento.desligar();
}
