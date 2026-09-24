/**
 * =============================================================================
 * js/ui/novo-gasto.js — Tela "Novo gasto" (tela inicial do app — RF-10 a RF-14)
 * -----------------------------------------------------------------------------
 * Meta: registrar um gasto em MENOS DE 10 SEGUNDOS, no ato da compra:
 *   1. digita o valor no teclado grande (em centavos, estilo app de banco);
 *   2. toca a forma de pagamento (lembra a última usada);
 *   3. toca a categoria (as mais usadas aparecem primeiro);
 *   4. Salvar.
 * Data (hoje), Fixo/Variável, descrição e nome do local são opcionais.
 *
 * Ao abrir, já começa a buscar a localização (js/geo.js) — sem travar nada.
 * Ao salvar, o gasto vai PRIMEIRO para o aparelho (js/offline.js) e a tela
 * confirma na hora; depois tenta enviar (js/sync.js).
 *
 * MODO EDIÇÃO (Fase 3 — RF-41): aberta a partir de Lançamentos com um gasto
 * existente. Mesmo formulário, preenchido; "Salvar alterações" reenvia com o
 * MESMO id (o banco atualiza e regenera as parcelas — RN-17) e "Excluir"
 * marca como excluído. Tudo passa pela fila, então funciona sem internet.
 * =============================================================================
 */
import { h, trocar, avisar, vibrar, confirmar } from './dom.js';
import { teclado, mostradorValor, chips, gradeCategorias, segmentado } from './componentes.js';
import { calcularParcelas, MAX_PARCELAS } from '../parcelas.js';
import { moeda, mesAbrev, hojeSP } from '../formato.js';
import { validarGasto } from '../validacao.js';
import { iniciarCaptura } from '../geo.js';
import { enfileirar, listarFila, registrarUsoCategoria, novoId } from '../offline.js';
import { sincronizar } from '../sync.js';
import { log } from '../log.js';
import { estado, categoriasOrdenadas, cartoesAtivos, cartaoPorId, categoriaPorId, nomeMembro } from '../estado.js';

const FORMAS = [
  { valor: 'pix', rotulo: 'PIX', icone: '⚡' },
  { valor: 'debito', rotulo: 'Débito', icone: '💳' },
  { valor: 'credito', rotulo: 'Crédito', icone: '💳' },
  { valor: 'dinheiro', rotulo: 'Dinheiro', icone: '💵' },
  { valor: 'boleto', rotulo: 'Boleto', icone: '🧾' },
  { valor: 'outro', rotulo: 'Outro', icone: '•••' },
];

/** Preferências lembradas neste aparelho (conveniência, não é dado financeiro). */
const lembrar = {
  ler: (k, padrao) => { try { return localStorage.getItem(`financas-${k}`) ?? padrao; } catch { return padrao; } },
  gravar: (k, v) => { try { localStorage.setItem(`financas-${k}`, v ?? ''); } catch { /* ignora */ } },
};

/**
 * Monta a tela dentro de `raiz`.
 * @returns {() => void} função de limpeza (chamada ao trocar de tela)
 */
export function montarNovoGasto(raiz, { navegar, edicao = null }) {
  // ---- Estado do formulário ------------------------------------------------
  // `edicao` = linha da despesa sendo editada (null = gasto novo).
  const s = edicao ? {
    centavos: edicao.valor_total_centavos,
    forma: edicao.forma_pagamento,
    cartaoId: edicao.cartao_id,
    parcelas: edicao.qtd_parcelas,
    categoriaId: edicao.categoria_id,
    natureza: edicao.natureza,
    data: edicao.data_compra,
    descricao: edicao.descricao ?? '',
    localNome: edicao.local_nome ?? '',
  } : {
    centavos: 0,
    forma: lembrar.ler('ultima-forma', 'pix'),
    cartaoId: lembrar.ler('ultimo-cartao', '') || null,
    parcelas: 1,
    categoriaId: null,
    natureza: 'variavel',
    data: hojeSP(),
    descricao: '',
    localNome: '',
  };

  /** Cartões disponíveis; na edição inclui o cartão original mesmo se arquivado. */
  const listaCartoes = () => {
    const lista = cartoesAtivos();
    const original = edicao?.cartao_id && cartaoPorId(edicao.cartao_id);
    if (original && !lista.some((c) => c.id === original.id)) lista.push(original);
    return lista;
  };
  if (s.cartaoId && !listaCartoes().some((c) => c.id === s.cartaoId)) s.cartaoId = null;

  /** Categorias de gasto; na edição inclui a original mesmo se desativada. */
  const listaCategorias = () => {
    const lista = categoriasOrdenadas('despesa');
    const original = edicao && categoriaPorId(edicao.categoria_id);
    if (original && !lista.some((c) => c.id === original.id)) lista.unshift(original);
    return lista;
  };

  // ---- Localização (começa já) ---------------------------------------------
  const geoTexto = h('span', { class: 'geo' });
  const atualizarGeo = (situacao, pos) => {
    geoTexto.textContent = {
      buscando: '📍 buscando localização…',
      ok: `📍 localização ok (±${Math.round(pos?.precisao ?? 0)} m)`,
      negado: '📍 sem localização (permissão negada)',
      indisponivel: '📍 sem localização',
    }[situacao];
  };
  // Na edição, mantém a localização original (não captura de novo).
  let captura = edicao
    ? { atual: () => (edicao.latitude != null ? { latitude: edicao.latitude, longitude: edicao.longitude, precisao: edicao.precisao_metros } : null) }
    : iniciarCaptura(atualizarGeo);
  if (edicao) geoTexto.textContent = edicao.latitude != null ? '📍 localização original mantida' : '📍 sem localização';

  // ---- Valor ---------------------------------------------------------------
  const mostrador = mostradorValor();
  const tec = teclado({
    aoMudar: (c) => { s.centavos = c; mostrador.atualizar(c); atualizarPrevia(); },
  });

  // ---- Forma de pagamento + área do crédito --------------------------------
  const areaCredito = h('div', { class: 'area-credito' });
  const chipsForma = chips({
    opcoes: FORMAS, valor: s.forma, rotulo: 'Forma de pagamento',
    aoEscolher: (v) => {
      s.forma = v;
      if (v !== 'credito') s.parcelas = 1;
      lembrar.gravar('ultima-forma', v);
      desenharCredito();
    },
  });

  const previa = h('p', { class: 'previa-parcelas' });
  const seletorParcelas = h('select', {
    class: 'seletor-parcelas', 'aria-label': 'Parcelas',
    onchange: (e) => { s.parcelas = Number(e.target.value); atualizarPrevia(); },
  });

  function desenharCredito() {
    if (s.forma !== 'credito') { areaCredito.hidden = true; return; }
    areaCredito.hidden = false;
    const cartoes = listaCartoes();
    if (cartoes.length === 0) {
      trocar(areaCredito, h('div', { class: 'alerta-inline' },
        'Nenhum cartão cadastrado. ',
        h('button', { type: 'button', class: 'link', onclick: () => navegar('#/mais/cartoes') }, 'Cadastrar cartão')));
      return;
    }
    if (!s.cartaoId || !cartoes.some((c) => c.id === s.cartaoId)) s.cartaoId = cartoes[0].id;
    const chipsCartao = chips({
      rotulo: 'Cartão',
      valor: s.cartaoId,
      opcoes: cartoes.map((c) => ({
        valor: c.id,
        rotulo: `${c.apelido} ••${c.ultimos4}${c.user_id !== estado.perfil?.id ? ` (${nomeMembro(c.user_id)})` : ''}`,
      })),
      aoEscolher: (id) => { s.cartaoId = id; lembrar.gravar('ultimo-cartao', id); atualizarPrevia(); },
    });
    trocar(areaCredito, chipsCartao.elemento, h('div', { class: 'linha-parcelas' }, seletorParcelas, previa));
    atualizarPrevia();
  }

  /** Atualiza as opções 1x…24x e a frase "12x de R$ 83,33 — 1ª em Nov/26". */
  function atualizarPrevia() {
    if (s.forma !== 'credito') return;
    const cartao = cartaoPorId(s.cartaoId);
    trocar(seletorParcelas, Array.from({ length: MAX_PARCELAS }, (_, i) => {
      const n = i + 1;
      const valorParcela = s.centavos >= n ? moeda(Math.floor(s.centavos / n)) : '';
      return h('option', { value: String(n), selected: n === s.parcelas }, n === 1 ? `1x ${valorParcela}` : `${n}x ${valorParcela}`);
    }));
    if (!cartao || s.centavos === 0) {
      previa.textContent = cartao ? `Fecha dia ${cartao.dia_fechamento} · vence dia ${cartao.dia_vencimento}` : '';
      return;
    }
    try {
      const ps = calcularParcelas({
        valorTotalCentavos: s.centavos, qtdParcelas: s.parcelas, dataCompra: s.data,
        formaPagamento: 'credito', cartao,
      });
      const texto = ps.length === 1
        ? `1x de ${moeda(ps[0].valor_centavos)} — fatura de ${mesAbrev(ps[0].competencia)}`
        : `${ps.length}x de ${moeda(ps[ps.length - 1].valor_centavos)} — 1ª em ${mesAbrev(ps[0].competencia)}`;
      const ajuste = ps.length > 1 && ps[0].valor_centavos !== ps[1].valor_centavos
        ? ` (1ª de ${moeda(ps[0].valor_centavos)})` : '';
      previa.textContent = texto + ajuste;
      previa.classList.remove('erro');
    } catch (e) {
      previa.textContent = e.message;
      previa.classList.add('erro');
    }
  }

  // ---- Categoria -----------------------------------------------------------
  const grade = gradeCategorias({
    categorias: listaCategorias(),
    selecionada: s.categoriaId,
    aoEscolher: (id) => { s.categoriaId = id; },
  });

  // ---- Detalhes opcionais --------------------------------------------------
  const natureza = segmentado({
    rotulo: 'Natureza', valor: s.natureza,
    opcoes: [{ valor: 'variavel', rotulo: 'Variável' }, { valor: 'fixa', rotulo: 'Fixo' }],
    aoEscolher: (v) => { s.natureza = v; },
  });
  const campoData = h('input', {
    type: 'date', class: 'campo-data', value: s.data, max: '2099-12-31', 'aria-label': 'Data da compra',
    onchange: (e) => { s.data = e.target.value || hojeSP(); atualizarPrevia(); },
  });
  const campoDescricao = h('input', {
    type: 'text', class: 'campo', placeholder: 'Descrição (opcional)', maxlength: '120', enterkeyhint: 'done', value: s.descricao,
    oninput: (e) => { s.descricao = e.target.value; },
  });
  const campoLocal = h('input', {
    type: 'text', class: 'campo', placeholder: 'Nome do local (opcional)', maxlength: '80', enterkeyhint: 'done', value: s.localNome,
    oninput: (e) => { s.localNome = e.target.value; },
  });

  // ---- Salvar --------------------------------------------------------------
  const botaoSalvar = h('button', { type: 'button', class: 'btn btn-primario btn-salvar', onclick: salvar },
    edicao ? 'Salvar alterações' : 'Salvar gasto');

  async function salvar() {
    const erros = validarGasto({
      valorCentavos: s.centavos, categoriaId: s.categoriaId, formaPagamento: s.forma,
      cartaoId: s.cartaoId, qtdParcelas: s.parcelas, data: s.data,
    });
    if (erros.length) {
      vibrar(60);
      avisar(erros[0], { tipo: 'aviso' });
      return;
    }

    let parcelas;
    const cartao = s.forma === 'credito' ? cartaoPorId(s.cartaoId) : undefined;
    try {
      parcelas = calcularParcelas({
        valorTotalCentavos: s.centavos, qtdParcelas: s.parcelas, dataCompra: s.data,
        formaPagamento: s.forma, cartao,
      });
    } catch (e) {
      avisar(e.message, { tipo: 'erro' });
      return;
    }

    botaoSalvar.disabled = true;
    const id = edicao?.id ?? novoId();
    const pos = captura.atual();
    const dados = {
      id,
      data_compra: s.data,
      valor_total_centavos: s.centavos,
      descricao: s.descricao.trim() || null,
      categoria_id: s.categoriaId,
      forma_pagamento: s.forma,
      cartao_id: s.forma === 'credito' ? s.cartaoId : null,
      qtd_parcelas: s.parcelas,
      natureza: s.natureza,
      latitude: pos?.latitude ?? null,
      longitude: pos?.longitude ?? null,
      precisao_metros: pos?.precisao ?? null,
      local_nome: s.localNome.trim() || null,
      origem: edicao?.origem ?? 'manual',
      // Vínculo com a recorrência que gerou este gasto (se houver) é mantido.
      recorrencia_id: edicao?.recorrencia_id ?? null,
      competencia_recorrencia: edicao?.competencia_recorrencia ?? null,
      observacao: edicao?.observacao ?? null,
    };

    try {
      await enfileirar({ tipo: 'despesa', id, user_id: estado.perfil.id, dados, parcelas });
    } catch (e) {
      log.erro('gasto', 'Falha ao guardar no aparelho', e);
      avisar('Não foi possível salvar neste aparelho. Tente de novo.', { tipo: 'erro' });
      botaoSalvar.disabled = false;
      return;
    }

    vibrar(15);
    log.info('gasto', edicao ? 'Gasto alterado' : 'Gasto salvo', { id, valor: s.centavos, forma: s.forma, parcelas: s.parcelas, comLocal: Boolean(pos) });
    if (edicao) {
      avisar('Alteração salva ✓', { tipo: 'ok' });
      sincronizar('editar');
      navegar('#/lancamentos');
      return;
    }
    const aviso = avisar(`Salvo ✓ ${moeda(s.centavos)} — enviando…`, { tipo: 'ok', duracao: 4000 });

    await registrarUsoCategoria(s.categoriaId);
    estado.usoCategorias[s.categoriaId] = (estado.usoCategorias[s.categoriaId] ?? 0) + 1;
    limparFormulario();
    botaoSalvar.disabled = false;

    // Tenta enviar agora; a confirmação diz se já foi ou se aguarda sinal.
    await sincronizar('salvar');
    const aindaNaFila = (await listarFila(estado.perfil.id)).find((i) => i.id === id);
    if (!aindaNaFila) aviso.atualizar('Salvo ✓ e sincronizado', 'ok');
    else if (aindaNaFila.estado === 'erro') aviso.atualizar(`Salvo no aparelho, mas o servidor recusou: ${aindaNaFila.ultimo_erro}`, 'erro');
    else aviso.atualizar('Salvo ✓ no aparelho — envia quando tiver sinal', 'ok');
  }

  /** Prepara para o próximo gasto (mantém forma de pagamento e cartão). */
  function limparFormulario() {
    tec.definir(0);
    s.parcelas = 1;
    s.categoriaId = null;
    s.descricao = '';
    s.localNome = '';
    s.natureza = 'variavel';
    s.data = hojeSP();
    campoDescricao.value = '';
    campoLocal.value = '';
    campoData.value = s.data;
    natureza.definir('variavel');
    grade.recarregar(categoriasOrdenadas('despesa'));
    grade.selecionar(null);
    desenharCredito();
    captura = iniciarCaptura(atualizarGeo); // nova posição para o próximo gasto
  }

  // ---- Excluir (só na edição) ------------------------------------------------
  async function excluir() {
    const ok = await confirmar(`Excluir este gasto de ${moeda(edicao.valor_total_centavos)}?${edicao.qtd_parcelas > 1 ? ` As ${edicao.qtd_parcelas} parcelas também serão removidas.` : ''}`,
      { sim: 'Excluir', perigoso: true });
    if (!ok) return;
    await enfileirar({
      tipo: 'despesa', id: edicao.id, user_id: estado.perfil.id,
      dados: { ...camposDespesa(edicao), excluido_em: new Date().toISOString() },
      parcelas: [],
    });
    log.info('gasto', 'Gasto excluído', { id: edicao.id });
    avisar('Gasto excluído ✓', { tipo: 'ok' });
    sincronizar('excluir');
    navegar('#/lancamentos');
  }

  // ---- Montagem ------------------------------------------------------------
  trocar(raiz,
    h('section', { class: 'tela-lancamento' },
      h('div', { class: 'rolagem' },
        edicao ? h('div', { class: 'cabecalho-edicao' },
          h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/lancamentos') }, '‹ Lançamentos'),
          h('button', { type: 'button', class: 'link perigo', onclick: excluir }, 'Excluir')) : null,
        mostrador.elemento,
        chipsForma.elemento,
        areaCredito,
        h('h2', { class: 'rotulo' }, 'Categoria'),
        grade.elemento,
        h('div', { class: 'linha-detalhes' }, natureza.elemento, campoData),
        campoDescricao,
        h('details', { class: 'mais-detalhes' },
          h('summary', {}, 'Mais detalhes'),
          campoLocal,
          geoTexto),
      ),
      h('div', { class: 'doca' }, tec.elemento, botaoSalvar),
    ));
  desenharCredito();
  // Na edição, o TECLADO começa com o valor original (senão apagar um
  // dígito partiria do zero). Fica no fim porque atualiza a prévia.
  if (edicao) tec.definir(edicao.valor_total_centavos);

  return () => tec.elemento.desligar();
}

/** Só as colunas que a RPC salvar_despesa() aceita (a lista traz outras). */
export function camposDespesa(d) {
  const campos = ['id', 'data_compra', 'valor_total_centavos', 'descricao', 'categoria_id', 'forma_pagamento',
    'cartao_id', 'qtd_parcelas', 'natureza', 'recorrencia_id', 'competencia_recorrencia', 'latitude',
    'longitude', 'precisao_metros', 'local_nome', 'origem', 'observacao'];
  return Object.fromEntries(campos.map((c) => [c, d[c] ?? null]));
}
