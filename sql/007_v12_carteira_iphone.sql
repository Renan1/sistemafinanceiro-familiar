-- =============================================================================
-- Finanças da Família — 007_v13_carteira_iphone.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ (v1.2 — RF-16)
--   Compras pagas com a CARTEIRA do iPhone chegam sozinhas ao app:
--     1. uma automação do app Atalhos ("Transação") dispara a cada pagamento
--        por aproximação e chama registrar_compra_atalho() com valor,
--        estabelecimento e cartão;
--     2. a compra entra na CAIXA DE ENTRADA (tabela caixa_entrada) da pessoa;
--     3. no app, a pessoa toca na compra, escolhe a categoria e salva.
--
-- SEGURANÇA (o sistema continua fechado)
--   * Cada pessoa cria no app uma CHAVE do atalho (tabela atalhos). O banco
--     guarda só o HASH (SHA-256) da chave: nem quem lê o banco a recupera.
--   * registrar_compra_atalho() é a ÚNICA função nova liberada para quem não
--     está logado. Ela só INSERE na caixa de entrada de quem é dono da chave
--     e responde "ok" — não devolve nenhum dado.
--   * Chave errada ou revogada → recusada. Máximo de 30 envios por hora por
--     chave. A chave pode ser revogada a qualquer momento (Mais → Atalho).
--   * Ninguém consegue ler a coluna token_hash pelo app.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só (pode rodar
--   de novo sem problema). ANTES do merge da v1.2.
--
-- Versão: 1.2.0
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chaves do atalho (uma por aparelho/pessoa)
-- -----------------------------------------------------------------------------
create table if not exists public.atalhos (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  apelido        text not null check (length(trim(apelido)) between 1 and 40),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em      timestamptz not null default now(),
  ultimo_uso_em  timestamptz,
  revogado_em    timestamptz
);
comment on table public.atalhos is
  'Chaves do Atalho do iPhone (v1.2). Guarda só o hash SHA-256 da chave.';

-- -----------------------------------------------------------------------------
-- 2. Caixa de entrada: compras recebidas do atalho, aguardando lançamento
-- -----------------------------------------------------------------------------
create table if not exists public.caixa_entrada (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  atalho_id        uuid references public.atalhos(id) on delete set null,
  recebido_em      timestamptz not null default now(),
  valor_centavos   bigint not null check (valor_centavos > 0 and valor_centavos <= 100000000),
  estabelecimento  text check (estabelecimento is null or length(estabelecimento) <= 120),
  cartao_nome      text check (cartao_nome is null or length(cartao_nome) <= 80),
  status           text not null default 'pendente' check (status in ('pendente', 'lancado', 'descartado')),
  despesa_id       uuid references public.despesas(id) on delete set null,
  updated_at       timestamptz not null default now()
);
comment on table public.caixa_entrada is
  'Compras da Carteira do iPhone recebidas pelo atalho (v1.2), até virarem gasto.';
create index if not exists idx_caixa_pendentes
  on public.caixa_entrada(user_id, recebido_em desc) where status = 'pendente';

drop trigger if exists trg_caixa_entrada_updated_at on public.caixa_entrada;
create trigger trg_caixa_entrada_updated_at before update on public.caixa_entrada
  for each row execute function public.tg_set_updated_at();

-- Gasto lançado a partir da caixa fica marcado com a origem.
alter table public.despesas drop constraint if exists despesas_origem_check;
alter table public.despesas add constraint despesas_origem_check
  check (origem in ('manual', 'recorrencia', 'importacao_fatura', 'carteira_iphone'));

-- -----------------------------------------------------------------------------
-- 3. RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.atalhos       enable row level security;
alter table public.caixa_entrada enable row level security;

-- Atalhos: cada um vê e revoga só as PRÓPRIAS chaves. Criar só pela função.
drop policy if exists atalhos_select on public.atalhos;
drop policy if exists atalhos_update on public.atalhos;
drop policy if exists atalhos_delete on public.atalhos;
create policy atalhos_select on public.atalhos for select to authenticated
  using (user_id = auth.uid());
create policy atalhos_update on public.atalhos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy atalhos_delete on public.atalhos for delete to authenticated
  using (user_id = auth.uid());

-- Caixa de entrada: a família vê; só o dono muda o status ou apaga.
-- Inserir só pela função registrar_compra_atalho().
drop policy if exists caixa_select on public.caixa_entrada;
drop policy if exists caixa_update on public.caixa_entrada;
drop policy if exists caixa_delete on public.caixa_entrada;
create policy caixa_select on public.caixa_entrada for select to authenticated
  using (household_id = public.meu_household());
create policy caixa_update on public.caixa_entrada for update to authenticated
  using (household_id = public.meu_household() and user_id = auth.uid())
  with check (household_id = public.meu_household() and user_id = auth.uid());
create policy caixa_delete on public.caixa_entrada for delete to authenticated
  using (household_id = public.meu_household() and user_id = auth.uid());

revoke all on public.atalhos, public.caixa_entrada from anon, authenticated;
-- token_hash fica de fora do SELECT: ninguém o lê pelo app.
grant select (id, apelido, criado_em, ultimo_uso_em, revogado_em) on public.atalhos to authenticated;
grant update (apelido, revogado_em) on public.atalhos to authenticated;
grant delete on public.atalhos to authenticated;
grant select on public.caixa_entrada to authenticated;
grant update (status, despesa_id) on public.caixa_entrada to authenticated;
grant delete on public.caixa_entrada to authenticated;


-- -----------------------------------------------------------------------------
-- 4. valor_texto_centavos(): "R$ 1.234,56" / "1234.56" / "12,3" → centavos
--    O atalho manda o valor como texto, no formato do iPhone. Regra: o ÚLTIMO
--    separador (, ou .) seguido de 1 ou 2 dígitos é o decimal; os demais são
--    separadores de milhar.
-- -----------------------------------------------------------------------------
create or replace function public.valor_texto_centavos(p_texto text)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  t        text := regexp_replace(coalesce(p_texto, ''), '[^0-9,.]', '', 'g');
  m        text[];
  inteiro  text;
  decimais text := '00';
begin
  if t !~ '[0-9]' then
    return null;
  end if;
  m := regexp_match(t, '^(.*)[.,]([0-9]{1,2})$');
  if m is not null then
    inteiro  := m[1];
    decimais := rpad(m[2], 2, '0');
  else
    inteiro := t;
  end if;
  inteiro := regexp_replace(inteiro, '[^0-9]', '', 'g');
  if length(inteiro) > 12 then
    return null;
  end if;
  return coalesce(nullif(inteiro, '')::bigint, 0) * 100 + decimais::bigint;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. criar_atalho(apelido) → devolve a CHAVE (mostrada uma única vez no app)
-- -----------------------------------------------------------------------------
create or replace function public.criar_atalho(p_apelido text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh    uuid := public.meu_household();
  v_chave text;
begin
  if auth.uid() is null or v_hh is null then
    raise exception 'Entre no app para criar a chave.' using errcode = '42501';
  end if;
  if (select count(*) from public.atalhos where user_id = auth.uid() and revogado_em is null) >= 5 then
    raise exception 'Você já tem 5 chaves ativas. Revogue uma antes de criar outra.' using errcode = '22023';
  end if;
  -- 2 UUIDs aleatórios (gerador criptográfico do Postgres) ≈ 244 bits.
  v_chave := 'ff_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.atalhos (household_id, user_id, apelido, token_hash)
  values (v_hh, auth.uid(), left(trim(coalesce(nullif(trim(p_apelido), ''), 'iPhone')), 40),
          encode(sha256(convert_to(v_chave, 'UTF8')), 'hex'));
  return v_chave;
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. registrar_compra_atalho() — chamada PELO ATALHO (sem login, com a chave)
-- -----------------------------------------------------------------------------
create or replace function public.registrar_compra_atalho(
  p_token           text,
  p_valor           text,
  p_estabelecimento text default null,
  p_cartao          text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a      public.atalhos;
  v_val  bigint;
begin
  if p_token is null or length(p_token) not between 20 and 200 then
    raise exception 'Chave inválida.' using errcode = '28000';
  end if;
  select * into a from public.atalhos
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and revogado_em is null;
  if a.id is null then
    raise exception 'Chave inválida ou revogada.' using errcode = '28000';
  end if;

  if (select count(*) from public.caixa_entrada
       where atalho_id = a.id and recebido_em > now() - interval '1 hour') >= 30 then
    raise exception 'Limite de 30 compras por hora atingido.' using errcode = '54000';
  end if;

  v_val := public.valor_texto_centavos(p_valor);
  if v_val is null or v_val <= 0 or v_val > 100000000 then
    raise exception 'Valor inválido: "%".', left(coalesce(p_valor, ''), 30) using errcode = '22023';
  end if;

  insert into public.caixa_entrada (household_id, user_id, atalho_id, valor_centavos, estabelecimento, cartao_nome)
  values (a.household_id, a.user_id, a.id, v_val,
          nullif(left(trim(p_estabelecimento), 120), ''),
          nullif(left(trim(p_cartao), 80), ''));

  update public.atalhos set ultimo_uso_em = now() where id = a.id;
  return 'ok';
end;
$$;

-- Funções: criar_atalho só logado; registrar_compra_atalho também sem login.
revoke execute on function public.valor_texto_centavos(text) from anon, public;
revoke execute on function public.criar_atalho(text) from anon, public;
revoke execute on function public.registrar_compra_atalho(text, text, text, text) from public;
grant  execute on function public.valor_texto_centavos(text) to authenticated;
grant  execute on function public.criar_atalho(text) to authenticated;
grant  execute on function public.registrar_compra_atalho(text, text, text, text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 7. Conferência (só leitura): tudo deve vir "OK"
-- -----------------------------------------------------------------------------
select 'v1.2: funções liberadas sem login' as verificacao,
       case when array_agg(p.proname order by p.proname) = array['ping', 'registrar_compra_atalho']::name[]
            then 'OK' else 'FALHA: ' || array_to_string(array_agg(p.proname order by p.proname), ', ') end as resultado
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
union all
select 'v1.2: anon sem acesso às tabelas novas',
       case when not has_table_privilege('anon', 'public.atalhos', 'select')
             and not has_table_privilege('anon', 'public.caixa_entrada', 'select')
            then 'OK' else 'FALHA' end
union all
select 'v1.2: RLS ligado nas tabelas novas',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.atalhos'::regclass, 'public.caixa_entrada'::regclass))
            then 'OK' else 'FALHA' end;
