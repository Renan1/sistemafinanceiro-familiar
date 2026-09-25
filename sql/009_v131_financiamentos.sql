-- =============================================================================
-- Finanças da Família — 009_v131_financiamentos.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ (v1.3.1)
--   Nova categoria de gasto "Financiamentos" (🏦) — parcela de financiamento
--   de carro, casa, empréstimo, consórcio. Fica separada de Transporte.
--     * cria a categoria na(s) família(s) que ainda não têm;
--     * inclui a categoria no conjunto padrão de famílias novas.
--   Se você já criou uma categoria com esse nome, nada muda.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só (pode rodar
--   de novo sem problema). ANTES do merge da v1.3.1.
--
-- Versão: 1.3.1
-- =============================================================================

insert into public.categorias (household_id, nome, tipo, icone, cor, ordem)
select h.id, 'Financiamentos', 'despesa', '🏦', '#0A84FF', 135
  from public.households h
 where not exists (select 1 from public.categorias c
                    where c.household_id = h.id and c.tipo = 'despesa'
                      and lower(trim(c.nome)) = 'financiamentos');

-- Conjunto padrão (famílias novas): o mesmo do 001 + Financiamentos.
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
    (p_household, 'Financiamentos',           'despesa', '🏦', '#0A84FF', 135),
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
revoke execute on function public.criar_categorias_padrao(uuid) from anon, public, authenticated;

-- Conferência (só leitura): deve vir "OK".
select 'v1.3.1: categoria Financiamentos em todas as famílias' as verificacao,
       case when not exists (select 1 from public.households h
                              where not exists (select 1 from public.categorias c
                                                 where c.household_id = h.id and c.tipo = 'despesa'
                                                   and lower(trim(c.nome)) = 'financiamentos'))
            then 'OK' else 'FALHA' end as resultado;
