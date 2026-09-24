-- =============================================================================
-- Finanças da Família — sql/manutencao/limpar_lancamentos_teste.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Apaga os LANÇAMENTOS feitos durante os testes (gastos, parcelas e ganhos),
--   para começar o uso real com o sistema zerado.
--
-- O QUE MANTÉM (não apaga)
--   Família, usuários, categorias, cartões, recorrências e orçamentos.
--
-- ⚠️ ATENÇÃO: apaga de verdade, sem volta. Use só no fim dos testes.
--
-- ANTES DE RODAR
--   Abra o app nos dois celulares COM internet e confira que o topo mostra
--   "✓ Tudo sincronizado". Se algum ficou "aguardando sinal", ele seria
--   enviado DEPOIS da limpeza e voltaria a aparecer.
--
-- COMO RODAR (Supabase → SQL Editor)
--   1. Rode só a PARTE 1 (prévia): mostra quantos registros serão apagados.
--   2. Na PARTE 2, troque  v_confirmo := false  por  v_confirmo := true
--      e rode a PARTE 2.
--   3. Rode a PARTE 1 de novo: tudo deve estar zerado.
--   4. Nos celulares: feche e abra o app (a lista se atualiza sozinha).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — PRÉVIA (só consulta, não altera nada)
-- ---------------------------------------------------------------------------
select 'Gastos (despesas)'          as o_que, count(*) as quantidade from public.despesas
union all select 'Parcelas',                   count(*) from public.parcelas
union all select 'Ganhos (receitas)',          count(*) from public.receitas
union all select 'Alertas (insights)',         count(*) from public.insights
union all select 'Registros de auditoria dos lançamentos',
                 count(*) from public.auditoria where tabela in ('despesas', 'receitas');


-- ---------------------------------------------------------------------------
-- PARTE 2 — LIMPEZA (só executa se v_confirmo = true)
-- ---------------------------------------------------------------------------
do $$
declare
  v_confirmo boolean := false;   -- <<< troque para true para apagar de verdade
  v_despesas int;
  v_receitas int;
begin
  if not v_confirmo then
    raise notice 'Nada foi apagado. Para confirmar, troque v_confirmo para true.';
    return;
  end if;

  select count(*) into v_despesas from public.despesas;
  select count(*) into v_receitas from public.receitas;

  delete from public.parcelas;   -- (também cairiam junto com as despesas)
  delete from public.despesas;
  delete from public.receitas;
  delete from public.insights;
  -- O histórico de auditoria dos testes também sai, para o log começar limpo.
  -- A própria limpeza gera novos registros de auditoria (DELETE): apagamos
  -- esses também, pois são só do teste.
  delete from public.auditoria where tabela in ('despesas', 'receitas');

  raise notice 'Limpeza concluída: % gasto(s) e % ganho(s) de teste apagados.', v_despesas, v_receitas;
end $$;
