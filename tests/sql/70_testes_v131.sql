-- =============================================================================
-- tests/sql/70_testes_v131.sql — v1.3.1: categoria Financiamentos
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

set role authenticated;
select teste.como('renan@teste.com');
select teste.ok((select count(*) from categorias where nome = 'Financiamentos' and tipo = 'despesa') = 1,
                'Família existente ganha a categoria Financiamentos (uma só)');
select teste.como('intruso@teste.com');
select teste.ok((select count(*) from categorias where nome = 'Financiamentos') = 1,
                'Cada família tem a sua (o intruso vê só a da família dele)');

reset role;
-- Família nova já nasce com Financiamentos
insert into public.households (nome) values ('Família Nova Teste') returning id as hh_nova \gset
select teste.ok((select count(*) from public.categorias where household_id = :'hh_nova' and nome = 'Financiamentos') = 1,
                'Família nova já nasce com Financiamentos');
\echo '==> TESTES DA v1.3.1 PASSARAM'
