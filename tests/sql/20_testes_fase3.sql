-- =============================================================================
-- tests/sql/20_testes_fase3.sql — Testes da Fase 3 (recorrências, edição)
-- Roda depois de 10_testes_schema.sql (reaproveita o schema "teste").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

set role authenticated;
select teste.como('renan@teste.com');

select id as cat_salario from categorias where nome = 'Salário' \gset
select id as cat_moradia from categorias where nome = 'Moradia' \gset

-- Salário de R$ 5.000 desde janeiro/2026, gerado em setembro e outubro.
insert into recorrencias (tipo, descricao, valor_centavos, categoria_id, dia_do_mes, data_inicio)
values ('receita', 'Salário empresa', 500000, :'cat_salario', 5, '2026-01-01')
returning id as rec \gset
insert into receitas (data, valor_centavos, categoria_id, natureza, recorrencia_id, competencia_recorrencia, origem)
values ('2026-09-05', 500000, :'cat_salario', 'fixa', :'rec', '2026-09-01', 'recorrencia'),
       ('2026-10-05', 500000, :'cat_salario', 'fixa', :'rec', '2026-10-01', 'recorrencia');

-- Aumento para R$ 5.500 a partir de outubro
select (alterar_valor_recorrencia(:'rec', '2026-10-15', 550000)).id as rec_nova \gset

select teste.ok((select data_fim from recorrencias where id = :'rec') = '2026-09-30',
                'Recorrência antiga termina no último dia do mês anterior');
select teste.ok((select valor_centavos = 550000 and data_inicio = '2026-10-01' and substitui_id = :'rec'::uuid
                   from recorrencias where id = :'rec_nova'),
                'Recorrência nova começa em outubro, com o valor novo e aponta para a antiga');
select teste.ok((select valor_centavos from receitas where competencia_recorrencia = '2026-09-01' and descricao is null
                   and categoria_id = :'cat_salario' and recorrencia_id = :'rec') = 500000,
                'Setembro (antes da mudança) mantém R$ 5.000 na recorrência antiga');
select teste.ok((select valor_centavos = 550000 and recorrencia_id = :'rec_nova'::uuid
                   from receitas where competencia_recorrencia = '2026-10-01' and categoria_id = :'cat_salario'
                    and recorrencia_id in (:'rec', :'rec_nova')),
                'Outubro (já gerado) passa para R$ 5.500 e para a recorrência nova');

-- Aluguel (despesa PIX) desde outubro: alterar desde o início só troca o valor.
insert into recorrencias (tipo, descricao, valor_centavos, categoria_id, forma_pagamento, dia_do_mes, data_inicio)
values ('despesa', 'Aluguel', 200000, :'cat_moradia', 'pix', 10, '2026-10-01')
returning id as rec_aluguel \gset
select salvar_despesa(jsonb_build_object(
  'id', '55555555-5555-4555-8555-555555555555', 'data_compra', '2026-10-10', 'valor_total_centavos', 200000,
  'categoria_id', :'cat_moradia', 'forma_pagamento', 'pix', 'natureza', 'fixa',
  'recorrencia_id', :'rec_aluguel', 'competencia_recorrencia', '2026-10-01', 'origem', 'recorrencia'),
  '[{"numero":1,"total":1,"valor_centavos":200000,"competencia":"2026-10-01","data_vencimento":"2026-10-10"}]');
select alterar_valor_recorrencia(:'rec_aluguel', '2026-10-01', 210000);
select teste.ok((select count(*) from recorrencias where substitui_id = :'rec_aluguel') = 0
                and (select valor_centavos from recorrencias where id = :'rec_aluguel') = 210000,
                'Mudança desde o 1º mês: só troca o valor, sem criar outra recorrência');
select teste.ok((select valor_total_centavos from despesas where id = '55555555-5555-4555-8555-555555555555') = 210000
                and (select valor_centavos from parcelas where despesa_id = '55555555-5555-4555-8555-555555555555') = 210000,
                'Despesa gerada e sua parcela passam para o valor novo (soma continua batendo)');

select teste.erro($$select alterar_valor_recorrencia('$$ || :'rec_aluguel' || $$', '2026-11-01', 0)$$,
  'Valor zero é recusado');

-- Camilla não altera recorrência do Renan
select teste.como('camilla@teste.com');
select teste.erro($$select alterar_valor_recorrencia('$$ || :'rec_aluguel' || $$', '2026-11-01', 1)$$,
  'Camilla não altera recorrência do Renan');

-- Edição: Renan edita a própria receita (upsert pelo mesmo id) sem duplicar
select teste.como('renan@teste.com');
insert into receitas (id, data, valor_centavos, categoria_id)
values ('66666666-6666-4666-8666-666666666666', '2026-09-20', 10000, :'cat_salario')
on conflict (id) do update set valor_centavos = excluded.valor_centavos;
insert into receitas (id, data, valor_centavos, categoria_id)
values ('66666666-6666-4666-8666-666666666666', '2026-09-20', 12000, :'cat_salario')
on conflict (id) do update set valor_centavos = excluded.valor_centavos;
select teste.ok((select count(*) = 1 and max(valor_centavos) = 12000 from receitas
                  where id = '66666666-6666-4666-8666-666666666666'),
                'Editar ganho (upsert pelo mesmo id) atualiza sem duplicar');

reset role;
\echo '==> TESTES DA FASE 3 PASSARAM'
