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
      .select('id, user_id, data_compra, valor_total_centavos, descricao, categoria_id, forma_pagamento, cartao_id, qtd_parcelas, natureza, latitude, longitude, precisao_metros, local_nome, observacao, recorrencia_id, competencia_recorrencia, origem, valor_a_vista_centavos')
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

// =============================================================================
// Painel (Fase 4 — RF-60 a RF-63)
// =============================================================================

/**
 * Tudo o que o Painel precisa para um mês, em 4 consultas paralelas:
 *   resumo    vw_resumo_mensal dos 12 meses até o mês (gráfico de evolução)
 *   parcelas  vw_parcelas_detalhe do mês até +6 (categorias, formas, faturas)
 *   mapa      gastos do mês com localização
 *   orcamentos
 * O RLS garante que só vem o que é da família.
 */
export async function dadosPainel(competencia, { inicio12, fim6, proximaCompetencia }) {
  const [resumo, parcelas, mapa, orcamentos] = await Promise.all([
    executar(cliente.from('vw_resumo_mensal').select('*')
      .gte('competencia', inicio12).lte('competencia', competencia), 'Painel: resumo 12 meses'),
    executar(cliente.from('vw_parcelas_detalhe')
      .select('despesa_id, user_id, competencia, valor_centavos, numero, total, data_compra, categoria_id, categoria_nome, categoria_icone, categoria_cor, forma_pagamento, cartao_id, natureza')
      .gte('competencia', competencia).lte('competencia', fim6), 'Painel: parcelas'),
    executar(cliente.from('despesas')
      .select('id, user_id, data_compra, valor_total_centavos, descricao, local_nome, categoria_id, latitude, longitude')
      .is('excluido_em', null).not('latitude', 'is', null)
      .gte('data_compra', competencia).lt('data_compra', proximaCompetencia), 'Painel: mapa'),
    executar(cliente.from('orcamentos').select('categoria_id, user_id, valor_mensal_centavos'), 'Painel: orçamentos'),
  ]);
  return { resumo, parcelas, mapa, orcamentos };
}

// =============================================================================
// Saúde financeira (Fase 5 — RF-70 a RF-73)
// =============================================================================

/** Dados que o motor de regras precisa: 3 meses antes até 3 meses depois. */
export async function dadosRegras(competencia, { inicio, fim }) {
  const [resumo, parcelas, orcamentos] = await Promise.all([
    executar(cliente.from('vw_resumo_mensal').select('*').gte('competencia', inicio).lte('competencia', competencia), 'Regras: resumo'),
    executar(cliente.from('vw_parcelas_detalhe')
      .select('user_id, competencia, valor_centavos, categoria_id, categoria_nome, forma_pagamento, total, data_compra')
      .gte('competencia', inicio).lte('competencia', fim), 'Regras: parcelas'),
    executar(cliente.from('orcamentos').select('categoria_id, user_id, valor_mensal_centavos'), 'Regras: orçamentos'),
  ]);
  return { resumo, parcelas, orcamentos };
}

/** Troca os alertas do mês de uma vez (sql/005), mantendo os já lidos. */
export function substituirInsights(competencia, insights) {
  return executar(cliente.rpc('substituir_insights', { p_competencia: competencia, p_insights: insights }), 'Gravar alertas');
}

export function listarInsights(competencia) {
  return executar(cliente.from('insights').select('*').eq('competencia', competencia), 'Listar alertas');
}

export function marcarInsightsLidos(ids) {
  return executar(cliente.from('insights').update({ lido: true }).in('id', ids), 'Marcar alertas como lidos');
}

export function listarTarefas() {
  return executar(cliente.from('tarefas').select('*').order('status').order('prioridade').order('criada_em', { ascending: false }), 'Listar tarefas');
}

/**
 * Cria tarefas. Uma por vez: se uma bater no "já existe tarefa aberta desta
 * regra" (índice único), as outras seguem normalmente.
 * @returns {Promise<number>} quantas foram criadas
 */
export async function criarTarefas(tarefas) {
  let criadas = 0;
  for (const t of tarefas) {
    try {
      await executar(cliente.from('tarefas').insert(t), 'Criar tarefa');
      criadas++;
    } catch (e) {
      if (e.codigo !== '23505') throw e; // 23505 = duplicada: ignora
    }
  }
  return criadas;
}

export function atualizarTarefa(id, campos) {
  return executar(cliente.from('tarefas').update(campos).eq('id', id), 'Atualizar tarefa');
}

// =============================================================================
// Carteira do iPhone (v1.2 — RF-16): chaves do atalho e caixa de entrada
// =============================================================================

/** Compras da Carteira ainda não lançadas, da própria pessoa (mais novas primeiro). */
export function listarCaixaPendente(userId) {
  return executar(cliente.from('caixa_entrada')
    .select('id, user_id, recebido_em, valor_centavos, estabelecimento, cartao_nome, status')
    .eq('user_id', userId).eq('status', 'pendente')
    .order('recebido_em', { ascending: false }), 'Caixa de entrada');
}

/** Marca um item da caixa como lançado (com o gasto criado) ou descartado. */
export function marcarCaixa(id, status, despesaId = null) {
  return executar(cliente.from('caixa_entrada').update({ status, despesa_id: despesaId }).eq('id', id), 'Atualizar caixa de entrada');
}

/** Cria uma chave do atalho e devolve o texto dela (só aparece esta vez). */
export function criarAtalho(apelido) {
  return executar(cliente.rpc('criar_atalho', { p_apelido: apelido }), 'Criar chave do atalho');
}

/** Chaves do atalho da própria pessoa (sem o hash, que o app não lê). */
export function listarAtalhos() {
  return executar(cliente.from('atalhos')
    .select('id, apelido, criado_em, ultimo_uso_em, revogado_em')
    .order('criado_em', { ascending: false }), 'Chaves do atalho');
}

/** Revoga uma chave: o atalho que a usa para de funcionar na hora. */
export function revogarAtalho(id) {
  return executar(cliente.from('atalhos').update({ revogado_em: new Date().toISOString() }).eq('id', id), 'Revogar chave do atalho');
}

// =============================================================================
// Importar extrato e fatura (v1.3 — RF-17)
// =============================================================================

/** Regras de categoria aprendidas pela família. */
export function listarRegrasCategoria() {
  return executar(cliente.from('regras_categoria').select('tipo, padrao, categoria_id'), 'Regras de categoria');
}

/** Grava (ou atualiza) regras aprendidas: { tipo, padrao, categoria_id }. */
export function salvarRegrasCategoria(regras, householdId) {
  if (!regras.length) return Promise.resolve([]);
  return executar(cliente.from('regras_categoria')
    .upsert(regras.map((r) => ({ ...r, household_id: householdId })), { onConflict: 'household_id,tipo,padrao' }), 'Salvar regras de categoria');
}

/**
 * O que já existe no app no período do arquivo, para achar duplicados:
 * gastos/ganhos da pessoa e parcelas do cartão (fatura ±1 mês), mais quais
 * ids da importação já estão gravados.
 * @param {object} p { userId, inicio, fim ('AAAA-MM-DD'), cartaoId?, competencia?, ids: string[] }
 */
export async function dadosDeduplicacao({ userId, inicio, fim, cartaoId = null, competencia = null, ids = [] }) {
  const lote = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
  const [despesas, receitas, parcelas, ...existentes] = await Promise.all([
    executar(cliente.from('despesas')
      .select('id, data_compra, valor_total_centavos, forma_pagamento, cartao_id, descricao, local_nome, origem')
      .eq('user_id', userId).is('excluido_em', null).gte('data_compra', inicio).lte('data_compra', fim), 'Importação: gastos do período'),
    executar(cliente.from('receitas').select('id, data, valor_centavos, descricao, origem')
      .eq('user_id', userId).is('excluido_em', null).gte('data', inicio).lte('data', fim), 'Importação: ganhos do período'),
    cartaoId
      ? executar(cliente.from('parcelas').select('despesa_id, competencia, valor_centavos, cartao_id')
        .eq('cartao_id', cartaoId).gte('competencia', somarMesesISO(competencia, -1)).lte('competencia', somarMesesISO(competencia, 1)), 'Importação: parcelas do cartão')
      : Promise.resolve([]),
    ...lote(ids, 150).flatMap((parte) => [
      executar(cliente.from('despesas').select('id').in('id', parte), 'Importação: ids de gastos'),
      executar(cliente.from('receitas').select('id').in('id', parte), 'Importação: ids de ganhos'),
    ]),
  ]);
  // Gastos das parcelas casadas (para mostrar a descrição e a data da compra).
  const faltando = [...new Set(parcelas.map((p) => p.despesa_id))].filter((id) => !despesas.some((d) => d.id === id));
  const extras = faltando.length
    ? (await Promise.all(lote(faltando, 150).map((parte) => executar(cliente.from('despesas')
      .select('id, data_compra, valor_total_centavos, forma_pagamento, cartao_id, descricao, local_nome, origem').in('id', parte), 'Importação: compras das parcelas')))).flat()
    : [];
  return {
    despesas: [...despesas, ...extras],
    receitas,
    parcelas,
    idsExistentes: new Set(existentes.flat().map((r) => r.id)),
  };
}

/** 'AAAA-MM-01' + n meses (auxiliar local). */
function somarMesesISO(competencia, n) {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

// =============================================================================
// Exportação (Fase 5 — RF-80, RF-81)
// =============================================================================

/** Tudo o que vai no JSON do mês para o Claude (js/exportacao.js). */
export async function dadosExportacao(competencia, { inicio6, fim12, proxima }) {
  const noventaDias = new Date(Date.now() - 90 * 864e5).toISOString();
  const [familia, resumo, lancamentos, parcelas, orcamentos, insights, tarefas] = await Promise.all([
    executar(cliente.from('households').select('nome').limit(1).maybeSingle(), 'Export: família'),
    executar(cliente.from('vw_resumo_mensal').select('*').gte('competencia', inicio6).lte('competencia', competencia), 'Export: resumo'),
    listarLancamentosDoMes(competencia, proxima),
    executar(cliente.from('vw_parcelas_detalhe').select('user_id, competencia, valor_centavos, categoria_id, forma_pagamento')
      .gte('competencia', competencia).lte('competencia', fim12), 'Export: parcelas'),
    executar(cliente.from('orcamentos').select('categoria_id, user_id, valor_mensal_centavos'), 'Export: orçamentos'),
    listarInsights(competencia),
    executar(cliente.from('tarefas').select('titulo, descricao, prioridade, status, origem, user_id, concluida_em')
      .or(`status.eq.aberta,concluida_em.gte."${noventaDias}"`), 'Export: tarefas'),
  ]);
  return { familia, resumo, despesas: lancamentos.despesas, receitas: lancamentos.receitas, parcelas, orcamentos, insights, tarefas };
}

/** Backup completo: todas as tabelas da família, paginando de 1.000 em 1.000. */
export async function backupCompleto() {
  const tabelas = ['households', 'profiles', 'categorias', 'cartoes', 'recorrencias', 'despesas', 'parcelas',
    'receitas', 'orcamentos', 'tarefas', 'insights', 'caixa_entrada', 'regras_categoria'];
  const ordem = { caixa_entrada: 'recebido_em' }; // tabelas sem created_at
  // Tabelas das versões 1.x: se o SQL delas ainda não foi rodado, o backup segue sem elas.
  const opcionais = new Set(['caixa_entrada', 'regras_categoria']);
  const resultado = {};
  for (const tabela of tabelas) {
    const linhas = [];
    try {
      for (let de = 0; ; de += 1000) {
        const pagina = await executar(cliente.from(tabela).select('*').order(ordem[tabela] ?? 'created_at').range(de, de + 999), `Backup: ${tabela}`);
        linhas.push(...pagina);
        if (pagina.length < 1000) break;
      }
    } catch (e) {
      if (!opcionais.has(tabela) || e.tipo !== 'recusado') throw e;
      log.aviso('db', `Backup sem a tabela ${tabela} (ainda não criada no banco)`, { motivo: e.message });
    }
    resultado[tabela] = linhas;
  }
  return resultado;
}
