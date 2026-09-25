-- =============================================================================
-- tests/sql/50_testes_v13.sql — v1.2: Carteira do iPhone (atalho + caixa de entrada)
-- Roda depois dos testes anteriores (reaproveita o schema "teste").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- ---------------------------------------------------------------------------
-- Leitura do valor em texto (como o iPhone manda)
-- ---------------------------------------------------------------------------
select teste.ok(public.valor_texto_centavos('R$ 1.234,56') = 123456, 'Valor: "R$ 1.234,56" → 123456');
select teste.ok(public.valor_texto_centavos('1,234.56') = 123456,    'Valor: "1,234.56" → 123456');
select teste.ok(public.valor_texto_centavos('12,3') = 1230,          'Valor: "12,3" → 1230');
select teste.ok(public.valor_texto_centavos('12.34') = 1234,         'Valor: "12.34" → 1234');
select teste.ok(public.valor_texto_centavos('1.234') = 123400,       'Valor: "1.234" (milhar) → 123400');
select teste.ok(public.valor_texto_centavos('R$ 45') = 4500,         'Valor: "R$ 45" → 4500');
select teste.ok(public.valor_texto_centavos('R$ 1 234,56') = 123456, 'Valor: com espaço (incl. especial) → 123456');
select teste.ok(public.valor_texto_centavos('abc') is null,          'Valor: sem número → null');

-- ---------------------------------------------------------------------------
-- Renan cria uma chave; o hash não é legível pelo app
-- ---------------------------------------------------------------------------
set role authenticated;
select teste.como('renan@teste.com');
select public.criar_atalho('iPhone do Renan') as chave \gset

select teste.ok(:'chave' ~ '^ff_[0-9a-f]{64}$', 'Chave criada no formato ff_ + 64 hex');
select teste.ok((select count(*) from atalhos where apelido = 'iPhone do Renan' and revogado_em is null) = 1,
                'Renan vê a própria chave (apelido, datas)');
select teste.erro('select token_hash from public.atalhos', 'Ninguém lê o hash da chave pelo app');
select teste.erro($$insert into public.atalhos (household_id, user_id, apelido, token_hash)
                    values (public.meu_household(), auth.uid(), 'x', repeat('a', 64))$$,
                  'Chave não pode ser criada direto na tabela (só pela função)');
select teste.erro($$insert into public.caixa_entrada (household_id, user_id, valor_centavos)
                    values (public.meu_household(), auth.uid(), 100)$$,
                  'Caixa de entrada não aceita insert direto do app');

-- ---------------------------------------------------------------------------
-- O ATALHO (sem login) registra compras com a chave
-- ---------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '', false) \g /dev/null

select teste.ok(public.registrar_compra_atalho(:'chave', 'R$ 45,90', 'PADARIA SAO JOSE', 'Nubank') = 'ok',
                'Atalho com a chave certa registra a compra (responde só "ok")');
select teste.erro($$select public.registrar_compra_atalho('ff_chave_errada_000000000000000000', '10,00')$$,
                  'Chave errada é recusada');
select teste.erro($$select public.registrar_compra_atalho('$$ || :'chave' || $$', 'grátis')$$,
                  'Valor inválido é recusado');
select teste.erro($$select public.registrar_compra_atalho('$$ || :'chave' || $$', '0,00')$$,
                  'Valor zero é recusado');
select teste.erro('select count(*) from public.caixa_entrada', 'Anônimo não lê a caixa de entrada');
select teste.erro('select count(*) from public.atalhos',       'Anônimo não lê as chaves');
select teste.erro($$select public.criar_atalho('x')$$,          'Anônimo não cria chave');
select teste.erro($$select public.valor_texto_centavos('1')$$,  'Anônimo só chama ping() e registrar_compra_atalho()');

-- ---------------------------------------------------------------------------
-- Renan vê a compra e lança; Camilla vê mas não altera; intruso não vê
-- ---------------------------------------------------------------------------
set role authenticated;
select teste.como('renan@teste.com');
select id as caixa from caixa_entrada where estabelecimento = 'PADARIA SAO JOSE' \gset
select teste.ok((select valor_centavos = 4590 and cartao_nome = 'Nubank' and status = 'pendente' and user_id = auth.uid()
                   from caixa_entrada where id = :'caixa'),
                'Compra chega na caixa do dono da chave: R$ 45,90, Nubank, pendente');
select teste.ok((select ultimo_uso_em is not null from atalhos where apelido = 'iPhone do Renan'),
                'A chave registra o último uso');

select id as cat from categorias where nome = 'Alimentação/Mercado' \gset
select salvar_despesa(jsonb_build_object(
  'id', '71111111-1111-4111-8111-111111111111', 'data_compra', '2026-09-25', 'valor_total_centavos', 4590,
  'categoria_id', :'cat', 'forma_pagamento', 'pix', 'local_nome', 'PADARIA SAO JOSE', 'origem', 'carteira_iphone'),
  '[{"numero":1,"total":1,"valor_centavos":4590,"competencia":"2026-09-01","data_vencimento":"2026-09-25"}]');
update caixa_entrada set status = 'lancado', despesa_id = '71111111-1111-4111-8111-111111111111' where id = :'caixa';
select teste.ok((select status = 'lancado' and despesa_id is not null from caixa_entrada where id = :'caixa'),
                'Lançar: gasto com origem "carteira_iphone" e item marcado como lançado');
select teste.erro($$update public.caixa_entrada set valor_centavos = 1 where id = '$$ || :'caixa' || $$'$$,
                  'O valor recebido não pode ser alterado (só status e gasto)');

select teste.como('camilla@teste.com');
select teste.ok((select count(*) from caixa_entrada where id = :'caixa') = 1, 'Camilla vê a caixa da família');
update caixa_entrada set status = 'descartado' where id = :'caixa';
select teste.como('renan@teste.com');
select teste.ok((select status from caixa_entrada where id = :'caixa') = 'lancado',
                'Camilla não altera a caixa do Renan (RLS)');
select teste.como('camilla@teste.com');
select teste.ok((select count(*) from atalhos) = 0, 'Camilla não vê as chaves do Renan');

select teste.como('intruso@teste.com');
select teste.ok((select count(*) from caixa_entrada) = 0, 'Intruso não vê a caixa de outra família');

-- ---------------------------------------------------------------------------
-- Revogar a chave: o atalho para de funcionar na hora
-- ---------------------------------------------------------------------------
select teste.como('renan@teste.com');
update atalhos set revogado_em = now() where apelido = 'iPhone do Renan';
set role anon;
select set_config('request.jwt.claims', '', false) \g /dev/null
select teste.erro($$select public.registrar_compra_atalho('$$ || :'chave' || $$', '10,00')$$,
                  'Chave revogada é recusada');

-- ---------------------------------------------------------------------------
-- Limite de 30 envios por hora por chave
-- ---------------------------------------------------------------------------
set role authenticated;
select teste.como('renan@teste.com');
select public.criar_atalho('Teste limite') as chave2 \gset
set role anon;
select set_config('request.jwt.claims', '', false) \g /dev/null
select count(public.registrar_compra_atalho(:'chave2', '1,00')) from generate_series(1, 30);
select teste.erro($$select public.registrar_compra_atalho('$$ || :'chave2' || $$', '1,00')$$,
                  'A 31ª compra na mesma hora é recusada (limite por chave)');

-- Máximo de 5 chaves ativas por pessoa
set role authenticated;
select teste.como('renan@teste.com');
select public.criar_atalho('extra ' || g) from generate_series(1, 4) g;
select teste.erro($$select public.criar_atalho('sexta')$$, 'No máximo 5 chaves ativas por pessoa');

reset role;
\echo '==> TESTES DA v1.2 PASSARAM'
