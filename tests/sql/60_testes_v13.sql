-- =============================================================================
-- tests/sql/60_testes_v13.sql — v1.3: importar extrato (regras aprendidas, origens)
-- Roda depois dos testes anteriores (reaproveita o schema "teste").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

set role authenticated;
select teste.como('renan@teste.com');
select id as cat_padaria from categorias where nome = 'Alimentação/Mercado' and tipo = 'despesa' \gset
select id as cat_salario from categorias where nome = 'Salário' \gset

insert into regras_categoria (tipo, padrao, categoria_id) values ('despesa', 'padaria sao jose', :'cat_padaria');
select teste.ok((select household_id = meu_household() from regras_categoria where padrao = 'padaria sao jose'),
                'Regra aprendida entra na família de quem ensinou');
select teste.erro($$insert into regras_categoria (tipo, padrao, categoria_id)
                    values ('despesa', 'padaria sao jose', '$$ || :'cat_padaria' || $$')$$,
                  'A mesma regra não duplica (atualiza em vez de criar outra)');
select teste.erro($$insert into regras_categoria (tipo, padrao, categoria_id)
                    values ('despesa', 'sispag', '$$ || :'cat_salario' || $$')$$,
                  'Regra de gasto não aceita categoria de ganho');

-- Camilla usa (e pode corrigir) o que o Renan ensinou
select teste.como('camilla@teste.com');
select teste.ok((select count(*) from regras_categoria where padrao = 'padaria sao jose') = 1,
                'Camilla vê a regra ensinada pelo Renan');

-- Intruso não vê e não usa categoria de outra família
select teste.como('intruso@teste.com');
select teste.ok((select count(*) from regras_categoria) = 0, 'Intruso não vê as regras da família');
select teste.erro($$insert into regras_categoria (tipo, padrao, categoria_id)
                    values ('despesa', 'xx', '$$ || :'cat_padaria' || $$')$$,
                  'Intruso não cria regra com categoria de outra família');

-- Origem 'importacao_conta' aceita em gastos e ganhos
select teste.como('renan@teste.com');
select salvar_despesa(jsonb_build_object(
  'id', '81111111-1111-4111-8111-111111111111', 'data_compra', '2026-09-05', 'valor_total_centavos', 31960,
  'categoria_id', :'cat_padaria', 'forma_pagamento', 'pix', 'origem', 'importacao_conta', 'local_nome', 'DUBOM MIX'),
  '[{"numero":1,"total":1,"valor_centavos":31960,"competencia":"2026-09-01","data_vencimento":"2026-09-05"}]');
insert into receitas (id, data, valor_centavos, categoria_id, origem)
values ('82222222-2222-4222-8222-222222222222', '2026-09-08', 500000, :'cat_salario', 'importacao_conta');
select teste.ok((select count(*) from despesas where origem = 'importacao_conta') = 1
                and (select count(*) from receitas where origem = 'importacao_conta') = 1,
                'Gasto e ganho com origem "importacao_conta" são aceitos');

reset role;
select teste.ok(not has_table_privilege('anon', 'public.regras_categoria', 'select'), 'Anônimo sem acesso às regras');
\echo '==> TESTES DA v1.3 PASSARAM'
