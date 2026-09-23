-- =============================================================================
-- tests/sql/00_stub_supabase.sql
-- -----------------------------------------------------------------------------
-- Simula o mínimo do Supabase num Postgres "puro", para rodarmos os testes
-- do schema localmente e no GitHub Actions (CI), sem tocar no banco real.
--
--   * papéis anon / authenticated / service_role
--   * schema auth com a tabela users e a função auth.uid()
--   * privilégios padrão iguais aos do Supabase (tudo liberado para anon e
--     authenticated — é o 001_schema.sql que precisa fechar isso)
--
-- NÃO rode este arquivo no Supabase de verdade.
-- =============================================================================

-- Papéis são globais no servidor: só cria se ainda não existirem.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique not null
);

-- Mesma lógica do Supabase: o id do usuário vem do JWT (claim "sub").
create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
