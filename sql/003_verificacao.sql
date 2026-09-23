-- =============================================================================
-- Finanças da Família — 003_verificacao.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Confere se a instalação ficou segura. Só LÊ, não altera nada.
--   Rode no SQL Editor depois do 001 e do 002. Todas as linhas devem vir "OK".
-- =============================================================================

with tabelas as (
  select c.relname as tabela, c.relrowsecurity as rls_ligado,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) as politicas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
)
select 'RLS: ' || tabela as verificacao,
       case when rls_ligado and politicas > 0 then 'OK'
            else 'FALHA: RLS desligado ou sem política' end as resultado
  from tabelas

union all
-- O papel "anon" (quem não fez login) não pode ter NENHUM acesso às tabelas.
select 'Anon sem acesso às tabelas',
       case when count(*) = 0 then 'OK'
            else 'FALHA: anon tem privilégio em ' || string_agg(distinct table_name, ', ') end
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'

union all
-- Views precisam respeitar o RLS de quem consulta.
select 'View segura: ' || c.relname,
       case when coalesce(c.reloptions::text, '') like '%security_invoker=true%' then 'OK'
            else 'FALHA: view sem security_invoker' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'

union all
select 'Família e membros',
       case when (select count(*) from public.profiles) >= 2 then 'OK'
            else 'PENDENTE: rode o 002_bootstrap_familia.sql' end

order by 1;
