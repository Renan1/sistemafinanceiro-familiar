-- =============================================================================
-- tests/sql/10_testes_schema.sql
-- -----------------------------------------------------------------------------
-- Testes automáticos do banco: segurança (RLS), regras de negócio e
-- constraints. Rodados por tests/sql/rodar_testes.sh (local ou GitHub Actions).
--
-- Cenário:
--   * Renan e Camilla na "Família Martins" (criados pelo 002_bootstrap).
--   * Intruso em OUTRA família — não pode enxergar nada dos Martins.
--   * Anônimo (sem login) — não pode enxergar nada de ninguém.
--
-- Qualquer falha interrompe o script com "FALHOU: <descrição>".
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
-- Esconde as tabelinhas de resultado; só as mensagens "ok - ..." aparecem.
\o /dev/null

-- ---------------------------------------------------------------------------
-- Ferramentas de teste
-- ---------------------------------------------------------------------------
create schema teste;
grant usage on schema teste to anon, authenticated;

-- Afirma que a condição é verdadeira.
create function teste.ok(p_cond boolean, p_desc text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALHOU: %', p_desc;
  end if;
  raise notice 'ok  - %', p_desc;
end $$;

-- Afirma que o comando SQL dá erro (ex.: bloqueado por RLS ou constraint).
create function teste.erro(p_sql text, p_desc text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU (deveria dar erro): %', p_desc;
exception
  when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice 'ok  - % [erro esperado: %]', p_desc, sqlerrm;
  when others then
    raise notice 'ok  - % [erro esperado: %]', p_desc, sqlerrm;
end $$;

-- "Faz login" como o usuário do e-mail (simula o JWT do Supabase).
create function teste.como(p_email text) returns void
language plpgsql security definer as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_id, 'role', 'authenticated')::text, false);
end $$;

grant execute on all functions in schema teste to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Preparação: família do intruso (como administrador)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (email) values ('intruso@teste.com');
do $$
declare h uuid;
begin
  insert into public.households (nome) values ('Outra Família') returning id into h;
  insert into public.profiles (id, household_id, nome)
  select id, h, 'Intruso' from auth.users where email = 'intruso@teste.com';
end $$;

select teste.ok((select count(*) from public.categorias) = 44,
                'Seeds: 22 categorias criadas para cada família (2 famílias)');

-- ===========================================================================
-- RENAN
-- ===========================================================================
set role authenticated;
select teste.como('renan@teste.com');

select id as cat_mercado from categorias where nome = 'Alimentação/Mercado' \gset
select id as cat_salario from categorias where nome = 'Salário' \gset

insert into cartoes (apelido, bandeira, ultimos4, dia_fechamento, dia_vencimento)
values ('Nubank Renan', 'mastercard', '1234', 5, 12)
returning id as cartao_renan \gset

select teste.ok((select user_id from cartoes where id = :'cartao_renan') = auth.uid(),
                'Cartão recebe user_id e household_id automaticamente');

-- Critério de aceite: R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33
select teste.ok((salvar_despesa(
  jsonb_build_object('id', '11111111-1111-4111-8111-111111111111',
                     'data_compra', '2026-09-20', 'valor_total_centavos', 100000,
                     'categoria_id', :'cat_mercado', 'forma_pagamento', 'credito',
                     'cartao_id', :'cartao_renan', 'qtd_parcelas', 3),
  '[{"numero":1,"total":3,"valor_centavos":33334,"competencia":"2026-10-01","data_vencimento":"2026-10-12"},
    {"numero":2,"total":3,"valor_centavos":33333,"competencia":"2026-11-01","data_vencimento":"2026-11-12"},
    {"numero":3,"total":3,"valor_centavos":33333,"competencia":"2026-12-01","data_vencimento":"2026-12-12"}]'
)).id is not null, 'Renan salva compra de R$ 1.000,00 em 3x');

-- Reenvio idêntico (fila offline reenviando): não pode duplicar.
select salvar_despesa(
  jsonb_build_object('id', '11111111-1111-4111-8111-111111111111',
                     'data_compra', '2026-09-20', 'valor_total_centavos', 100000,
                     'categoria_id', :'cat_mercado', 'forma_pagamento', 'credito',
                     'cartao_id', :'cartao_renan', 'qtd_parcelas', 3),
  '[{"numero":1,"total":3,"valor_centavos":33334,"competencia":"2026-10-01","data_vencimento":"2026-10-12"},
    {"numero":2,"total":3,"valor_centavos":33333,"competencia":"2026-11-01","data_vencimento":"2026-11-12"},
    {"numero":3,"total":3,"valor_centavos":33333,"competencia":"2026-12-01","data_vencimento":"2026-12-12"}]'
) \g /dev/null
select teste.ok((select count(*) from despesas) = 1 and (select count(*) from parcelas) = 3,
                'Reenvio idempotente: continua 1 despesa e 3 parcelas');
select teste.ok((select array_agg(valor_centavos order by numero) from parcelas)
                  = array[33334, 33333, 33333]::bigint[],
                'Parcelas 333,34 + 333,33 + 333,33');

select teste.erro($$select salvar_despesa(
  '{"id":"22222222-2222-4222-8222-222222222222","data_compra":"2026-09-20","valor_total_centavos":1000,
    "categoria_id":"$$ || :'cat_mercado' || $$","forma_pagamento":"pix"}',
  '[{"numero":1,"total":1,"valor_centavos":999,"competencia":"2026-09-01","data_vencimento":"2026-09-20"}]')$$,
  'Rejeita parcelas cuja soma difere do total');

select teste.erro($$select salvar_despesa(
  '{"id":"22222222-2222-4222-8222-222222222222","data_compra":"2026-09-20","valor_total_centavos":1000,
    "categoria_id":"$$ || :'cat_mercado' || $$","forma_pagamento":"pix"}', '[]')$$,
  'Rejeita despesa sem parcelas');

select teste.erro($$insert into despesas (data_compra, valor_total_centavos, categoria_id, forma_pagamento)
                    values ('2026-09-20', 0, '$$ || :'cat_mercado' || $$', 'pix')$$,
  'Constraint: valor precisa ser > 0');
select teste.erro($$insert into despesas (data_compra, valor_total_centavos, categoria_id, forma_pagamento,
                                          cartao_id, qtd_parcelas)
                    values ('2026-09-20', 1000, '$$ || :'cat_mercado' || $$', 'credito',
                            '$$ || :'cartao_renan' || $$', 25)$$,
  'Constraint: no máximo 24 parcelas');
select teste.erro($$insert into despesas (data_compra, valor_total_centavos, categoria_id, forma_pagamento)
                    values ('2026-09-20', 1000, '$$ || :'cat_mercado' || $$', 'credito')$$,
  'Constraint: crédito exige cartão');
select teste.erro($$insert into despesas (data_compra, valor_total_centavos, categoria_id, forma_pagamento)
                    values ('2026-09-20', 1000, '$$ || :'cat_salario' || $$', 'pix')$$,
  'Despesa não aceita categoria de receita');

-- Receita (ganho do mês) e recorrência sem duplicar
insert into recorrencias (tipo, descricao, valor_centavos, categoria_id, dia_do_mes, data_inicio)
values ('receita', 'Salário', 500000, :'cat_salario', 5, '2026-01-01')
returning id as rec_salario \gset

insert into receitas (id, data, valor_centavos, categoria_id, natureza, recorrencia_id,
                      competencia_recorrencia, origem)
values ('33333333-3333-4333-8333-333333333333', '2026-10-05', 500000, :'cat_salario', 'fixa',
        :'rec_salario', '2026-10-01', 'recorrencia');

select teste.erro($$insert into receitas (data, valor_centavos, categoria_id, natureza, recorrencia_id,
                                          competencia_recorrencia, origem)
                    values ('2026-10-05', 500000, '$$ || :'cat_salario' || $$', 'fixa',
                            '$$ || :'rec_salario' || $$', '2026-10-01', 'recorrencia')$$,
  'Recorrência não gera o mesmo mês duas vezes');

select teste.erro($$insert into auditoria (tabela, operacao) values ('x', 'INSERT')$$,
  'Usuário não escreve na auditoria');
select teste.ok((select count(*) from auditoria where tabela = 'despesas') >= 1,
                'Auditoria registrou a criação da despesa');

-- ===========================================================================
-- CAMILLA (mesma família)
-- ===========================================================================
select teste.como('camilla@teste.com');

select teste.ok((select count(*) from despesas) = 1 and (select count(*) from parcelas) = 3,
                'Camilla VÊ as despesas do Renan (visão familiar)');

update despesas set descricao = 'alterado pela Camilla'
 where id = '11111111-1111-4111-8111-111111111111';
select teste.ok((select descricao from despesas
                  where id = '11111111-1111-4111-8111-111111111111') is null,
                'Camilla NÃO consegue editar despesa do Renan (UPDATE ignorado pelo RLS)');

select teste.erro($$select salvar_despesa(
  '{"id":"11111111-1111-4111-8111-111111111111","excluido_em":"2026-09-21T10:00:00Z",
    "data_compra":"2026-09-20","valor_total_centavos":100000,
    "categoria_id":"$$ || :'cat_mercado' || $$","forma_pagamento":"pix"}', '[]')$$,
  'Camilla NÃO consegue excluir despesa do Renan');

select teste.erro($$select excluir_cartao('$$ || :'cartao_renan' || $$')$$,
  'Camilla NÃO consegue excluir o cartão do Renan');

select teste.erro($$insert into despesas (user_id, data_compra, valor_total_centavos, categoria_id, forma_pagamento)
                    select id, '2026-09-20', 1000, '$$ || :'cat_mercado' || $$', 'pix'
                      from profiles where nome = 'Renan'$$,
  'Camilla NÃO consegue lançar em nome do Renan');

select teste.erro($$update profiles set household_id = gen_random_uuid() where id = auth.uid()$$,
  'Ninguém muda a própria família');

-- Camilla lança um gasto à vista (1 parcela no mês da compra)
select salvar_despesa(
  jsonb_build_object('id', '44444444-4444-4444-8444-444444444444',
                     'data_compra', '2026-10-03', 'valor_total_centavos', 5000,
                     'categoria_id', :'cat_mercado', 'forma_pagamento', 'pix'),
  '[{"numero":1,"total":1,"valor_centavos":5000,"competencia":"2026-10-01","data_vencimento":"2026-10-03"}]'
) \g /dev/null

-- Categorias são da família: Camilla cria e exclui, movendo lançamentos
insert into categorias (nome, tipo, icone) values ('Padaria', 'despesa', '🥖')
returning id as cat_padaria \gset
select teste.erro($$insert into categorias (nome, tipo) values ('padaria', 'despesa')$$,
  'Não permite categoria duplicada (ignora maiúsculas)');
update despesas set categoria_id = :'cat_padaria' where id = '44444444-4444-4444-8444-444444444444';
select teste.erro($$select excluir_categoria('$$ || :'cat_padaria' || $$')$$,
  'Categoria em uso exige destino ao excluir');
select excluir_categoria(:'cat_padaria', :'cat_mercado') \g /dev/null
select teste.ok((select categoria_id from despesas where id = '44444444-4444-4444-8444-444444444444')
                  = :'cat_mercado'::uuid
                and not exists (select 1 from categorias where id = :'cat_padaria'),
                'Excluir categoria move os lançamentos e apaga a categoria');

-- Tarefas: a mesma regra não abre duas tarefas
insert into tarefas (titulo, origem, regra_codigo) values ('Revisar gastos', 'regra', 'DESPESA_MAIOR_RECEITA');
select teste.erro($$insert into tarefas (titulo, origem, regra_codigo)
                    values ('Revisar gastos', 'regra', 'DESPESA_MAIOR_RECEITA')$$,
  'Mesma regra não abre tarefa duplicada');

-- ===========================================================================
-- VIEWS (conciliação) — visão da família em Out/2026
-- ===========================================================================
select teste.ok((select receitas_centavos = 500000
                    and despesas_centavos = 33334 + 5000
                    and saldo_centavos = 500000 - 38334
                    and receitas_fixas_centavos = 500000
                   from vw_resumo_mensal
                  where user_id is null and competencia = '2026-10-01'),
                'Resumo familiar Out/2026: receitas, despesas (competência) e saldo corretos');
select teste.ok((select despesas_centavos from vw_resumo_mensal v
                   join profiles p on p.id = v.user_id
                  where p.nome = 'Camilla' and competencia = '2026-10-01') = 5000,
                'Resumo individual da Camilla correto');
select teste.ok((select count(*) from vw_gastos_categoria_mes where competencia = '2026-11-01') = 2,
                'Gastos por categoria: linha individual + linha da família');

-- ===========================================================================
-- RENAN: exclusão e cartões
-- ===========================================================================
select teste.como('renan@teste.com');

select teste.ok(excluir_cartao(:'cartao_renan') = 'arquivado',
                'Cartão com compras é ARQUIVADO, não apagado');
insert into cartoes (apelido, bandeira, ultimos4, dia_fechamento, dia_vencimento)
values ('Sem uso', 'visa', '9999', 10, 20) returning id as cartao_novo \gset
select teste.ok(excluir_cartao(:'cartao_novo') = 'excluido', 'Cartão sem compras é EXCLUÍDO');

select salvar_despesa(
  jsonb_build_object('id', '11111111-1111-4111-8111-111111111111', 'excluido_em', now(),
                     'data_compra', '2026-09-20', 'valor_total_centavos', 100000,
                     'categoria_id', :'cat_mercado', 'forma_pagamento', 'credito',
                     'cartao_id', :'cartao_renan', 'qtd_parcelas', 3), '[]') \g /dev/null
select teste.ok((select count(*) from parcelas
                  where despesa_id = '11111111-1111-4111-8111-111111111111') = 0
                and (select count(*) from vw_parcelas_detalhe
                      where despesa_id = '11111111-1111-4111-8111-111111111111') = 0,
                'Excluir despesa remove as parcelas e some das views');

-- ===========================================================================
-- INTRUSO (outra família) — não pode ver NADA dos Martins
-- ===========================================================================
select teste.como('intruso@teste.com');

select teste.ok((select count(*) from despesas) = 0
            and (select count(*) from parcelas) = 0
            and (select count(*) from receitas) = 0
            and (select count(*) from cartoes) = 0
            and (select count(*) from recorrencias) = 0
            and (select count(*) from tarefas) = 0
            and (select count(*) from auditoria where household_id <> meu_household()) = 0
            and (select count(*) from profiles) = 1
            and (select count(*) from households) = 1
            and (select count(*) from categorias) = 22
            and (select count(*) from vw_resumo_mensal) = 0,
                'Intruso de outra família não enxerga nenhum dado dos Martins');

select teste.erro($$insert into despesas (data_compra, valor_total_centavos, categoria_id, forma_pagamento)
                    values ('2026-09-20', 1000, '$$ || :'cat_mercado' || $$', 'pix')$$,
  'Intruso não consegue usar categoria de outra família');

-- ===========================================================================
-- ANÔNIMO (sem login)
-- ===========================================================================
set role anon;
select set_config('request.jwt.claims', '', false) \g /dev/null

select teste.erro('select count(*) from public.despesas',   'Anônimo: sem acesso a despesas');
select teste.erro('select count(*) from public.profiles',   'Anônimo: sem acesso a perfis');
select teste.erro('select count(*) from public.categorias', 'Anônimo: sem acesso a categorias');
select teste.erro('select count(*) from public.vw_resumo_mensal', 'Anônimo: sem acesso às views');
select teste.erro($$select public.salvar_despesa('{}'::jsonb, '[]'::jsonb)$$,
  'Anônimo: não chama funções do app');
select teste.ok(public.ping() like 'ok %', 'Anônimo: só consegue chamar ping() (mantém o Supabase ativo)');

reset role;
\echo
\echo '==> TODOS OS TESTES DO BANCO PASSARAM'
