/**
 * =============================================================================
 * js/ui/atalho.js — Mais → Atalho do iPhone (v1.2 — RF-16)
 * -----------------------------------------------------------------------------
 * Configura a automação do app Atalhos que manda cada compra paga com a
 * Carteira (aproximação) para a caixa de entrada do app:
 *   1. criar a CHAVE deste iPhone (aparece UMA vez — o banco guarda só o hash);
 *   2. copiar o endereço, a chave pública do app e a chave pessoal para o
 *      Atalho;
 *   3. seguir o passo a passo (também em docs/melhorias-v1.md).
 * Também lista as chaves (último uso) e permite REVOGAR (ex.: trocou de
 * celular) — o atalho que usa a chave para de funcionar na hora.
 *
 * O endereço e a chave pública vêm do js/config.js (a mesma chave pública que
 * o app já usa; sozinha, ela não dá acesso a nada — D-09).
 * =============================================================================
 */
import { h, trocar, avisar, confirmar, formularioDialogo } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { dataHoraBR } from '../formato.js';
import { estado } from '../estado.js';

/** Copia um texto (com alternativa para navegadores sem clipboard). */
async function copiar(texto, rotulo) {
  try {
    await navigator.clipboard.writeText(texto);
    avisar(`${rotulo} copiado ✓`, { tipo: 'ok' });
  } catch {
    avisar('Não deu para copiar automaticamente: toque e segure no texto para copiar.', { tipo: 'aviso', duracao: 4000 });
  }
}

/** Linha "rótulo + texto + Copiar". */
function campoCopiar(rotulo, texto, { secreto = false } = {}) {
  return h('div', { class: 'campo-copiar' },
    h('span', { class: 'rotulo-campo' }, rotulo),
    h('code', { class: `texto-copiar${secreto ? ' secreto' : ''}` }, texto),
    h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => copiar(texto, rotulo) }, 'Copiar'));
}

export function montarAtalho(raiz, { navegar, config }) {
  const url = `${String(config?.supabaseUrl ?? '').replace(/\/+$/, '')}/rest/v1/rpc/registrar_compra_atalho`;
  const areaChaveNova = h('div');
  const lista = h('div', { class: 'lista' });

  async function carregar() {
    try {
      const chaves = await db.listarAtalhos();
      trocar(lista, chaves.length ? chaves.map((c) => h('div', { class: `item${c.revogado_em ? ' revogada' : ''}` },
        h('div', { class: 'item-texto' },
          h('strong', {}, c.apelido),
          h('small', {}, c.revogado_em
            ? `revogada em ${dataHoraBR(c.revogado_em)}`
            : `criada em ${dataHoraBR(c.criado_em)} · ${c.ultimo_uso_em ? `último uso ${dataHoraBR(c.ultimo_uso_em)}` : 'ainda não usada'}`)),
        c.revogado_em ? null : h('button', { type: 'button', class: 'link perigo', onclick: () => revogar(c) }, 'Revogar')))
        : h('p', { class: 'vazio' }, 'Nenhuma chave ainda.'));
    } catch (e) {
      log.aviso('atalho', 'Não foi possível listar as chaves', e);
      trocar(lista, h('p', { class: 'vazio' }, navigator.onLine ? `Não foi possível carregar: ${e.message}` : 'Sem internet.'));
    }
  }

  async function criar() {
    const valores = await formularioDialogo({
      titulo: 'Nova chave do atalho',
      texto: 'Dê um nome para reconhecer depois (ex.: o aparelho).',
      campos: [{ nome: 'apelido', rotulo: 'Nome', valor: `iPhone ${estado.perfil?.nome ?? ''}`.trim(), atributos: { maxlength: '40' } }],
      confirmar: 'Criar chave',
      validar: (v) => (v.apelido.trim() ? null : 'Dê um nome à chave.'),
    });
    if (!valores) return;
    try {
      const chave = await db.criarAtalho(valores.apelido.trim());
      log.info('atalho', 'Chave do atalho criada', { apelido: valores.apelido.trim() });
      trocar(areaChaveNova, h('div', { class: 'secao destaque' },
        h('h3', { class: 'secao-titulo' }, '🔑 Sua chave (anote agora)'),
        h('p', { class: 'secao-sub' }, 'Ela aparece só esta vez. Copie e cole no Atalho (campo p_token). Se perder, revogue e crie outra.'),
        campoCopiar('Chave pessoal', chave, { secreto: true })));
      carregar();
    } catch (e) {
      avisar(e.message, { tipo: 'erro' });
    }
  }

  async function revogar(c) {
    if (!(await confirmar(`Revogar a chave "${c.apelido}"? O atalho que usa esta chave para de funcionar na hora.`,
      { sim: 'Revogar', perigoso: true }))) return;
    try {
      await db.revogarAtalho(c.id);
      log.info('atalho', 'Chave do atalho revogada', { id: c.id });
      avisar('Chave revogada', { tipo: 'ok' });
      carregar();
    } catch (e) {
      avisar(e.message, { tipo: 'erro' });
    }
  }

  const passo = (n, ...conteudo) => h('li', {}, h('strong', {}, `${n}. `), ...conteudo);

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '📲 Compras da Carteira direto no app'),
      h('p', { class: 'secao-sub' },
        'Toda vez que você pagar aproximando o iPhone ou o relógio, o app Atalhos manda o valor, o lugar e o cartão para a sua ',
        h('button', { type: 'button', class: 'link inline', onclick: () => navegar('#/caixa') }, 'caixa de entrada'),
        '. Depois é só tocar, conferir a categoria e salvar. Não pega compras com o cartão físico nem PIX.')),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '1. Chave deste iPhone'),
      h('p', { class: 'secao-sub' }, 'Cada pessoa cria a própria chave, no próprio iPhone. A chave só consegue colocar compras na SUA caixa de entrada: não lê nenhum dado.'),
      h('button', { type: 'button', class: 'btn btn-primario', onclick: criar }, 'Criar chave'),
      areaChaveNova),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '2. Dados para o Atalho'),
      campoCopiar('Endereço (URL)', url),
      campoCopiar('apikey (chave pública do app)', String(config?.supabaseAnonKey ?? ''))),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, '3. Montar a automação (uma vez)'),
      h('ol', { class: 'passos' },
        passo(1, 'Abra o app ', h('strong', {}, 'Atalhos'), ' → aba ', h('strong', {}, 'Automação'), ' → ', h('strong', {}, '+'), ' (Nova Automação).'),
        passo(2, 'Escolha ', h('strong', {}, 'Transação'), ' (Carteira). Marque os cartões e, em categorias, deixe todas. Escolha ', h('strong', {}, 'Executar Imediatamente'), ' → Seguinte.'),
        passo(3, h('strong', {}, 'Nova Ação em Branco'), ' → adicione a ação ', h('strong', {}, 'Obter Conteúdo da URL'), ' e cole o ', h('strong', {}, 'Endereço'), '.'),
        passo(4, 'Toque na setinha da ação: Método ', h('strong', {}, 'POST'), '. Em ', h('strong', {}, 'Cabeçalhos'), ', adicione ', h('code', {}, 'apikey'), ' = a chave pública do app.'),
        passo(5, 'Em ', h('strong', {}, 'Corpo da Solicitação'), ' escolha ', h('strong', {}, 'JSON'), ' e adicione 4 campos de texto:',
          h('ul', {},
            h('li', {}, h('code', {}, 'p_token'), ' = sua chave pessoal'),
            h('li', {}, h('code', {}, 'p_valor'), ' = Entrada do Atalho → ', h('em', {}, 'Valor')),
            h('li', {}, h('code', {}, 'p_estabelecimento'), ' = Entrada do Atalho → ', h('em', {}, 'Comerciante')),
            h('li', {}, h('code', {}, 'p_cartao'), ' = Entrada do Atalho → ', h('em', {}, 'Cartão ou Tiquete'))),
          h('p', { class: 'dica' }, 'Para inserir: toque no campo do valor → na faixa acima do teclado toque em "Entrada do Atalho" → toque no botão azul que entrou no campo → escolha o item. (Em alguns iOS: "Quantia" e "Cartão ou Passe". Não use "Nome".)')),
        passo(6, 'Concluir. Faça uma compra de teste: ela aparece na caixa de entrada em segundos.')),
      h('p', { class: 'dica' }, 'Os nomes podem variar um pouco conforme a versão do iOS (precisa do iOS 17 ou mais novo). Guia com mais detalhes: docs/melhorias-v1.md.')),

    h('div', { class: 'secao' },
      h('h3', { class: 'secao-titulo' }, 'Suas chaves'),
      h('p', { class: 'secao-sub' }, 'Trocou de celular ou desconfia que a chave vazou? Revogue e crie outra.'),
      lista)));
  carregar();
}
