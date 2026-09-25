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
 * COMPRA COM JUROS (v1.1 — RF-15): no crédito dá para digitar o VALOR DA
 * PARCELA ("12x de R$ 189,90") em vez do total — o total vira parcela × N e
 * as parcelas saem iguais às da loja. Opcionalmente, o preço à vista mostra
 * quanto se paga de juros (e a taxa ao mês).
 *
 * CARTEIRA DO IPHONE (v1.2 — RF-16): aberta a partir da caixa de entrada,
 * já vem com valor, data, local e — quando dá — cartão e categoria
 * sugeridos (js/carteira.js). Ao salvar, o item da caixa é marcado como
 * lançado (js/sync.js). Sem internet também funciona (vai pela fila).
 *
 * MODO EDIÇÃO (Fase 3 — RF-41): aberta a partir de Lançamentos com um gasto
 * existente. Mesmo formulário, preenchido; "Salvar alterações" reenvia com o
 * MESMO id (o banco atualiza e regenera as parcelas — RN-17) e "Excluir"
 * marca como excluído. Tudo passa pela fila, então funciona sem internet.
 * =============================================================================
 */
import { h, trocar, avisar, vibrar, confirmar } from './dom.js';
import { teclado, mostradorValor, chips, gradeCategorias, segmentado } from './componentes.js';
import { calcularParcelas, MAX_PARCELAS, totalPelaParcela, jurosDaCompra } from '../parcelas.js';
import { moeda, mesAbrev, hojeSP, percentual, lerValorBR, valorParaCampo, dataHoraBR } from '../formato.js';
import { validarGasto } from '../validacao.js';
import { iniciarCaptura } from '../geo.js';
import { enfileirar, listarFila, registrarUsoCategoria, novoId } from '../offline.js';
import { sincronizar } from '../sync.js';
import { log } from '../log.js';
import { estado, categoriasOrdenadas, cartoesAtivos, cartaoPorId, categoriaPorId, nomeMembro, tomarItemDaCaixa } from '../estado.js';
import { sugerirGasto, lembrarEscolha } from '../carteira.js';
import * as db from '../db.js';

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
/** v1.2: o que a pessoa escolheu para cada lugar/cartão da Carteira (neste aparelho). */
const lembrancasCarteira = {
  ler: () => { try { return JSON.parse(localStorage.getItem('financas-carteira') ?? '{}'); } catch { return {}; } },
  gravar: (v) => { try { localStorage.setItem('financas-carteira', JSON.stringify(v)); } catch { /* ignora */ } },
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
    modoValor: 'total',                       // na edição o teclado mostra o total
    aVista: edicao.valor_a_vista_centavos ?? null,
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
    modoValor: 'total',   // 'total' | 'parcela' (só no crédito)
    aVista: null,         // preço à vista (centavos) — opcional, só com 2x ou mais
  };

  /** O teclado digita a parcela? (só no crédito e no modo "parcela") */
  const digitandoParcela = () => s.forma === 'credito' && s.modoValor === 'parcela';
  /** Total da compra em centavos, qualquer que seja o modo. */
  const totalCentavos = () => (digitandoParcela() && s.centavos > 0 ? totalPelaParcela(s.centavos, s.parcelas) : s.centavos);

  /** Cartões disponíveis; na edição inclui o cartão original mesmo se arquivado. */
  const listaCartoes = () => {
    const lista = cartoesAtivos();
    const original = edicao?.cartao_id && cartaoPorId(edicao.cartao_id);
    if (original && !lista.some((c) => c.id === original.id)) lista.push(original);
    return lista;
  };
  // v1.2: veio da caixa de entrada (Carteira do iPhone)? Preenche com a sugestão.
  const daCaixa = edicao ? null : tomarItemDaCaixa();
  if (daCaixa) {
    const sug = sugerirGasto(daCaixa, { cartoes: estado.cartoes, userId: estado.perfil.id, lembrancas: lembrancasCarteira.ler() });
    Object.assign(s, { centavos: sug.centavos, data: sug.data, localNome: sug.localNome, categoriaId: sug.categoriaId });
    if (sug.forma) { s.forma = sug.forma; s.cartaoId = sug.cartaoId ?? s.cartaoId; }
  }
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
  // Na edição, mantém a localização original (não captura de novo). Compra da
  // Carteira: a posição de AGORA não é a do lugar da compra — não captura.
  let captura = daCaixa ? { atual: () => null } : edicao
    ? { atual: () => (edicao.latitude != null ? { latitude: edicao.latitude, longitude: edicao.longitude, precisao: edicao.precisao_metros } : null) }
    : iniciarCaptura(atualizarGeo);
  if (edicao) geoTexto.textContent = edicao.latitude != null ? '📍 localização original mantida' : '📍 sem localização';
  if (daCaixa) geoTexto.textContent = '📍 sem localização (compra recebida da Carteira)';

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
  const modoValor = segmentado({
    rotulo: 'O valor digitado é', valor: s.modoValor,
    opcoes: [{ valor: 'total', rotulo: 'Valor total' }, { valor: 'parcela', rotulo: 'Valor da parcela' }],
    aoEscolher: (v) => { s.modoValor = v; atualizarPrevia(); },
  });
  const textoJuros = h('p', { class: 'texto-juros' });
  const campoAVista = h('input', {
    type: 'text', inputmode: 'decimal', class: 'campo campo-a-vista', placeholder: 'Ex.: 2.000,00',
    'aria-label': 'Preço à vista', value: s.aVista ? valorParaCampo(s.aVista) : '',
    oninput: (e) => { s.aVista = lerValorBR(e.target.value); atualizarJuros(); },
  });
  const areaJuros = h('div', { class: 'area-juros' },
    h('span', { class: 'rotulo-campo' }, 'Preço à vista (opcional — para ver os juros)'), campoAVista, textoJuros);
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
    trocar(areaCredito, chipsCartao.elemento, modoValor.elemento,
      h('div', { class: 'linha-parcelas' }, seletorParcelas, previa), areaJuros);
    atualizarPrevia();
  }

  /** Atualiza as opções 1x…24x e a frase "12x de R$ 83,33 — 1ª em Nov/26". */
  function atualizarPrevia() {
    if (s.forma !== 'credito') return;
    const cartao = cartaoPorId(s.cartaoId);
    trocar(seletorParcelas, Array.from({ length: MAX_PARCELAS }, (_, i) => {
      const n = i + 1;
      // Modo parcela: "12x = R$ 2.278,80" (total); modo total: "12x R$ 83,33" (parcela).
      const rotulo = digitandoParcela()
        ? (s.centavos > 0 ? `= ${moeda(s.centavos * n)}` : '')
        : (s.centavos >= n ? moeda(Math.floor(s.centavos / n)) : '');
      return h('option', { value: String(n), selected: n === s.parcelas }, `${n}x ${rotulo}`);
    }));
    atualizarJuros();
    if (!cartao || s.centavos === 0) {
      previa.textContent = cartao ? `Fecha dia ${cartao.dia_fechamento} · vence dia ${cartao.dia_vencimento}` : '';
      previa.classList.remove('erro');
      return;
    }
    try {
      const ps = calcularParcelas({
        valorTotalCentavos: totalCentavos(), qtdParcelas: s.parcelas, dataCompra: s.data,
        formaPagamento: 'credito', cartao,
      });
      const total = digitandoParcela() && ps.length > 1 ? ` = ${moeda(totalCentavos())}` : '';
      const texto = ps.length === 1
        ? `1x de ${moeda(ps[0].valor_centavos)} — fatura de ${mesAbrev(ps[0].competencia)}`
        : `${ps.length}x de ${moeda(ps[ps.length - 1].valor_centavos)}${total} — 1ª em ${mesAbrev(ps[0].competencia)}`;
      const ajuste = ps.length > 1 && ps[0].valor_centavos !== ps[1].valor_centavos
        ? ` (1ª de ${moeda(ps[0].valor_centavos)})` : '';
      previa.textContent = texto + ajuste;
      previa.classList.remove('erro');
    } catch (e) {
      previa.textContent = e.message;
      previa.classList.add('erro');
    }
  }

  /** "Juros: R$ 278,80 (13,9%) · ≈ 2,1% ao mês" — só no crédito com 2x ou mais. */
  function atualizarJuros() {
    areaJuros.hidden = s.forma !== 'credito' || s.parcelas < 2;
    textoJuros.classList.remove('erro');
    if (areaJuros.hidden || !s.aVista || s.centavos === 0) { textoJuros.textContent = ''; return; }
    try {
      const j = jurosDaCompra({ totalCentavos: totalCentavos(), aVistaCentavos: s.aVista, qtdParcelas: s.parcelas });
      textoJuros.textContent = j.jurosCentavos === 0
        ? 'Sem juros ✓'
        : `Juros: ${moeda(j.jurosCentavos)} (${percentual(j.jurosPct)} a mais)${j.taxaMensalPct ? ` · ≈ ${percentual(j.taxaMensalPct)} ao mês` : ''}`;
    } catch (e) {
      textoJuros.textContent = e.message;
      textoJuros.classList.add('erro');
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
    const total = totalCentavos();
    // Preço à vista só vale em compra parcelada no crédito.
    const aVista = s.forma === 'credito' && s.parcelas > 1 && s.aVista ? s.aVista : null;
    const erros = validarGasto({
      valorCentavos: total, categoriaId: s.categoriaId, formaPagamento: s.forma,
      cartaoId: s.cartaoId, qtdParcelas: s.parcelas, data: s.data,
    });
    if (aVista && aVista > total) erros.push('O preço à vista não pode ser maior que o total parcelado.');
    if (erros.length) {
      vibrar(60);
      avisar(erros[0], { tipo: 'aviso' });
      return;
    }

    let parcelas;
    const cartao = s.forma === 'credito' ? cartaoPorId(s.cartaoId) : undefined;
    try {
      parcelas = calcularParcelas({
        valorTotalCentavos: total, qtdParcelas: s.parcelas, dataCompra: s.data,
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
      valor_total_centavos: total,
      valor_a_vista_centavos: aVista,
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
      origem: daCaixa ? 'carteira_iphone' : (edicao?.origem ?? 'manual'),
      // Vínculo com a recorrência que gerou este gasto (se houver) é mantido.
      recorrencia_id: edicao?.recorrencia_id ?? null,
      competencia_recorrencia: edicao?.competencia_recorrencia ?? null,
      observacao: edicao?.observacao ?? null,
    };

    try {
      await enfileirar({ tipo: 'despesa', id, user_id: estado.perfil.id, dados, parcelas, caixaId: daCaixa?.id ?? null });
    } catch (e) {
      log.erro('gasto', 'Falha ao guardar no aparelho', e);
      avisar('Não foi possível salvar neste aparelho. Tente de novo.', { tipo: 'erro' });
      botaoSalvar.disabled = false;
      return;
    }

    vibrar(15);
    log.info('gasto', edicao ? 'Gasto alterado' : 'Gasto salvo', { id, valor: total, forma: s.forma, parcelas: s.parcelas, modo: s.modoValor, comJuros: Boolean(aVista), comLocal: Boolean(pos) });
    if (edicao) {
      avisar('Alteração salva ✓', { tipo: 'ok' });
      sincronizar('editar');
      navegar('#/lancamentos');
      return;
    }
    if (daCaixa) {
      lembrancasCarteira.gravar(lembrarEscolha(lembrancasCarteira.ler(), daCaixa,
        { forma: s.forma, cartaoId: s.cartaoId, categoriaId: s.categoriaId }));
      await registrarUsoCategoria(s.categoriaId);
      avisar(`Lançado ✓ ${moeda(total)}`, { tipo: 'ok' });
      await sincronizar('caixa');
      navegar('#/caixa');
      return;
    }
    const aviso = avisar(`Salvo ✓ ${moeda(total)} — enviando…`, { tipo: 'ok', duracao: 4000 });

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
    s.modoValor = 'total';
    s.aVista = null;
    modoValor.definir('total');
    campoAVista.value = '';
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

  // ---- Carteira do iPhone (v1.2) -------------------------------------------
  async function descartarDaCaixa() {
    if (!(await confirmar(`Descartar a compra de ${moeda(daCaixa.valor_centavos)}${daCaixa.estabelecimento ? ` em ${daCaixa.estabelecimento}` : ''}? Ela não vira gasto.`,
      { sim: 'Descartar', perigoso: true }))) return;
    try {
      await db.marcarCaixa(daCaixa.id, 'descartado');
      avisar('Compra descartada', { tipo: 'ok' });
      navegar('#/caixa');
    } catch (e) {
      avisar(e.tipo === 'rede' ? 'Sem internet: descarte quando tiver sinal.' : e.message, { tipo: 'erro' });
    }
  }

  /** "📥 2 compras da Carteira para lançar ›" — só num gasto novo, com internet. */
  const bannerCaixa = h('button', { type: 'button', class: 'banner-caixa', hidden: true, onclick: () => navegar('#/caixa') });
  if (!edicao && !daCaixa && navigator.onLine) {
    Promise.all([db.listarCaixaPendente(estado.perfil.id), listarFila(estado.perfil.id)])
      .then(([itens, fila]) => {
        const naFila = new Set(fila.map((i) => i.caixaId).filter(Boolean));
        const n = itens.filter((i) => !naFila.has(i.id)).length;
        if (!n) return;
        bannerCaixa.textContent = `📥 ${n} compra${n > 1 ? 's' : ''} da Carteira para lançar ›`;
        bannerCaixa.hidden = false;
      })
      .catch((e) => log.info('caixa', 'Caixa de entrada indisponível', { motivo: e.message }));
  }

  // ---- Montagem ------------------------------------------------------------
  trocar(raiz,
    h('section', { class: 'tela-lancamento' },
      h('div', { class: 'rolagem' },
        edicao ? h('div', { class: 'cabecalho-edicao' },
          h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/lancamentos') }, '‹ Lançamentos'),
          h('button', { type: 'button', class: 'link perigo', onclick: excluir }, 'Excluir')) : null,
        daCaixa ? h('div', { class: 'cabecalho-edicao' },
          h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/caixa') }, '‹ Carteira do iPhone'),
          h('button', { type: 'button', class: 'link perigo', onclick: descartarDaCaixa }, 'Descartar')) : null,
        daCaixa ? h('p', { class: 'info-caixa' },
          `📥 ${daCaixa.estabelecimento ?? 'Compra'} · ${dataHoraBR(daCaixa.recebido_em)}${daCaixa.cartao_nome ? ` · ${daCaixa.cartao_nome}` : ''}`) : null,
        bannerCaixa,
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
  if (daCaixa) tec.definir(daCaixa.valor_centavos);

  return () => tec.elemento.desligar();
}

/** Só as colunas que a RPC salvar_despesa() aceita (a lista traz outras). */
export function camposDespesa(d) {
  const campos = ['id', 'data_compra', 'valor_total_centavos', 'descricao', 'categoria_id', 'forma_pagamento',
    'cartao_id', 'qtd_parcelas', 'natureza', 'recorrencia_id', 'competencia_recorrencia', 'latitude',
    'longitude', 'precisao_metros', 'local_nome', 'origem', 'observacao', 'valor_a_vista_centavos'];
  return Object.fromEntries(campos.map((c) => [c, d[c] ?? null]));
}
