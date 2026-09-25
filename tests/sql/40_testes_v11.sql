-- =============================================================================
-- tests/sql/40_testes_v11.sql — v1.1: compra parcelada com juros (preço à vista)
-- Roda depois dos testes anteriores (reaproveita o schema "teste").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

set role authenticated;
select teste.como('renan@teste.com');

select id as cat from categorias where nome = 'Lazer' \gset
insert into cartoes (apelido, bandeira, ultimos4, dia_fechamento, dia_vencimento)
values ('Cartão juros', 'visa', '4321', 5, 12)
returning id as cartao \gset

-- 3x de R$ 400,00 (total R$ 1.200,00) com preço à vista de R$ 1.080,00
select salvar_despesa(jsonb_build_object(
  'id', '61111111-1111-4111-8111-111111111111', 'data_compra', '2026-09-25', 'valor_total_centavos', 120000,
  'categoria_id', :'cat', 'forma_pagamento', 'credito', 'cartao_id', :'cartao', 'qtd_parcelas', 3,
  'valor_a_vista_centavos', 108000),
  '[{"numero":1,"total":3,"valor_centavos":40000,"competencia":"2026-10-01","data_vencimento":"2026-10-12"},
    {"numero":2,"total":3,"valor_centavos":40000,"competencia":"2026-11-01","data_vencimento":"2026-11-12"},
    {"numero":3,"total":3,"valor_centavos":40000,"competencia":"2026-12-01","data_vencimento":"2026-12-12"}]');

select teste.ok((select valor_a_vista_centavos from despesas where id = '61111111-1111-4111-8111-111111111111') = 108000,
                'Preço à vista é gravado pela salvar_despesa()');
select teste.ok((select count(*) = 3 and bool_and(valor_centavos = 40000) from parcelas
                  where despesa_id = '61111111-1111-4111-8111-111111111111'),
                'Parcelas iguais à da loja (3 × R$ 400,00)');

-- Editar sem o campo (ex.: app antigo) limpa o preço à vista; reenviar com ele volta.
select salvar_despesa(jsonb_build_object(
  'id', '61111111-1111-4111-8111-111111111111', 'data_compra', '2026-09-25', 'valor_total_centavos', 120000,
  'categoria_id', :'cat', 'forma_pagamento', 'credito', 'cartao_id', :'cartao', 'qtd_parcelas', 3),
  '[{"numero":1,"total":3,"valor_centavos":40000,"competencia":"2026-10-01","data_vencimento":"2026-10-12"},
    {"numero":2,"total":3,"valor_centavos":40000,"competencia":"2026-11-01","data_vencimento":"2026-11-12"},
    {"numero":3,"total":3,"valor_centavos":40000,"competencia":"2026-12-01","data_vencimento":"2026-12-12"}]');
select teste.ok((select valor_a_vista_centavos is null from despesas where id = '61111111-1111-4111-8111-111111111111'),
                'Edição sem preço à vista deixa o campo vazio (a edição reenvia tudo)');

-- À vista maior que o total é recusado pelo banco
select teste.erro($$select salvar_despesa(jsonb_build_object(
  'id', '62222222-2222-4222-8222-222222222222', 'data_compra', '2026-09-25', 'valor_total_centavos', 50000,
  'categoria_id', '$$ || :'cat' || $$', 'forma_pagamento', 'pix', 'valor_a_vista_centavos', 60000),
  '[{"numero":1,"total":1,"valor_centavos":50000,"competencia":"2026-09-01","data_vencimento":"2026-09-25"}]')$$,
  'Preço à vista maior que o total é recusado');
select teste.erro($$select salvar_despesa(jsonb_build_object(
  'id', '63333333-3333-4333-8333-333333333333', 'data_compra', '2026-09-25', 'valor_total_centavos', 50000,
  'categoria_id', '$$ || :'cat' || $$', 'forma_pagamento', 'pix', 'valor_a_vista_centavos', 0),
  '[{"numero":1,"total":1,"valor_centavos":50000,"competencia":"2026-09-01","data_vencimento":"2026-09-25"}]')$$,
  'Preço à vista zero é recusado');

-- Compra sem preço à vista continua funcionando como antes
select salvar_despesa(jsonb_build_object(
  'id', '64444444-4444-4444-8444-444444444444', 'data_compra', '2026-09-25', 'valor_total_centavos', 9990,
  'categoria_id', :'cat', 'forma_pagamento', 'pix'),
  '[{"numero":1,"total":1,"valor_centavos":9990,"competencia":"2026-09-01","data_vencimento":"2026-09-25"}]');
select teste.ok((select valor_a_vista_centavos is null from despesas where id = '64444444-4444-4444-8444-444444444444'),
                'Compra comum segue sem preço à vista');

reset role;
\echo '==> TESTES DA v1.1 PASSARAM'
