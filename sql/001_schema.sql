-- =============================================================================
-- Finanças da Família — 001_schema.sql
-- -----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO FAZ
--   Cria TODA a estrutura do banco no Supabase (Postgres):
--     1. Funções utilitárias (quem é o usuário logado, qual a família dele…)
--     2. Tabelas com constraints (regras que o banco garante sozinho)
--     3. Gatilhos (triggers): updated_at, preenchimento automático, validação
--        de referências e AUDITORIA de todas as alterações
--     4. Row Level Security (RLS): quem pode ver/alterar o quê
--     5. Funções RPC chamadas pelo app (salvar despesa com parcelas, excluir
--        categoria movendo lançamentos, excluir/arquivar cartão, ping)
--     6. Views para o dashboard
--     7. Seeds: categorias padrão criadas automaticamente para cada família
--
-- COMO RODAR
--   Supabase → SQL Editor → New query → colar este arquivo inteiro → Run.
--   O script é pensado para rodar UMA vez num projeto novo.
--   Passo a passo completo: docs/fase1-supabase.md
--
-- CONVENÇÕES
--   * Valores monetários SEMPRE em centavos (bigint). R$ 10,50 = 1050.
--   * Toda tabela tem created_at e updated_at (updated_at mantido por trigger).
--   * "Competência" = 1º dia do mês ao qual o valor pertence (ex.: 2026-10-01).
--   * Fuso horário de referência: America/Sao_Paulo.
--   * Exclusão de lançamentos é "soft delete" (coluna excluido_em), para manter
--     histórico e permitir sincronização idempotente com o app.
--
-- SEGURANÇA (resumo — detalhes em docs/DECISOES.md)
--   * RLS ligado em TODAS as tabelas. Sem login (papel "anon") nada é visível.
--   * Membro da família VÊ tudo da família, mas só ALTERA o que é seu
--     (despesas, receitas, cartões, recorrências). Categorias, orçamentos,
--     tarefas e insights são da família: ambos podem alterar.
--   * A service_role key NUNCA vai para o app.
--
-- Versão: 0.1.0 (Fase 1)
-- =============================================================================

begin;

-- gen_random_uuid() já vem no Postgres 13+; a extensão garante em qualquer caso.
create extension if not exists pgcrypto;


-- =============================================================================
-- 1. FUNÇÕES UTILITÁRIAS
-- =============================================================================

-- Mês corrente (1º dia) no fuso de São Paulo.
-- Usado em views para separar "passado" de "futuro" (ex.: parcelas a vencer).
create or replace function public.mes_atual()
returns date
language sql
stable
as $$
  select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
$$;
comment on function public.mes_atual() is
  'Primeiro dia do mês corrente no fuso America/Sao_Paulo.';


-- Mantém updated_at sempre atualizado em qualquer UPDATE.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 2. FAMÍLIA E PERFIS
-- =============================================================================

-- Família (household). Hoje: Renan + Camilla. A estrutura já permite outras.
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.households is 'Família: agrupa os membros e todos os dados financeiros.';

-- Perfil do usuário. O id é o MESMO do usuário no Supabase Auth (auth.users).
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  household_id       uuid not null references public.households(id) on delete restrict,
  nome               text not null check (length(trim(nome)) between 1 and 60),
  cor_identificacao  text not null default '#0A84FF'
                     check (cor_identificacao ~ '^#[0-9A-Fa-f]{6}$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.profiles is 'Membro da família. id = auth.users.id.';
create index idx_profiles_household on public.profiles(household_id);


-- Retorna a família do usuário logado.
-- SECURITY DEFINER: roda com permissão do dono para poder ler "profiles" sem
-- cair na própria regra de RLS de profiles (evita recursão infinita).
-- É a peça central de todas as políticas de RLS abaixo.
create or replace function public.meu_household()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.profiles where id = auth.uid();
$$;
comment on function public.meu_household() is
  'household_id do usuário autenticado (NULL se não logado ou sem perfil).';


-- =============================================================================
-- 3. CADASTROS: CATEGORIAS E CARTÕES
-- =============================================================================

-- Categorias de despesa/receita. Pertencem à FAMÍLIA (ambos criam/editam/excluem).
create table public.categorias (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 1 and 40),
  tipo          text not null check (tipo in ('despesa', 'receita')),
  icone         text not null default '📦' check (length(icone) between 1 and 16),
  cor           text not null default '#8E8E93' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativa         boolean not null default true,
  ordem         integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.categorias is
  'Categorias da família. Excluir uma categoria em uso: usar a função excluir_categoria(), que move os lançamentos.';
-- Não permite duas categorias com o mesmo nome (ignorando maiúsculas) e tipo.
create unique index uq_categorias_nome
  on public.categorias(household_id, tipo, lower(trim(nome)));
create index idx_categorias_household on public.categorias(household_id, tipo, ordem);


-- Cartões de crédito. Cada cartão tem DONO (user_id); só o dono altera.
create table public.cartoes (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  apelido          text not null check (length(trim(apelido)) between 1 and 40),
  bandeira         text not null check (bandeira in
                     ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra')),
  ultimos4         text not null check (ultimos4 ~ '^[0-9]{4}$'),
  dia_fechamento   smallint not null check (dia_fechamento between 1 and 31),
  dia_vencimento   smallint not null check (dia_vencimento between 1 and 31),
  limite_centavos  bigint check (limite_centavos is null or limite_centavos > 0),
  ativo            boolean not null default true,  -- false = arquivado
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.cartoes is
  'Cartões de crédito. ativo=false significa ARQUIVADO (tem histórico, não aparece para novos lançamentos).';
comment on column public.cartoes.dia_fechamento is
  'Compra ANTES deste dia entra na fatura que fecha no mês; NO dia ou depois, na do mês seguinte.';
create index idx_cartoes_household on public.cartoes(household_id);


-- =============================================================================
-- 4. RECORRÊNCIAS (gastos/ganhos fixos mensais)
-- =============================================================================
-- Criada antes de despesas/receitas porque elas referenciam recorrencias.id.

create table public.recorrencias (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  tipo             text not null check (tipo in ('despesa', 'receita')),
  descricao        text not null check (length(trim(descricao)) between 1 and 80),
  valor_centavos   bigint not null check (valor_centavos > 0),
  categoria_id     uuid not null references public.categorias(id) on delete restrict,
  forma_pagamento  text check (forma_pagamento in
                     ('pix', 'debito', 'credito', 'dinheiro', 'boleto', 'outro')),
  cartao_id        uuid references public.cartoes(id) on delete restrict,
  dia_do_mes       smallint not null check (dia_do_mes between 1 and 31),
  data_inicio      date not null,
  data_fim         date,
  ativa            boolean not null default true,  -- false = pausada
  -- Histórico de "alterar valor a partir de um mês": a recorrência antiga é
  -- encerrada (data_fim) e uma nova é criada apontando para ela.
  substitui_id     uuid references public.recorrencias(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint ck_rec_periodo check (data_fim is null or data_fim >= data_inicio),
  -- Receita não tem forma de pagamento nem cartão; despesa exige forma.
  constraint ck_rec_forma check (
    (tipo = 'receita' and forma_pagamento is null and cartao_id is null)
    or (tipo = 'despesa' and forma_pagamento is not null)
  ),
  -- Cartão só (e sempre) quando a forma é crédito.
  constraint ck_rec_cartao check (
    tipo = 'receita' or ((forma_pagamento = 'credito') = (cartao_id is not null))
  )
);
comment on table public.recorrencias is
  'Gastos/ganhos fixos mensais. O app gera os lançamentos do mês ao abrir (sem duplicar).';
create index idx_recorrencias_household on public.recorrencias(household_id, tipo);


-- =============================================================================
-- 5. LANÇAMENTOS: DESPESAS, PARCELAS E RECEITAS
-- =============================================================================

-- Despesa (a "compra"). O id é gerado NO CELULAR (crypto.randomUUID()) para que
-- o envio seja idempotente: reenviar o mesmo id atualiza em vez de duplicar.
create table public.despesas (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households(id) on delete cascade,
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  data_compra              date not null,
  valor_total_centavos     bigint not null check (valor_total_centavos > 0),
  descricao                text check (descricao is null or length(descricao) <= 120),
  categoria_id             uuid not null references public.categorias(id) on delete restrict,
  forma_pagamento          text not null check (forma_pagamento in
                             ('pix', 'debito', 'credito', 'dinheiro', 'boleto', 'outro')),
  cartao_id                uuid references public.cartoes(id) on delete restrict,
  qtd_parcelas             smallint not null default 1 check (qtd_parcelas between 1 and 24),
  natureza                 text not null default 'variavel' check (natureza in ('fixa', 'variavel')),
  recorrencia_id           uuid references public.recorrencias(id) on delete set null,
  -- Mês (1º dia) que a recorrência gerou. Junto com recorrencia_id impede duplicar.
  competencia_recorrencia  date check (competencia_recorrencia is null
                             or extract(day from competencia_recorrencia) = 1),
  latitude                 numeric(9, 6) check (latitude between -90 and 90),
  longitude                numeric(9, 6) check (longitude between -180 and 180),
  precisao_metros          numeric(8, 1) check (precisao_metros >= 0),
  local_nome               text check (local_nome is null or length(local_nome) <= 80),
  origem                   text not null default 'manual'
                             check (origem in ('manual', 'recorrencia', 'importacao_fatura')),
  observacao               text check (observacao is null or length(observacao) <= 500),
  excluido_em              timestamptz,  -- soft delete
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Cartão é obrigatório no crédito e proibido nas demais formas.
  constraint ck_desp_cartao check ((forma_pagamento = 'credito') = (cartao_id is not null)),
  -- Parcelamento só existe no crédito.
  constraint ck_desp_parcelas check (forma_pagamento = 'credito' or qtd_parcelas = 1),
  -- Latitude e longitude andam juntas.
  constraint ck_desp_geo check ((latitude is null) = (longitude is null))
);
comment on table public.despesas is
  'Compras/gastos. Os valores por mês são lidos da tabela parcelas (fonte única do dashboard).';
create index idx_despesas_household_data on public.despesas(household_id, data_compra desc)
  where excluido_em is null;
create index idx_despesas_user on public.despesas(user_id);
create index idx_despesas_categoria on public.despesas(categoria_id);
create unique index uq_despesas_recorrencia
  on public.despesas(recorrencia_id, competencia_recorrencia)
  where recorrencia_id is not null;


-- Parcelas: TODA despesa tem ao menos 1 parcela (à vista = 1 parcela no mês da
-- compra). O dashboard soma SEMPRE daqui, pela competência.
create table public.parcelas (
  id               uuid primary key default gen_random_uuid(),
  despesa_id       uuid not null references public.despesas(id) on delete cascade,
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  numero           smallint not null check (numero >= 1),
  total            smallint not null check (total between 1 and 24),
  valor_centavos   bigint not null check (valor_centavos > 0),
  competencia      date not null check (extract(day from competencia) = 1),
  data_vencimento  date not null,
  cartao_id        uuid references public.cartoes(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint ck_parc_numero check (numero <= total),
  constraint uq_parcela unique (despesa_id, numero)
);
comment on table public.parcelas is
  'Parcelas geradas pelo app (função JS calcularParcelas) e gravadas pela RPC salvar_despesa().';
create index idx_parcelas_household_comp on public.parcelas(household_id, competencia);
create index idx_parcelas_despesa on public.parcelas(despesa_id);


-- Receitas (ganhos). Mesmo esquema de id gerado no cliente e soft delete.
create table public.receitas (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households(id) on delete cascade,
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  data                     date not null,
  valor_centavos           bigint not null check (valor_centavos > 0),
  categoria_id             uuid not null references public.categorias(id) on delete restrict,
  descricao                text check (descricao is null or length(descricao) <= 120),
  natureza                 text not null default 'variavel' check (natureza in ('fixa', 'variavel')),
  recorrencia_id           uuid references public.recorrencias(id) on delete set null,
  competencia_recorrencia  date check (competencia_recorrencia is null
                             or extract(day from competencia_recorrencia) = 1),
  origem                   text not null default 'manual'
                             check (origem in ('manual', 'recorrencia', 'importacao_fatura')),
  observacao               text check (observacao is null or length(observacao) <= 500),
  excluido_em              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
comment on table public.receitas is 'Ganhos (salário, pró-labore, aluguel…). Competência = mês da data.';
create index idx_receitas_household_data on public.receitas(household_id, data desc)
  where excluido_em is null;
create index idx_receitas_categoria on public.receitas(categoria_id);
create unique index uq_receitas_recorrencia
  on public.receitas(recorrencia_id, competencia_recorrencia)
  where recorrencia_id is not null;


-- =============================================================================
-- 6. PLANEJAMENTO E SAÚDE FINANCEIRA
-- =============================================================================

-- Orçamento mensal por categoria. user_id NULL = orçamento da família.
create table public.orcamentos (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  categoria_id           uuid not null references public.categorias(id) on delete cascade,
  user_id                uuid references public.profiles(id) on delete cascade,
  valor_mensal_centavos  bigint not null check (valor_mensal_centavos > 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Um orçamento por categoria/pessoa (NULLS NOT DISTINCT: só 1 "familiar").
  constraint uq_orcamento unique nulls not distinct (household_id, categoria_id, user_id)
);
comment on table public.orcamentos is 'Limite mensal por categoria. user_id NULL = orçamento familiar.';


-- Tarefas de melhoria da saúde financeira.
create table public.tarefas (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,  -- NULL = família
  titulo        text not null check (length(trim(titulo)) between 1 and 120),
  descricao     text check (descricao is null or length(descricao) <= 1000),
  origem        text not null default 'manual' check (origem in ('regra', 'claude', 'manual')),
  regra_codigo  text,
  prioridade    smallint not null default 2 check (prioridade between 1 and 3), -- 1=alta
  status        text not null default 'aberta' check (status in ('aberta', 'feita', 'descartada')),
  criada_em     timestamptz not null default now(),
  concluida_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.tarefas is 'Tarefas geradas por regra, pela Skill do Claude ou manualmente.';
create index idx_tarefas_household on public.tarefas(household_id, status);
-- Não deixa a mesma regra abrir duas tarefas ao mesmo tempo (para a mesma pessoa).
create unique index uq_tarefas_regra_aberta
  on public.tarefas(household_id, regra_codigo, user_id) nulls not distinct
  where status = 'aberta' and regra_codigo is not null;


-- Insights (alertas) gerados pelo motor de regras.
create table public.insights (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,  -- NULL = família
  competencia   date not null check (extract(day from competencia) = 1),
  regra_codigo  text not null,
  severidade    text not null check (severidade in ('info', 'atencao', 'critico')),
  mensagem      text not null,
  dados         jsonb not null default '{}'::jsonb,
  lido          boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Reavaliar a regra no mesmo mês atualiza o insight em vez de duplicar.
  constraint uq_insight unique nulls not distinct (household_id, competencia, regra_codigo, user_id)
);
comment on table public.insights is 'Alertas do motor de regras (js/regras.js), um por regra/mês/visão.';


-- =============================================================================
-- 7. AUDITORIA (log de alterações no banco)
-- =============================================================================

create table public.auditoria (
  id            bigint generated always as identity primary key,
  household_id  uuid,
  user_id       uuid,           -- quem fez a alteração (auth.uid())
  tabela        text not null,
  registro_id   uuid,
  operacao      text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  dados_antes   jsonb,
  dados_depois  jsonb,
  criado_em     timestamptz not null default now()
);
comment on table public.auditoria is
  'Registro automático de toda criação/alteração/exclusão. Somente leitura para os usuários.';
create index idx_auditoria_household on public.auditoria(household_id, criado_em desc);

-- Grava uma linha de auditoria. SECURITY DEFINER porque os usuários não têm
-- permissão de escrever na tabela auditoria diretamente.
create or replace function public.tg_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linha jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.auditoria (household_id, user_id, tabela, registro_id, operacao,
                                dados_antes, dados_depois)
  values ((v_linha ->> 'household_id')::uuid,
          auth.uid(),
          tg_table_name,
          (v_linha ->> 'id')::uuid,
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;  -- trigger AFTER: o retorno é ignorado
end;
$$;


-- =============================================================================
-- 8. GATILHOS DE PREENCHIMENTO E VALIDAÇÃO
-- =============================================================================

-- Preenche household_id e user_id com os do usuário logado quando o app não
-- enviar. (As políticas de RLS depois conferem que são mesmo os dele.)
create or replace function public.tg_preencher_dono()
returns trigger
language plpgsql
as $$
begin
  if new.household_id is null then
    new.household_id := public.meu_household();
  end if;
  -- Só tabelas cujo dono é obrigatório (user_id NOT NULL) recebem auth.uid().
  -- (IFs aninhados de propósito: o Postgres não garante a ordem de avaliação
  --  do AND, e new.user_id não existe nas tabelas "sem_usuario".)
  if tg_argv[0] = 'com_usuario' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
  end if;
  return new;
end;
$$;


-- Garante que categoria, cartão e recorrência referenciados são da MESMA
-- família do lançamento (sem isso, alguém que soubesse um UUID de outra
-- família poderia apontar para ele). Também confere o tipo da categoria.
create or replace function public.tg_validar_referencias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo_esperado text;
  j jsonb := to_jsonb(new);
begin
  -- Tipo de categoria esperado para cada tabela.
  v_tipo_esperado := case tg_table_name
    when 'despesas' then 'despesa'
    when 'receitas' then 'receita'
    when 'recorrencias' then j ->> 'tipo'   -- recorrência de despesa usa categoria de despesa
    else null end;

  if j ? 'categoria_id' and (j ->> 'categoria_id') is not null then
    if not exists (select 1 from public.categorias c
                   where c.id = (j ->> 'categoria_id')::uuid
                     and c.household_id = (j ->> 'household_id')::uuid
                     and (v_tipo_esperado is null or c.tipo = v_tipo_esperado)) then
      raise exception 'Categoria inválida para este lançamento (outra família ou tipo errado).'
        using errcode = '23503';
    end if;
  end if;

  if j ? 'cartao_id' and (j ->> 'cartao_id') is not null then
    if not exists (select 1 from public.cartoes k
                   where k.id = (j ->> 'cartao_id')::uuid
                     and k.household_id = (j ->> 'household_id')::uuid) then
      raise exception 'Cartão inválido (não pertence à família).' using errcode = '23503';
    end if;
  end if;

  if j ? 'recorrencia_id' and (j ->> 'recorrencia_id') is not null then
    if not exists (select 1 from public.recorrencias r
                   where r.id = (j ->> 'recorrencia_id')::uuid
                     and r.household_id = (j ->> 'household_id')::uuid) then
      raise exception 'Recorrência inválida (não pertence à família).' using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

-- Seeds: ao criar uma família, cria as categorias padrão.
create or replace function public.criar_categorias_padrao(p_household uuid)
returns void
language sql
as $$
  insert into public.categorias (household_id, nome, tipo, icone, cor, ordem) values
    -- Despesas
    (p_household, 'Alimentação/Mercado',      'despesa', '🛒', '#34C759', 10),
    (p_household, 'Restaurante/Delivery',     'despesa', '🍔', '#FF9500', 20),
    (p_household, 'Transporte/Combustível',   'despesa', '⛽', '#5856D6', 30),
    (p_household, 'Moradia',                  'despesa', '🏠', '#AF52DE', 40),
    (p_household, 'Contas',                   'despesa', '💡', '#FFCC00', 50),
    (p_household, 'Saúde',                    'despesa', '💊', '#FF2D55', 60),
    (p_household, 'Educação',                 'despesa', '📚', '#007AFF', 70),
    (p_household, 'Lazer',                    'despesa', '🎉', '#FF6482', 80),
    (p_household, 'Vestuário',                'despesa', '👕', '#64D2FF', 90),
    (p_household, 'Assinaturas',              'despesa', '📺', '#BF5AF2', 100),
    (p_household, 'Pets',                     'despesa', '🐾', '#A2845E', 110),
    (p_household, 'Presentes',                'despesa', '🎁', '#FF375F', 120),
    (p_household, 'Manutenção',               'despesa', '🔧', '#8E8E93', 130),
    (p_household, 'Impostos/Taxas',           'despesa', '🧾', '#636366', 140),
    (p_household, 'Outros',                   'despesa', '📦', '#AEAEB2', 999),
    -- Receitas
    (p_household, 'Salário',                  'receita', '💼', '#30D158', 10),
    (p_household, 'Pró-labore',               'receita', '🏢', '#32ADE6', 20),
    (p_household, 'Aluguel',                  'receita', '🏘️', '#FFD60A', 30),
    (p_household, 'Freelance/Serviços',       'receita', '🧑‍💻', '#0A84FF', 40),
    (p_household, 'Rendimentos/Investimentos','receita', '📈', '#66D4CF', 50),
    (p_household, 'Reembolso',                'receita', '↩️', '#AC8E68', 60),
    (p_household, 'Outros',                   'receita', '💰', '#AEAEB2', 999);
$$;

create or replace function public.tg_household_seeds()
returns trigger
language plpgsql
as $$
begin
  perform public.criar_categorias_padrao(new.id);
  return null;
end;
$$;


-- ---- Aplicação dos gatilhos -------------------------------------------------

create trigger trg_household_seeds after insert on public.households
  for each row execute function public.tg_household_seeds();

-- updated_at em todas as tabelas que têm a coluna
do $$
declare t text;
begin
  foreach t in array array['households','profiles','categorias','cartoes','recorrencias',
                           'despesas','parcelas','receitas','orcamentos','tarefas','insights']
  loop
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- Preenchimento automático de household_id / user_id
do $$
declare t text;
begin
  foreach t in array array['cartoes','recorrencias','despesas','receitas'] loop
    execute format('create trigger trg_%1$s_dono before insert on public.%1$I
                    for each row execute function public.tg_preencher_dono(''com_usuario'')', t);
  end loop;
  foreach t in array array['categorias','orcamentos','tarefas','insights'] loop
    execute format('create trigger trg_%1$s_dono before insert on public.%1$I
                    for each row execute function public.tg_preencher_dono(''sem_usuario'')', t);
  end loop;
end $$;

-- Validação de referências entre famílias
do $$
declare t text;
begin
  foreach t in array array['recorrencias','despesas','receitas','parcelas','orcamentos'] loop
    execute format('create trigger trg_%1$s_refs before insert or update on public.%1$I
                    for each row execute function public.tg_validar_referencias()', t);
  end loop;
end $$;

-- Auditoria (parcelas fica de fora: é derivada da despesa, que já é auditada)
do $$
declare t text;
begin
  foreach t in array array['households','profiles','categorias','cartoes','recorrencias',
                           'despesas','receitas','orcamentos','tarefas'] loop
    execute format('create trigger trg_%1$s_auditoria after insert or update or delete
                    on public.%1$I for each row execute function public.tg_auditoria()', t);
  end loop;
end $$;


-- =============================================================================
-- 9. ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Regra de ouro: sem política = sem acesso. Todas as políticas são "to
-- authenticated": quem não está logado (anon) não vê NADA.

alter table public.households   enable row level security;
alter table public.profiles     enable row level security;
alter table public.categorias   enable row level security;
alter table public.cartoes      enable row level security;
alter table public.recorrencias enable row level security;
alter table public.despesas     enable row level security;
alter table public.parcelas     enable row level security;
alter table public.receitas     enable row level security;
alter table public.orcamentos   enable row level security;
alter table public.tarefas      enable row level security;
alter table public.insights     enable row level security;
alter table public.auditoria    enable row level security;

-- households: ver e renomear a própria família.
create policy households_select on public.households for select to authenticated
  using (id = public.meu_household());
create policy households_update on public.households for update to authenticated
  using (id = public.meu_household()) with check (id = public.meu_household());

-- profiles: ver os membros da família; editar só o próprio (nome/cor —
-- ver GRANTs abaixo, que impedem mudar household_id).
create policy profiles_select on public.profiles for select to authenticated
  using (household_id = public.meu_household());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Tabelas DA FAMÍLIA: qualquer membro faz tudo (dentro da própria família).
do $$
declare t text;
begin
  foreach t in array array['categorias','orcamentos','tarefas','insights'] loop
    execute format($f$
      create policy %1$s_familia on public.%1$I for all to authenticated
        using (household_id = public.meu_household())
        with check (household_id = public.meu_household())$f$, t);
  end loop;
end $$;

-- Tabelas COM DONO: todos da família veem; só o dono insere/altera/exclui.
do $$
declare t text;
begin
  foreach t in array array['cartoes','recorrencias','despesas','receitas','parcelas'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using (household_id = public.meu_household())$f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (household_id = public.meu_household() and user_id = auth.uid())$f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I for update to authenticated
        using (household_id = public.meu_household() and user_id = auth.uid())
        with check (household_id = public.meu_household() and user_id = auth.uid())$f$, t);
  end loop;
  -- DELETE físico só onde faz sentido. Despesas/receitas usam soft delete.
  foreach t in array array['cartoes','recorrencias','parcelas'] loop
    execute format($f$
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using (household_id = public.meu_household() and user_id = auth.uid())$f$, t);
  end loop;
end $$;

-- auditoria: somente leitura, só da própria família.
create policy auditoria_select on public.auditoria for select to authenticated
  using (household_id = public.meu_household());


-- =============================================================================
-- 10. FUNÇÕES RPC (chamadas pelo app via supabase.rpc(...))
-- =============================================================================

-- -----------------------------------------------------------------------------
-- salvar_despesa(p_despesa, p_parcelas)
--   Grava (cria OU atualiza) uma despesa e SUBSTITUI todas as suas parcelas,
--   tudo numa única transação. É idempotente: chamar 2x com o mesmo conteúdo
--   dá o mesmo resultado — essencial para a fila offline do app.
--
--   * As parcelas são calculadas no app pela função JS calcularParcelas()
--     (uma única fonte da regra de fechamento/vencimento, com testes).
--     Aqui o banco CONFERE: quantidade = qtd_parcelas, numeração 1..N,
--     soma = valor total, competência no dia 1.
--   * Se p_despesa.excluido_em vier preenchido, é uma exclusão: marca a
--     despesa como excluída e remove as parcelas (p_parcelas é ignorado).
--   * SECURITY INVOKER: roda com as permissões do usuário, então o RLS
--     garante que ninguém altera despesa de outra pessoa.
-- -----------------------------------------------------------------------------
create or replace function public.salvar_despesa(p_despesa jsonb, p_parcelas jsonb default '[]'::jsonb)
returns public.despesas
language plpgsql
security invoker
set search_path = public
as $$
declare
  d        public.despesas;
  v_qtd    int;
  v_soma   bigint;
  v_ok_num boolean;
begin
  -- Converte o JSON para o tipo da tabela; household/user vêm SEMPRE da sessão.
  d := jsonb_populate_record(null::public.despesas, p_despesa);
  if d.id is null then
    raise exception 'A despesa precisa de um id (gerado no app).' using errcode = '22023';
  end if;
  d.household_id := public.meu_household();
  d.user_id      := auth.uid();
  d.qtd_parcelas := coalesce(d.qtd_parcelas, 1);
  if d.household_id is null then
    raise exception 'Usuário sem família associada.' using errcode = '42501';
  end if;

  -- Validação das parcelas (exceto em exclusão).
  if d.excluido_em is null then
    select count(*), coalesce(sum((p ->> 'valor_centavos')::bigint), 0),
           bool_and((p ->> 'total')::int = d.qtd_parcelas)
             and count(distinct (p ->> 'numero')::int) = count(*)
             and min((p ->> 'numero')::int) = 1
             and max((p ->> 'numero')::int) = count(*)
      into v_qtd, v_soma, v_ok_num
      from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) as p;

    if v_qtd <> d.qtd_parcelas or not coalesce(v_ok_num, false) then
      raise exception 'Parcelas inconsistentes: esperado % parcela(s) numeradas 1..%.',
        d.qtd_parcelas, d.qtd_parcelas using errcode = '22023';
    end if;
    if v_soma <> d.valor_total_centavos then
      raise exception 'Soma das parcelas (%) difere do valor total (%).',
        v_soma, d.valor_total_centavos using errcode = '22023';
    end if;
  end if;

  -- Upsert da despesa. Em conflito de id, só atualiza se for do próprio
  -- usuário (a política de UPDATE do RLS barra os demais com erro).
  insert into public.despesas as t (
    id, household_id, user_id, data_compra, valor_total_centavos, descricao,
    categoria_id, forma_pagamento, cartao_id, qtd_parcelas, natureza,
    recorrencia_id, competencia_recorrencia, latitude, longitude,
    precisao_metros, local_nome, origem, observacao, excluido_em)
  values (
    d.id, d.household_id, d.user_id, d.data_compra, d.valor_total_centavos, d.descricao,
    d.categoria_id, d.forma_pagamento, d.cartao_id, d.qtd_parcelas, coalesce(d.natureza, 'variavel'),
    d.recorrencia_id, d.competencia_recorrencia, d.latitude, d.longitude,
    d.precisao_metros, d.local_nome, coalesce(d.origem, 'manual'), d.observacao, d.excluido_em)
  on conflict (id) do update set
    data_compra             = excluded.data_compra,
    valor_total_centavos    = excluded.valor_total_centavos,
    descricao               = excluded.descricao,
    categoria_id            = excluded.categoria_id,
    forma_pagamento         = excluded.forma_pagamento,
    cartao_id               = excluded.cartao_id,
    qtd_parcelas            = excluded.qtd_parcelas,
    natureza                = excluded.natureza,
    recorrencia_id          = excluded.recorrencia_id,
    competencia_recorrencia = excluded.competencia_recorrencia,
    latitude                = excluded.latitude,
    longitude               = excluded.longitude,
    precisao_metros         = excluded.precisao_metros,
    local_nome              = excluded.local_nome,
    origem                  = excluded.origem,
    observacao              = excluded.observacao,
    excluido_em             = excluded.excluido_em
  returning t.* into d;

  -- Substitui as parcelas (editar = regenerar todas; excluir = remover todas).
  delete from public.parcelas where despesa_id = d.id;

  if d.excluido_em is null then
    insert into public.parcelas (despesa_id, household_id, user_id, numero, total,
                                 valor_centavos, competencia, data_vencimento, cartao_id)
    select d.id, d.household_id, d.user_id,
           (p ->> 'numero')::smallint,
           (p ->> 'total')::smallint,
           (p ->> 'valor_centavos')::bigint,
           (p ->> 'competencia')::date,
           (p ->> 'data_vencimento')::date,
           d.cartao_id
      from jsonb_array_elements(p_parcelas) as p;
  end if;

  return d;
end;
$$;
comment on function public.salvar_despesa(jsonb, jsonb) is
  'Cria/atualiza/exclui (soft) uma despesa e regenera as parcelas de forma atômica e idempotente.';


-- -----------------------------------------------------------------------------
-- excluir_categoria(p_categoria, p_destino)
--   Exclui uma categoria. Se houver lançamentos/recorrências usando-a, eles
--   são MOVIDOS para p_destino (obrigatório nesse caso). Orçamentos da
--   categoria excluída são removidos.
--   SECURITY DEFINER porque mover lançamentos de TODOS os membros é uma ação
--   da família (o RLS normal só deixa alterar os próprios). As verificações
--   de família são feitas manualmente abaixo.
-- -----------------------------------------------------------------------------
create or replace function public.excluir_categoria(p_categoria uuid, p_destino uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh    uuid := public.meu_household();
  v_tipo  text;
  v_em_uso boolean;
begin
  select tipo into v_tipo from public.categorias
   where id = p_categoria and household_id = v_hh;
  if v_tipo is null then
    raise exception 'Categoria não encontrada.' using errcode = 'P0002';
  end if;

  v_em_uso := exists (select 1 from public.despesas     where categoria_id = p_categoria)
           or exists (select 1 from public.receitas     where categoria_id = p_categoria)
           or exists (select 1 from public.recorrencias where categoria_id = p_categoria);

  if v_em_uso then
    if p_destino is null or p_destino = p_categoria then
      raise exception 'Categoria em uso: informe outra categoria para onde mover os lançamentos.'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.categorias
                    where id = p_destino and household_id = v_hh and tipo = v_tipo) then
      raise exception 'Categoria de destino inválida (precisa ser da família e do mesmo tipo).'
        using errcode = '22023';
    end if;
    update public.despesas     set categoria_id = p_destino where categoria_id = p_categoria;
    update public.receitas     set categoria_id = p_destino where categoria_id = p_categoria;
    update public.recorrencias set categoria_id = p_destino where categoria_id = p_categoria;
  end if;

  delete from public.categorias where id = p_categoria;  -- orçamentos caem por cascade
end;
$$;
comment on function public.excluir_categoria(uuid, uuid) is
  'Exclui categoria movendo lançamentos para outra (obrigatório se em uso).';


-- -----------------------------------------------------------------------------
-- excluir_cartao(p_cartao) → 'excluido' | 'arquivado'
--   Sem compras/recorrências: apaga de vez. Com histórico: arquiva (ativo=false)
--   para não quebrar faturas passadas. Só o dono pode (RLS).
-- -----------------------------------------------------------------------------
create or replace function public.excluir_cartao(p_cartao uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.cartoes where id = p_cartao and user_id = auth.uid()) then
    raise exception 'Cartão não encontrado ou não é seu.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.despesas     where cartao_id = p_cartao)
  or exists (select 1 from public.recorrencias where cartao_id = p_cartao) then
    update public.cartoes set ativo = false where id = p_cartao;
    return 'arquivado';
  end if;

  delete from public.cartoes where id = p_cartao;
  return 'excluido';
end;
$$;


-- -----------------------------------------------------------------------------
-- ping() — usado pelo GitHub Actions a cada 3 dias para o Supabase gratuito
-- não pausar o projeto por inatividade. Não lê nem expõe dado nenhum.
-- -----------------------------------------------------------------------------
create or replace function public.ping()
returns text
language sql
stable
as $$ select 'ok ' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') $$;


-- =============================================================================
-- 11. VIEWS DO DASHBOARD
-- =============================================================================
-- security_invoker = true → a view respeita o RLS de quem consulta
-- (sem isso, a view rodaria com a permissão do dono e vazaria dados).
-- Em todas as views de resumo: user_id NULL = linha da FAMÍLIA (soma de todos).

-- Parcelas "vivas" com os dados da despesa e da categoria. Base de tudo.
create view public.vw_parcelas_detalhe with (security_invoker = true) as
select p.id              as parcela_id,
       p.despesa_id,
       p.household_id,
       p.user_id,
       p.competencia,
       p.data_vencimento,
       p.numero,
       p.total,
       p.valor_centavos,
       d.data_compra,
       d.descricao,
       d.categoria_id,
       c.nome            as categoria_nome,
       c.icone           as categoria_icone,
       c.cor             as categoria_cor,
       d.forma_pagamento,
       p.cartao_id,
       d.natureza,
       d.origem
  from public.parcelas p
  join public.despesas d   on d.id = p.despesa_id and d.excluido_em is null
  join public.categorias c on c.id = d.categoria_id;


-- Resumo mensal (conciliação): receitas, despesas, saldo, taxa de poupança,
-- % de fixos, por pessoa e para a família.
create view public.vw_resumo_mensal with (security_invoker = true) as
with desp as (
  select household_id, user_id, competencia,
         sum(valor_centavos)                                          as despesas,
         sum(valor_centavos) filter (where natureza = 'fixa')         as despesas_fixas,
         sum(valor_centavos) filter (where forma_pagamento = 'credito') as despesas_cartao
    from public.vw_parcelas_detalhe
   group by household_id, user_id, competencia
),
rec as (
  select household_id, user_id, date_trunc('month', data)::date as competencia,
         sum(valor_centavos)                                  as receitas,
         sum(valor_centavos) filter (where natureza = 'fixa') as receitas_fixas
    from public.receitas
   where excluido_em is null
   group by household_id, user_id, date_trunc('month', data)::date
),
por_usuario as (
  select household_id, user_id, competencia,
         coalesce(r.receitas, 0)         as receitas_centavos,
         coalesce(r.receitas_fixas, 0)   as receitas_fixas_centavos,
         coalesce(d.despesas, 0)         as despesas_centavos,
         coalesce(d.despesas_fixas, 0)   as despesas_fixas_centavos,
         coalesce(d.despesas_cartao, 0)  as despesas_cartao_centavos
    from desp d
    full join rec r using (household_id, user_id, competencia)
),
com_familia as (
  select household_id, user_id, competencia, receitas_centavos, receitas_fixas_centavos,
         despesas_centavos, despesas_fixas_centavos, despesas_cartao_centavos
    from por_usuario
  union all
  select household_id, null::uuid, competencia,
         sum(receitas_centavos), sum(receitas_fixas_centavos), sum(despesas_centavos),
         sum(despesas_fixas_centavos), sum(despesas_cartao_centavos)
    from por_usuario
   group by household_id, competencia
)
select household_id,
       user_id,                                   -- NULL = família
       competencia,
       receitas_centavos::bigint,
       receitas_fixas_centavos::bigint,
       despesas_centavos::bigint,
       despesas_fixas_centavos::bigint,
       (despesas_centavos - despesas_fixas_centavos)::bigint    as despesas_variaveis_centavos,
       despesas_cartao_centavos::bigint,
       (receitas_centavos - despesas_centavos)::bigint          as saldo_centavos,
       -- Percentuais só fazem sentido com receita > 0 (senão NULL).
       round(100.0 * (receitas_centavos - despesas_centavos) / nullif(receitas_centavos, 0), 1)
                                                                as taxa_poupanca_pct,
       round(100.0 * despesas_fixas_centavos / nullif(receitas_centavos, 0), 1)
                                                                as fixos_sobre_renda_pct
  from com_familia;


-- Gastos por categoria e mês (pessoa + família).
create view public.vw_gastos_categoria_mes with (security_invoker = true) as
select household_id, user_id, competencia, categoria_id, categoria_nome,
       categoria_icone, categoria_cor,
       sum(valor_centavos)::bigint as total_centavos,
       count(distinct despesa_id)  as qtd_lancamentos
  from public.vw_parcelas_detalhe
 group by grouping sets (
   (household_id, user_id, competencia, categoria_id, categoria_nome, categoria_icone, categoria_cor),
   (household_id,          competencia, categoria_id, categoria_nome, categoria_icone, categoria_cor)
 );


-- Comprometimento futuro: parcelas de cartão a vencer (meses após o atual).
create view public.vw_comprometimento_futuro with (security_invoker = true) as
select household_id, user_id, competencia, cartao_id,
       sum(valor_centavos)::bigint as total_centavos,
       count(*)                    as qtd_parcelas
  from public.vw_parcelas_detalhe
 where forma_pagamento = 'credito'
   and competencia > public.mes_atual()
 group by grouping sets (
   (household_id, user_id, competencia, cartao_id),
   (household_id, user_id, competencia),
   (household_id,          competencia)
 );
comment on view public.vw_comprometimento_futuro is
  'Parcelas de cartão a vencer. cartao_id NULL = total do mês; user_id NULL e cartao_id NULL = família.';


-- =============================================================================
-- 12. PERMISSÕES (GRANTs) — segunda camada de proteção além do RLS
-- =============================================================================
-- Fica no FINAL do arquivo para valer para todas as tabelas, views e funções
-- criadas acima.
-- O Supabase concede tudo a "anon" e "authenticated" por padrão. Retiramos TUDO
-- do anon: mesmo que alguém crie uma política errada no futuro, quem não está
-- logado continua sem acesso.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Tabelas que o usuário NÃO escreve diretamente:
revoke insert, update, delete on public.auditoria  from authenticated;
revoke insert, delete         on public.households from authenticated;
revoke insert, delete         on public.profiles   from authenticated;
-- Em profiles, só nome e cor podem ser alterados (household_id e id, nunca).
revoke update on public.profiles from authenticated;
grant  update (nome, cor_identificacao) on public.profiles to authenticated;
-- Funções internas de gatilho não precisam ser chamáveis pelo app.
revoke execute on function public.tg_auditoria()           from authenticated;
revoke execute on function public.tg_validar_referencias() from authenticated;
revoke execute on function public.criar_categorias_padrao(uuid) from authenticated;


-- Única exceção para quem não está logado: o ping do "mantenha acordado".
grant execute on function public.ping() to anon;

commit;

-- Fim. Próximo passo: sql/002_bootstrap_familia.sql (criar a família e ligar os usuários).
