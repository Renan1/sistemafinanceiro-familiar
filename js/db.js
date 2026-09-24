/**
 * =============================================================================
 * js/db.js — Comunicação com o Supabase (login e dados)
 * -----------------------------------------------------------------------------
 * ÚNICO arquivo que conversa com o Supabase. As telas nunca chamam o Supabase
 * direto: chamam as funções daqui. Assim, trocar/ajustar a comunicação mexe
 * num lugar só.
 *
 * A biblioteca supabase-js é carregada por CDN no index.html (variável global
 * `supabase`). A URL e a chave pública vêm de js/config.js, gerado no deploy
 * a partir dos Secrets do GitHub (D-07). A segurança é garantida pelo RLS no
 * banco — esta chave sozinha não dá acesso a nada.
 *
 * Todas as funções devolvem os dados ou lançam um Error com `.tipo`:
 *   'rede'     sem internet / servidor inacessível (tentar de novo depois)
 *   'sessao'   login expirado (precisa entrar de novo)
 *   'recusado' o banco recusou (dado inválido, sem permissão)
 *   'servidor' erro temporário do Supabase (tentar de novo depois)
 * =============================================================================
 */
import { log } from './log.js';
import { gravarCache } from './offline.js';

/** Cliente do Supabase (criado em iniciar()). */
let cliente = null;

/** Cria o cliente com as configurações do projeto. */
export function iniciar(config) {
  if (!globalThis.supabase?.createClient) {
    throw new Error('Biblioteca do Supabase não carregou (sem internet no primeiro acesso?).');
  }
  cliente = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,        // continua logado ao fechar e abrir o app
      autoRefreshToken: true,      // renova o acesso sozinho quando há internet
      detectSessionInUrl: true,    // necessário para o link de "esqueci a senha"
      storageKey: 'financas-auth',
    },
  });
  return cliente;
}

/** Acesso direto ao cliente (use só quando não houver função pronta aqui). */
export const supa = () => cliente;

// =============================================================================
// Tratamento de erros
// =============================================================================

/** Converte o erro do Supabase num Error com `.tipo` (ver cabeçalho). */
export function classificarErro(erro, status) {
  const msg = String(erro?.message ?? erro ?? '');
  const e = new Error(traduzirMensagem(msg));
  e.original = msg;
  e.codigo = erro?.code;
  if (!status || /failed to fetch|load failed|network|fetch/i.test(msg)) e.tipo = 'rede';
  else if (status === 401 || /jwt|PGRST30[0-9]/i.test(`${msg} ${erro?.code}`)) e.tipo = 'sessao';
  else if (status >= 500) e.tipo = 'servidor';
  else e.tipo = 'recusado';
  return e;
}

/** Mensagens do servidor em português, quando reconhecidas. */
function traduzirMensagem(msg) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/row-level security/i.test(msg)) return 'Sem permissão para esta ação (só o dono pode alterar).';
  if (/failed to fetch|load failed|network/i.test(msg)) return 'Sem conexão com a internet.';
  if (/password/i.test(msg) && /weak|short|characters/i.test(msg)) return 'Senha fraca: não atende à política de senha.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.';
  return msg || 'Erro desconhecido.';
}

/** Executa uma consulta do supabase-js e lança erro classificado se falhar. */
async function executar(consulta, descricao) {
  let resposta;
  try {
    resposta = await consulta;
  } catch (e) {
    throw classificarErro(e, 0);
  }
  const { data, error, status } = resposta;
  if (error) {
    const e = classificarErro(error, status);
    log.aviso('db', `${descricao}: ${e.message}`, { tipo: e.tipo, codigo: e.codigo, status });
    throw e;
  }
  return data;
}

// =============================================================================
// Login (e-mail e senha — RF-01)
// =============================================================================

export async function entrar(email, senha) {
  const { data, error, status } = await cliente.auth.signInWithPassword({ email: email.trim(), password: senha })
    .then((r) => ({ ...r, status: r.error?.status ?? 200 }))
    .catch((e) => ({ error: e, status: 0 }));
  if (error) {
    const e = classificarErro(error, status);
    if (e.tipo === 'sessao') e.tipo = 'recusado'; // 401/400 no login = credencial errada
    log.aviso('auth', 'Falha no login', { motivo: e.message });
    throw e;
  }
  log.info('auth', 'Login realizado', { usuario: data.user.id });
  return data.user;
}

export async function sair() {
  await cliente.auth.signOut().catch((e) => log.aviso('auth', 'signOut falhou (seguindo mesmo assim)', e));
  log.info('auth', 'Saiu da conta');
}

/** Envia o e-mail de "esqueci minha senha". O link volta para este app. */
export async function enviarRecuperacaoSenha(email) {
  const destino = `${location.origin}${location.pathname}`;
  const { error } = await cliente.auth.resetPasswordForEmail(email.trim(), { redirectTo: destino });
  if (error) throw classificarErro(error, error.status);
  log.info('auth', 'E-mail de recuperação solicitado');
}

/** Define nova senha (depois de abrir o link de recuperação, já logado). */
export async function definirNovaSenha(senha) {
  const { error } = await cliente.auth.updateUser({ password: senha });
  if (error) throw classificarErro(error, error.status ?? 400);
  log.info('auth', 'Senha alterada');
}

/**
 * Situação do login SEM depender de internet:
 *   'logado'      há sessão guardada no aparelho (mesmo que o acesso tenha
 *                 expirado — será renovado quando houver sinal);
 *   'deslogado'   não há sessão guardada.
 */
export function situacaoLocal() {
  try {
    return localStorage.getItem('financas-auth') ? 'logado' : 'deslogado';
  } catch {
    return 'deslogado';
  }
}

/**
 * Garante um acesso válido antes de enviar dados. Renova se expirou.
 * Lança Error tipo 'sessao' se for preciso entrar de novo, ou 'rede' se
 * não há internet para renovar.
 */
export async function garantirSessao() {
  // Qualquer falha de renovação que não seja de rede significa "entre de novo".
  const erroDeSessao = (err) => {
    const e = classificarErro(err, err.status ?? 0);
    if (e.tipo !== 'rede') e.tipo = 'sessao';
    return e;
  };
  const { data, error } = await cliente.auth.getSession();
  if (error) throw erroDeSessao(error);
  const sessao = data.session;
  if (!sessao) {
    const e = new Error('Entre novamente para enviar os lançamentos.');
    e.tipo = 'sessao';
    throw e;
  }
  // Expira em menos de 1 minuto? Renova antes de usar.
  if ((sessao.expires_at ?? 0) * 1000 - Date.now() < 60_000) {
    const r = await cliente.auth.refreshSession();
    if (r.error) throw erroDeSessao(r.error);
    return r.data.session;
  }
  return sessao;
}

/** Avisa a cada mudança de login (entrou, saiu, renovou, recuperação de senha). */
export function ouvirAuth(fn) {
  return cliente.auth.onAuthStateChange((evento, sessao) => fn(evento, sessao)).data.subscription;
}

/** Usuário atual (a partir da sessão guardada; não usa internet). */
export async function usuarioAtual() {
  const { data } = await cliente.auth.getSession();
  return data.session?.user ?? null;
}

// =============================================================================
// Dados base (perfil, família, categorias, cartões) — guardados no cache
// =============================================================================

/**
 * Baixa os dados que o app precisa para funcionar e guarda no aparelho,
 * para abrir sem internet depois (RNF-13).
 * @returns {{perfil, membros, categorias, cartoes}}
 */
export async function carregarDadosBase(userId) {
  const [membros, categorias, cartoes, recorrencias] = await Promise.all([
    executar(cliente.from('profiles').select('id, nome, cor_identificacao, household_id'), 'Carregar membros'),
    // Todas as categorias (inclusive inativas): lançamentos antigos precisam do nome.
    executar(cliente.from('categorias').select('id, nome, tipo, icone, cor, ativa, ordem')
      .order('ordem').order('nome'), 'Carregar categorias'),
    executar(cliente.from('cartoes').select('id, user_id, apelido, bandeira, ultimos4, dia_fechamento, dia_vencimento, limite_centavos, ativo')
      .order('apelido'), 'Carregar cartões'),
    executar(cliente.from('recorrencias').select('*').order('descricao'), 'Carregar recorrências'),
  ]);

  const perfil = membros.find((m) => m.id === userId);
  if (!perfil) {
    const e = new Error('Seu usuário não está ligado a nenhuma família. Rode o sql/002_bootstrap_familia.sql.');
    e.tipo = 'recusado';
    e.semFamilia = true;
    throw e;
  }

  await Promise.all([
    gravarCache('perfil', perfil),
    gravarCache('membros', membros),
    gravarCache('categorias', categorias),
    gravarCache('cartoes', cartoes),
    gravarCache('recorrencias', recorrencias),
  ]);
  log.info('db', 'Dados base atualizados', { categorias: categorias.length, cartoes: cartoes.length, membros: membros.length });
  return { perfil, membros, categorias, cartoes, recorrencias };
}

// =============================================================================
// Lançamentos (usados pela sincronização — js/sync.js)
// =============================================================================

/** Envia uma despesa com parcelas (RPC atômica e idempotente no banco). */
export function salvarDespesa(dados, parcelas) {
  return executar(cliente.rpc('salvar_despesa', { p_despesa: dados, p_parcelas: parcelas }), 'Salvar despesa');
}

/** Envia uma receita (upsert por id: reenviar não duplica). */
export function salvarReceita(dados) {
  return executar(cliente.from('receitas').upsert(dados, { onConflict: 'id' }).select('id'), 'Salvar receita');
}

/** Lançamentos de um mês (despesas pela data da compra + receitas pela data). */
export async function listarLancamentosDoMes(competencia, proximaCompetencia) {
  const [despesas, receitas] = await Promise.all([
    executar(cliente.from('despesas')
      .select('id, user_id, data_compra, valor_total_centavos, descricao, categoria_id, forma_pagamento, cartao_id, qtd_parcelas, natureza, latitude, longitude, precisao_metros, local_nome, observacao, recorrencia_id, competencia_recorrencia, origem')
      .is('excluido_em', null).gte('data_compra', competencia).lt('data_compra', proximaCompetencia)
      .order('data_compra', { ascending: false }).order('created_at', { ascending: false }), 'Listar despesas'),
    executar(cliente.from('receitas')
      .select('id, user_id, household_id, data, valor_centavos, descricao, categoria_id, natureza, observacao, recorrencia_id, competencia_recorrencia, origem')
      .is('excluido_em', null).gte('data', competencia).lt('data', proximaCompetencia)
      .order('data', { ascending: false }), 'Listar receitas'),
  ]);
  return { despesas, receitas };
}

/** Resumo de conciliação do mês (view vw_resumo_mensal): família + cada pessoa. */
export function resumoDoMes(competencia) {
  return executar(cliente.from('vw_resumo_mensal').select('*').eq('competencia', competencia), 'Resumo do mês');
}

// =============================================================================
// Cartões (cadastro básico — o completo vem na Fase 3)
// =============================================================================

export function criarCartao(cartao) {
  return executar(cliente.from('cartoes').insert(cartao).select().single(), 'Criar cartão');
}

/** Exclui (sem uso) ou arquiva (com histórico). Devolve 'excluido' | 'arquivado'. */
export function excluirCartao(id) {
  return executar(cliente.rpc('excluir_cartao', { p_cartao: id }), 'Excluir cartão');
}

export function atualizarCartao(id, campos) {
  return executar(cliente.from('cartoes').update(campos).eq('id', id).select().single(), 'Atualizar cartão');
}

// =============================================================================
// Recorrências (Fase 3 — RF-30 a RF-32)
// =============================================================================

/**
 * Chaves "recorrenciaId|AAAA-MM-01" dos lançamentos JÁ gerados no servidor,
 * inclusive os excluídos (excluiu, não volta — js/recorrencias.js).
 */
export async function chavesRecorrenciaGeradas(recorrenciaIds) {
  if (recorrenciaIds.length === 0) return new Set();
  const [despesas, receitas] = await Promise.all([
    executar(cliente.from('despesas').select('recorrencia_id, competencia_recorrencia').in('recorrencia_id', recorrenciaIds), 'Recorrências geradas (despesas)'),
    executar(cliente.from('receitas').select('recorrencia_id, competencia_recorrencia').in('recorrencia_id', recorrenciaIds), 'Recorrências geradas (receitas)'),
  ]);
  return new Set([...despesas, ...receitas].map((l) => `${l.recorrencia_id}|${l.competencia_recorrencia}`));
}

export function criarRecorrencia(rec) {
  return executar(cliente.from('recorrencias').insert(rec).select().single(), 'Criar recorrência');
}

/** Pausar/retomar (ativa), encerrar (data_fim) ou corrigir descrição/dia. */
export function atualizarRecorrencia(id, campos) {
  return executar(cliente.from('recorrencias').update(campos).eq('id', id).select().single(), 'Atualizar recorrência');
}

/** Novo valor a partir de um mês, preservando o histórico (RPC do sql/004). */
export function alterarValorRecorrencia(id, aPartir, valorCentavos) {
  return executar(cliente.rpc('alterar_valor_recorrencia', { p_recorrencia: id, p_a_partir: aPartir, p_valor: valorCentavos }), 'Alterar valor da recorrência');
}

/** Exclui a recorrência. Lançamentos já gerados CONTINUAM (perdem só o vínculo). */
export function excluirRecorrencia(id) {
  return executar(cliente.from('recorrencias').delete().eq('id', id), 'Excluir recorrência');
}

// =============================================================================
// Categorias (Fase 3 — RF-52, RF-53)
// =============================================================================

export function criarCategoria(cat) {
  return executar(cliente.from('categorias').insert(cat).select().single(), 'Criar categoria');
}

export function atualizarCategoria(id, campos) {
  return executar(cliente.from('categorias').update(campos).eq('id', id).select().single(), 'Atualizar categoria');
}

/** Exclui; se estiver em uso, `destino` é obrigatório (lançamentos são movidos). */
export function excluirCategoria(id, destino = null) {
  return executar(cliente.rpc('excluir_categoria', { p_categoria: id, p_destino: destino }), 'Excluir categoria');
}

// =============================================================================
// Orçamentos (Fase 3 — RF-55)
// =============================================================================

export function listarOrcamentos() {
  return executar(cliente.from('orcamentos').select('id, categoria_id, user_id, valor_mensal_centavos'), 'Listar orçamentos');
}

/** Cria ou atualiza o orçamento (categoria + pessoa; user_id null = família). */
export function salvarOrcamento({ id, categoria_id, user_id, valor_mensal_centavos }) {
  const consulta = id
    ? cliente.from('orcamentos').update({ valor_mensal_centavos }).eq('id', id).select().single()
    : cliente.from('orcamentos').insert({ categoria_id, user_id, valor_mensal_centavos }).select().single();
  return executar(consulta, 'Salvar orçamento');
}

export function excluirOrcamento(id) {
  return executar(cliente.from('orcamentos').delete().eq('id', id), 'Excluir orçamento');
}

// =============================================================================
// Perfil
// =============================================================================

/** Só nome e cor podem ser alterados (o banco impede o resto). */
export function atualizarPerfil(id, { nome, cor_identificacao }) {
  return executar(cliente.from('profiles').update({ nome, cor_identificacao }).eq('id', id).select().single(), 'Atualizar perfil');
}
