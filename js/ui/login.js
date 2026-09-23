/**
 * =============================================================================
 * js/ui/login.js — Telas de login, "esqueci minha senha" e nova senha (RF-01)
 * -----------------------------------------------------------------------------
 * Login por e-mail + senha (sem magic link: no iPhone o link abriria o Safari,
 * fora do app instalado). Não há "criar conta": as contas são criadas no
 * painel do Supabase (D-08).
 * =============================================================================
 */
import { h, trocar, avisar } from './dom.js';
import * as db from '../db.js';
import { validarEmail, validarSenha, POLITICA_SENHA } from '../validacao.js';

/**
 * Tela de login.
 * @param {HTMLElement} raiz
 * @param {{aoEntrar:(user)=>void, pendentes?:number}} opcoes
 */
export function montarLogin(raiz, { aoEntrar, pendentes = 0 }) {
  const email = h('input', { type: 'email', class: 'campo', placeholder: 'E-mail', autocomplete: 'username', inputmode: 'email', required: true });
  const senha = h('input', { type: 'password', class: 'campo', placeholder: 'Senha', autocomplete: 'current-password', required: true });
  const botao = h('button', { type: 'submit', class: 'btn btn-primario' }, 'Entrar');
  const mensagem = h('p', { class: 'mensagem-form', role: 'alert' });

  const form = h('form', {
    class: 'form-login',
    onsubmit: async (e) => {
      e.preventDefault();
      mensagem.textContent = '';
      const problemas = validarEmail(email.value);
      if (problemas.length || !senha.value) { mensagem.textContent = 'Preencha e-mail e senha.'; return; }
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      try {
        const user = await db.entrar(email.value, senha.value);
        senha.value = '';
        aoEntrar(user);
      } catch (erro) {
        mensagem.textContent = erro.tipo === 'rede'
          ? 'Sem internet. O primeiro login precisa de conexão.'
          : erro.message;
      } finally {
        botao.disabled = false;
        botao.textContent = 'Entrar';
      }
    },
  }, email, senha, botao, mensagem);

  const esqueci = h('button', {
    type: 'button', class: 'link',
    onclick: async () => {
      if (validarEmail(email.value).length) { mensagem.textContent = 'Digite seu e-mail acima e toque de novo em "Esqueci minha senha".'; return; }
      try {
        await db.enviarRecuperacaoSenha(email.value);
        avisar('Se o e-mail estiver cadastrado, você receberá um link para criar nova senha.', { tipo: 'ok', duracao: 6000 });
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    },
  }, 'Esqueci minha senha');

  trocar(raiz, h('section', { class: 'tela-login' },
    h('div', { class: 'marca' },
      h('img', { src: 'icons/icon.svg', alt: '', width: 72, height: 72 }),
      h('h1', {}, 'Finanças da Família')),
    pendentes > 0
      ? h('p', { class: 'alerta-inline' }, `Você tem ${pendentes} lançamento(s) guardado(s) neste aparelho. Entre para enviá-los — nada foi perdido.`)
      : null,
    form,
    esqueci,
  ));
  email.focus();
}

/**
 * Tela "Criar nova senha" — aparece ao abrir o link de recuperação do e-mail.
 */
export function montarNovaSenha(raiz, { aoConcluir }) {
  const senha = h('input', { type: 'password', class: 'campo', placeholder: 'Nova senha', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', class: 'campo', placeholder: 'Repita a nova senha', autocomplete: 'new-password' });
  const requisitos = h('ul', { class: 'requisitos' });
  const mensagem = h('p', { class: 'mensagem-form', role: 'alert' });

  const mostrarRequisitos = () => {
    const faltando = validarSenha(senha.value);
    const todos = [`mínimo de ${POLITICA_SENHA.minimo} caracteres`, ...POLITICA_SENHA.regras.map((r) => r.texto)];
    trocar(requisitos, todos.map((t) => h('li', { class: faltando.includes(t) ? '' : 'ok' }, t)));
  };
  senha.addEventListener('input', mostrarRequisitos);
  mostrarRequisitos();

  const form = h('form', {
    class: 'form-login',
    onsubmit: async (e) => {
      e.preventDefault();
      const faltando = validarSenha(senha.value);
      if (faltando.length) { mensagem.textContent = `A senha precisa ter: ${faltando.join(', ')}.`; return; }
      if (senha.value !== repetir.value) { mensagem.textContent = 'As senhas não conferem.'; return; }
      try {
        await db.definirNovaSenha(senha.value);
        avisar('Senha alterada ✓', { tipo: 'ok' });
        aoConcluir();
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    },
  }, senha, repetir, requisitos, h('button', { type: 'submit', class: 'btn btn-primario' }, 'Salvar nova senha'), mensagem);

  trocar(raiz, h('section', { class: 'tela-login' }, h('h1', {}, 'Criar nova senha'), form));
  senha.focus();
}
