/**
 * =============================================================================
 * js/carteira.js — Compras da Carteira do iPhone → sugestão de gasto (v1.2)
 * -----------------------------------------------------------------------------
 * Uma compra paga com a Carteira chega pela caixa de entrada com: valor,
 * nome do estabelecimento, nome do cartão (como aparece na Carteira) e a
 * hora. Aqui transformamos isso numa SUGESTÃO para a tela de gasto:
 *   * data da compra (dia em São Paulo);
 *   * forma de pagamento e cartão — pelo nome do cartão (4 últimos dígitos
 *     ou apelido parecido) ou pelo que a pessoa escolheu da última vez;
 *   * categoria — a mesma que a pessoa usou da última vez nesse lugar.
 * A pessoa sempre confere e pode trocar antes de salvar.
 *
 * "Da última vez" = lembranças guardadas no aparelho (localStorage) pela
 * tela de gasto, com as chaves normalizadas por normalizar().
 *
 * Funções puras (testadas em tests/js/carteira.test.js).
 * =============================================================================
 */
import { hojeSP } from './formato.js';

/** "Padaria São José  " → "padaria sao jose" (sem acento, minúsculas, espaço único). */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Descobre o cartão cadastrado a partir do nome que a Carteira mostra.
 * Ordem: 4 últimos dígitos no nome → apelido contido no nome (ou vice-versa)
 * → primeira palavra igual (ex.: "nubank"). Só cartões ativos da pessoa.
 * @returns {object|null} o cartão, ou null se não der para ter certeza
 */
export function acharCartao(nomeCarteira, cartoes, userId) {
  const nome = normalizar(nomeCarteira);
  if (!nome) return null;
  const meus = cartoes.filter((c) => c.ativo !== false && c.user_id === userId);
  const porDigitos = meus.filter((c) => c.ultimos4 && new RegExp(`(^|\\D)${c.ultimos4}(\\D|$)`).test(nome));
  if (porDigitos.length === 1) return porDigitos[0];
  const porApelido = meus.filter((c) => {
    const apelido = normalizar(c.apelido);
    return apelido && (nome.includes(apelido) || apelido.includes(nome));
  });
  if (porApelido.length === 1) return porApelido[0];
  const primeira = nome.split(' ')[0];
  const porPalavra = meus.filter((c) => normalizar(c.apelido).split(' ')[0] === primeira);
  return porPalavra.length === 1 ? porPalavra[0] : null;
}

/**
 * Sugestão de gasto para um item da caixa de entrada.
 * @param {object} item       { valor_centavos, estabelecimento, cartao_nome, recebido_em }
 * @param {object} p
 * @param {Array}  p.cartoes  cartões da família (estado.cartoes)
 * @param {string} p.userId   quem está lançando
 * @param {object} [p.lembrancas] { categorias: {estab→categoriaId}, cartoes: {nomeCartao→{forma, cartaoId}} }
 * @returns {{centavos:number, data:string, localNome:string, forma:string|null, cartaoId:string|null, categoriaId:string|null}}
 */
export function sugerirGasto(item, { cartoes, userId, lembrancas = {} }) {
  const cartao = acharCartao(item.cartao_nome, cartoes, userId);
  const lembrado = lembrancas.cartoes?.[normalizar(item.cartao_nome)] ?? null;
  const lembradoValido = lembrado && (lembrado.forma !== 'credito' || cartoes.some((c) => c.id === lembrado.cartaoId && c.ativo !== false));

  let forma = null;
  let cartaoId = null;
  if (lembradoValido) {
    // A escolha da própria pessoa vale mais que o palpite pelo nome.
    forma = lembrado.forma;
    cartaoId = lembrado.forma === 'credito' ? lembrado.cartaoId : null;
  } else if (cartao) {
    forma = 'credito';
    cartaoId = cartao.id;
  }

  return {
    centavos: item.valor_centavos,
    data: hojeSP(new Date(item.recebido_em)),
    localNome: item.estabelecimento ?? '',
    forma,
    cartaoId,
    categoriaId: lembrancas.categorias?.[normalizar(item.estabelecimento)] ?? null,
  };
}

/**
 * Atualiza as lembranças depois de lançar um gasto vindo da Carteira.
 * @returns {object} novas lembranças (não altera a original)
 */
export function lembrarEscolha(lembrancas, item, { forma, cartaoId, categoriaId }) {
  const novo = { categorias: { ...(lembrancas?.categorias ?? {}) }, cartoes: { ...(lembrancas?.cartoes ?? {}) } };
  const estab = normalizar(item.estabelecimento);
  const nomeCartao = normalizar(item.cartao_nome);
  if (estab && categoriaId) novo.categorias[estab] = categoriaId;
  if (nomeCartao && forma) novo.cartoes[nomeCartao] = { forma, cartaoId: forma === 'credito' ? cartaoId : null };
  return novo;
}
