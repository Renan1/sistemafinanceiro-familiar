/**
 * =============================================================================
 * js/ui/dom.js — Utilitários de tela (criar elementos, avisos, confirmações)
 * -----------------------------------------------------------------------------
 * Sem framework (D-01): as telas montam o HTML com a função h(), que cria
 * elementos de forma segura (texto nunca é interpretado como HTML, o que
 * evita injeção de código por uma descrição maliciosa, por exemplo).
 *
 *   h('button', { class: 'btn', onclick: salvar }, 'Salvar')
 *   → <button class="btn">Salvar</button> com o clique ligado
 * =============================================================================
 */

/**
 * Cria um elemento.
 * @param {string} tag        'div', 'button'…
 * @param {object} [props]    class, style, dataset, on<evento>, atributos, propriedades
 * @param {...any} filhos     textos, elementos, arrays, null/false (ignorados)
 */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      // setProperty aceita também variáveis CSS (ex.: '--cor-cat').
      for (const [prop, val] of Object.entries(v)) el.style.setProperty(prop.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`), val);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;   // value, checked, disabled…
    else el.setAttribute(k, v === true ? '' : v);
  }
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

/** Troca todo o conteúdo de um elemento. */
export function trocar(el, ...filhos) {
  el.replaceChildren();
  anexar(el, filhos);
  return el;
}

/** Vibração curta de confirmação (Android; o iPhone ignora). */
export function vibrar(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* sem suporte */ }
}

// -----------------------------------------------------------------------------
// Avisos rápidos ("toast") — ex.: "Salvo ✓"
// -----------------------------------------------------------------------------

/**
 * Mostra um aviso na parte de baixo da tela.
 * @param {string} texto
 * @param {{tipo?:'ok'|'aviso'|'erro'|'info', duracao?:number}} [opcoes]
 * @returns {{atualizar:(texto:string, tipo?:string)=>void, fechar:()=>void}}
 */
export function avisar(texto, { tipo = 'info', duracao = 2600 } = {}) {
  let area = document.getElementById('avisos');
  if (!area) {
    area = h('div', { id: 'avisos', 'aria-live': 'polite' });
    document.body.append(area);
  }
  const el = h('div', { class: `aviso aviso-${tipo}`, role: 'status' }, texto);
  area.append(el);
  // No máximo 2 avisos na tela: o mais antigo sai.
  while (area.children.length > 2) area.firstElementChild.remove();

  let timer;
  const fechar = () => {
    clearTimeout(timer);
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 250);
  };
  const agendar = (ms) => { clearTimeout(timer); timer = setTimeout(fechar, ms); };
  agendar(duracao);

  return {
    atualizar(novoTexto, novoTipo = tipo) {
      el.textContent = novoTexto;
      el.className = `aviso aviso-${novoTipo}`;
      agendar(duracao);
    },
    fechar,
  };
}

// -----------------------------------------------------------------------------
// Confirmação ("Tem certeza?")
// -----------------------------------------------------------------------------

/** Pergunta sim/não num diálogo nativo. Resolve true se confirmar. */
export function confirmar(mensagem, { sim = 'Confirmar', nao = 'Cancelar', perigoso = false } = {}) {
  return new Promise((resolve) => {
    const dialogo = h('dialog', { class: 'dialogo' },
      h('p', {}, mensagem),
      h('div', { class: 'dialogo-botoes' },
        h('button', { class: 'btn btn-secundario', onclick: () => fechar(false) }, nao),
        h('button', { class: `btn ${perigoso ? 'btn-perigo' : 'btn-primario'}`, onclick: () => fechar(true) }, sim),
      ),
    );
    const fechar = (resposta) => { dialogo.close(); dialogo.remove(); resolve(resposta); };
    dialogo.addEventListener('cancel', () => fechar(false));
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

// -----------------------------------------------------------------------------
// Diálogo com formulário ("Novo valor a partir de…", "Mover para qual categoria?")
// -----------------------------------------------------------------------------

/**
 * Abre um diálogo com campos e devolve os valores preenchidos (ou null se
 * cancelar).
 * @param {object} p
 * @param {string} p.titulo
 * @param {string} [p.texto]
 * @param {Array<{nome:string, rotulo:string, tipo?:string, valor?:string,
 *                opcoes?:Array<{valor:string, rotulo:string}>, atributos?:object}>} p.campos
 *        tipo: 'text' (padrão), 'month', 'date', 'number', 'select'…
 * @param {string} [p.confirmar='Salvar']
 * @param {(valores:object)=>string|null} [p.validar]  devolve mensagem de erro ou null
 */
export function formularioDialogo({ titulo, texto, campos, confirmar: rotuloOk = 'Salvar', perigoso = false, validar }) {
  return new Promise((resolve) => {
    const entradas = {};
    const erro = h('p', { class: 'mensagem-form', role: 'alert' });
    const linhas = campos.map((c) => {
      const entrada = c.tipo === 'select'
        ? h('select', { class: 'campo', name: c.nome },
          c.opcoes.map((o) => h('option', { value: o.valor, selected: o.valor === c.valor }, o.rotulo)))
        : h('input', { class: 'campo', name: c.nome, type: c.tipo ?? 'text', value: c.valor ?? '', ...(c.atributos ?? {}) });
      entradas[c.nome] = entrada;
      return h('label', { class: 'campo-rotulo' }, h('span', {}, c.rotulo), entrada);
    });

    const dialogo = h('dialog', { class: 'dialogo' },
      h('form', {
        method: 'dialog',
        onsubmit: (e) => {
          e.preventDefault();
          const valores = Object.fromEntries(Object.entries(entradas).map(([k, el]) => [k, el.value]));
          const problema = validar?.(valores);
          if (problema) { erro.textContent = problema; return; }
          fechar(valores);
        },
      },
      h('h3', { class: 'dialogo-titulo' }, titulo),
      texto ? h('p', {}, texto) : null,
      linhas,
      erro,
      h('div', { class: 'dialogo-botoes' },
        h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => fechar(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: `btn ${perigoso ? 'btn-perigo' : 'btn-primario'}` }, rotuloOk))));

    const fechar = (resposta) => { dialogo.close(); dialogo.remove(); resolve(resposta); };
    dialogo.addEventListener('cancel', () => fechar(null));
    document.body.append(dialogo);
    dialogo.showModal();
    Object.values(entradas)[0]?.focus();
  });
}
