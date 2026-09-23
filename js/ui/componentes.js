/**
 * =============================================================================
 * js/ui/componentes.js — Peças de tela reaproveitadas (gasto, ganho, cadastros)
 * -----------------------------------------------------------------------------
 *   teclado()          teclado numérico grande, digitação em centavos
 *   chips()            botões de escolha única (forma de pagamento, cartão…)
 *   gradeCategorias()  grade de categorias com ícone
 *   segmentado()       alternância de 2+ opções (Fixo | Variável)
 *   indicadorSync()    "✓ sincronizado" / "3 aguardando sinal"
 * =============================================================================
 */
import { h, trocar, vibrar } from './dom.js';
import { moeda } from '../formato.js';
import { VALOR_MAXIMO_CENTAVOS } from '../validacao.js';

// -----------------------------------------------------------------------------
// Teclado numérico estilo app de banco
// -----------------------------------------------------------------------------

/**
 * Teclado que digita centavos: 1 → 0,01; 12 → 0,12; 1234 → 12,34.
 * Segurar o ⌫ apaga tudo.
 * @param {{aoMudar:(centavos:number)=>void}} opcoes
 * @returns {{elemento:HTMLElement, valor:()=>number, definir:(c:number)=>void}}
 */
export function teclado({ aoMudar }) {
  let centavos = 0;

  const definir = (novo) => {
    centavos = Math.max(0, Math.min(novo, VALOR_MAXIMO_CENTAVOS));
    aoMudar(centavos);
  };

  const digitar = (tecla) => {
    vibrar(5);
    if (tecla === '⌫') return definir(Math.floor(centavos / 10));
    const digitos = tecla === '00' ? 2 : 1;
    const proximo = centavos * 10 ** digitos + (tecla === '00' ? 0 : Number(tecla));
    if (proximo <= VALOR_MAXIMO_CENTAVOS) definir(proximo);
  };

  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];
  const elemento = h('div', { class: 'teclado', role: 'group', 'aria-label': 'Teclado numérico' },
    teclas.map((t) => {
      const botao = h('button', {
        type: 'button',
        class: `tecla${t === '⌫' ? ' tecla-apagar' : ''}`,
        'aria-label': t === '⌫' ? 'Apagar' : t,
        onclick: () => digitar(t),
      }, t);
      if (t === '⌫') ligarSegurar(botao, () => { vibrar(20); definir(0); });
      return botao;
    }),
  );

  // Teclado físico (no computador) também funciona.
  const aoTeclar = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (/^[0-9]$/.test(e.key)) digitar(e.key);
    else if (e.key === 'Backspace') digitar('⌫');
  };
  document.addEventListener('keydown', aoTeclar);
  elemento.desligar = () => document.removeEventListener('keydown', aoTeclar);

  return { elemento, valor: () => centavos, definir };
}

/** Dispara `fn` ao segurar o botão por 600 ms. */
function ligarSegurar(botao, fn) {
  let timer;
  const iniciar = () => { timer = setTimeout(fn, 600); };
  const cancelar = () => clearTimeout(timer);
  botao.addEventListener('pointerdown', iniciar);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => botao.addEventListener(ev, cancelar));
}

/** Mostrador do valor: "R$ 1.234,56". */
export function mostradorValor() {
  const el = h('div', { class: 'valor-grande zero', 'aria-live': 'polite' }, moeda(0));
  return {
    elemento: el,
    atualizar(centavos) {
      el.textContent = moeda(centavos);
      el.classList.toggle('zero', centavos === 0);
    },
  };
}

// -----------------------------------------------------------------------------
// Chips (escolha única)
// -----------------------------------------------------------------------------

/**
 * @param {{opcoes:Array<{valor:string, rotulo:string, icone?:string}>, valor:string,
 *          aoEscolher:(valor:string)=>void, rotulo?:string, rolavel?:boolean}} p
 */
export function chips({ opcoes, valor, aoEscolher, rotulo, rolavel = true }) {
  const el = h('div', { class: `chips${rolavel ? ' rolavel' : ''}`, role: 'radiogroup', 'aria-label': rotulo });
  const desenhar = (atual) => trocar(el, opcoes.map((o) => h('button', {
    type: 'button',
    class: `chip${o.valor === atual ? ' ativo' : ''}`,
    role: 'radio',
    'aria-checked': String(o.valor === atual),
    onclick: () => { vibrar(5); desenhar(o.valor); aoEscolher(o.valor); },
  }, o.icone ? h('span', { class: 'chip-icone', 'aria-hidden': 'true' }, o.icone) : null, o.rotulo)));
  desenhar(valor);
  return { elemento: el, definir: desenhar };
}

// -----------------------------------------------------------------------------
// Grade de categorias
// -----------------------------------------------------------------------------

/**
 * @param {{categorias:Array, selecionada:string|null, aoEscolher:(id:string)=>void}} p
 */
export function gradeCategorias({ categorias, selecionada, aoEscolher }) {
  const el = h('div', { class: 'grade-cat', role: 'radiogroup', 'aria-label': 'Categoria' });
  let atual = selecionada;
  const desenhar = (lista = categorias) => {
    categorias = lista;
    if (lista.length === 0) {
      trocar(el, h('p', { class: 'vazio' }, 'Nenhuma categoria. Conecte-se à internet uma vez para carregar.'));
      return;
    }
    trocar(el, lista.map((c) => h('button', {
      type: 'button',
      class: `cat${c.id === atual ? ' ativa' : ''}`,
      role: 'radio',
      'aria-checked': String(c.id === atual),
      style: { '--cor-cat': c.cor },
      onclick: () => { vibrar(5); atual = c.id; desenhar(); aoEscolher(c.id); },
    }, h('span', { class: 'cat-icone', 'aria-hidden': 'true' }, c.icone), h('span', { class: 'cat-nome' }, c.nome.replace(/\//g, '/\u200b')))));
  };
  desenhar();
  return {
    elemento: el,
    selecionar: (id) => { atual = id; desenhar(); },
    recarregar: (lista) => desenhar(lista),
  };
}

// -----------------------------------------------------------------------------
// Segmentado (Fixo | Variável)
// -----------------------------------------------------------------------------

export function segmentado({ opcoes, valor, aoEscolher, rotulo }) {
  const el = h('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': rotulo });
  const desenhar = (atual) => trocar(el, opcoes.map((o) => h('button', {
    type: 'button',
    class: o.valor === atual ? 'ativo' : '',
    role: 'radio',
    'aria-checked': String(o.valor === atual),
    onclick: () => { desenhar(o.valor); aoEscolher(o.valor); },
  }, o.rotulo)));
  desenhar(valor);
  return { elemento: el, definir: desenhar };
}

// -----------------------------------------------------------------------------
// Indicador de sincronização (topo da tela)
// -----------------------------------------------------------------------------

/**
 * Pílula no topo: mostra se está tudo enviado ou quantos aguardam sinal.
 * Tocar nela força uma sincronização.
 */
export function indicadorSync({ aoTocar }) {
  const el = h('button', { type: 'button', class: 'indicador', onclick: aoTocar, 'aria-live': 'polite' });
  return {
    elemento: el,
    atualizar({ pendentes = 0, comErro = 0, sincronizando = false, precisaLogin = false, online = true }) {
      let texto; let classe;
      if (precisaLogin) { texto = '🔒 Entre de novo'; classe = 'erro'; }
      else if (comErro > 0) { texto = `⚠️ ${comErro} com erro`; classe = 'erro'; }
      else if (sincronizando) { texto = '⟳ Enviando…'; classe = 'enviando'; }
      else if (pendentes > 0) {
        texto = `⏳ ${pendentes} aguardando sinal`;
        classe = 'pendente';
      } else if (!online) { texto = '✈️ Sem internet'; classe = 'pendente'; }
      else { texto = '✓ Tudo sincronizado'; classe = 'ok'; }
      el.textContent = texto;
      el.className = `indicador ${classe}`;
    },
  };
}
