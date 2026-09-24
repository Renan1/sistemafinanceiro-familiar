/**
 * =============================================================================
 * js/ui/perfil.js — Seu perfil: nome, cor e senha
 * -----------------------------------------------------------------------------
 * O nome e a cor identificam você nas listas e gráficos da família.
 * Trocar a senha segue a política de senha (RNF-01). Precisa de internet.
 * =============================================================================
 */
import { h, trocar, avisar } from './dom.js';
import * as db from '../db.js';
import { log } from '../log.js';
import { validarSenha, POLITICA_SENHA } from '../validacao.js';
import { estado, atualizarDoServidor } from '../estado.js';

const CORES = ['#0A84FF', '#FF375F', '#30D158', '#FF9F0A', '#BF5AF2', '#64D2FF', '#FFD60A', '#AC8E68'];

export function montarPerfil(raiz, { navegar }) {
  let cor = estado.perfil.cor_identificacao;
  const nome = h('input', { class: 'campo', value: estado.perfil.nome, maxlength: '60', 'aria-label': 'Nome' });
  const cores = h('div', { class: 'cores', role: 'radiogroup', 'aria-label': 'Cor' });
  const desenharCores = () => trocar(cores, CORES.map((c) => h('button', {
    type: 'button', class: `cor${c === cor ? ' ativa' : ''}`, style: { background: c }, 'aria-label': c,
    onclick: () => { cor = c; desenharCores(); },
  })));
  desenharCores();

  const msgPerfil = h('p', { class: 'mensagem-form', role: 'alert' });
  const formPerfil = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!nome.value.trim()) { msgPerfil.textContent = 'Informe o nome.'; return; }
      try {
        await db.atualizarPerfil(estado.perfil.id, { nome: nome.value.trim(), cor_identificacao: cor });
        await atualizarDoServidor(estado.perfil.id);
        log.info('perfil', 'Perfil atualizado');
        avisar('Perfil salvo ✓', { tipo: 'ok' });
        msgPerfil.textContent = '';
      } catch (erro) {
        msgPerfil.textContent = erro.tipo === 'rede' ? 'Sem internet.' : erro.message;
      }
    },
  }, h('label', { class: 'campo-rotulo' }, 'Nome', nome), h('span', { class: 'campo-rotulo' }, 'Cor'), cores,
  h('button', { type: 'submit', class: 'btn btn-primario' }, 'Salvar perfil'), msgPerfil);

  const senha = h('input', { type: 'password', class: 'campo', placeholder: 'Nova senha', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', class: 'campo', placeholder: 'Repita a nova senha', autocomplete: 'new-password' });
  const msgSenha = h('p', { class: 'mensagem-form', role: 'alert' });
  const formSenha = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      const faltando = validarSenha(senha.value);
      if (faltando.length) { msgSenha.textContent = `A senha precisa ter: ${faltando.join(', ')}.`; return; }
      if (senha.value !== repetir.value) { msgSenha.textContent = 'As senhas não conferem.'; return; }
      try {
        await db.definirNovaSenha(senha.value);
        e.target.reset();
        msgSenha.textContent = '';
        avisar('Senha alterada ✓', { tipo: 'ok' });
      } catch (erro) {
        msgSenha.textContent = erro.tipo === 'rede' ? 'Sem internet.' : erro.message;
      }
    },
  }, senha, repetir,
  h('p', { class: 'dica' }, `Mínimo de ${POLITICA_SENHA.minimo} caracteres, com maiúscula, minúscula, número e caractere especial.`),
  h('button', { type: 'submit', class: 'btn btn-secundario' }, 'Trocar senha'), msgSenha);

  trocar(raiz, h('section', { class: 'tela' },
    h('button', { type: 'button', class: 'link voltar', onclick: () => navegar('#/mais') }, '‹ Mais'),
    formPerfil,
    h('h3', { class: 'rotulo' }, 'Senha'),
    formSenha));
}
