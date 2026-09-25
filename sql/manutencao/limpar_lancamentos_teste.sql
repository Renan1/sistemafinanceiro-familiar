-- =============================================================================
-- Finanças da Família — sql/manutencao/limpar_lancamentos_teste.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Zera os dados de TESTE para começar o uso real:
--     SEMPRE apaga: gastos, parcelas, ganhos, alertas (insights), tarefas e a
--                   caixa de entrada da Carteira do iPhone (v1.2, se existir).
--     OPCIONAL (você escolhe na PARTE 2): cartões, recorrências e orçamentos.
--
-- O QUE NUNCA APAGA
--   Família, usuários (logins), categorias e as chaves do Atalho do iPhone. Categorias criadas no teste
--   você exclui pelo app: Mais → Categorias.
--
-- ⚠️ ATENÇÃO: apaga de verdade, sem volta. Faça antes um "Backup completo"
--   (app → Mais → Exportar dados) se quiser guardar o teste.
--
-- ANTES DE RODAR
--   Abra o app nos dois celulares COM internet e confira que o topo mostra
--   "✓ Tudo sincronizado". Se algum ficou "aguardando sinal", ele seria
--   enviado DEPOIS da limpeza e voltaria a aparecer.
--
-- COMO RODAR (Supabase → SQL Editor)
--   1. Rode só a PARTE 1 (prévia): mostra quantos registros existem.
--   2. Na PARTE 2, escolha o que apagar (true/false), troque
--      v_confirmo := false  por  v_confirmo := true  e rode a PARTE 2.
--   3. Rode a PARTE 1 de novo para conferir.
--   4. Nos celulares: feche e abra o app.
--
-- RECORRÊNCIAS: se você MANTIVER as recorrências (salário, aluguel…), ao abrir
--   o app ele gera de novo os lançamentos delas do mês atual — é o esperado.
--   Se as recorrências eram de teste, apague-as (v_apagar_recorrencias) ou
--   exclua pelo app antes (Mais → Recorrências).
--
-- Pode ser rodado mais de uma vez sem problema.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — PRÉVIA (só consulta, não altera nada)
-- ---------------------------------------------------------------------------
select 'Gastos (despesas)'   as o_que, count(*) as quantidade from public.despesas
union all select 'Parcelas',             count(*) from public.parcelas
union all select 'Ganhos (receitas)',    count(*) from public.receitas
union all select 'Alertas (insights)',   count(*) from public.insights
union all select 'Tarefas',              count(*) from public.tarefas
union all select 'Cartões  (opcional)',       count(*) from public.cartoes
union all select 'Recorrências  (opcional)',  count(*) from public.recorrencias
union all select 'Orçamentos  (opcional)',    count(*) from public.orcamentos
union all select 'Categorias  (não apaga)',   count(*) from public.categorias;


-- ---------------------------------------------------------------------------
-- PARTE 2 — LIMPEZA (só executa se v_confirmo = true)
-- ---------------------------------------------------------------------------
do $$
declare
  -- Escolha o que mais apagar além dos lançamentos, alertas e tarefas:
  v_apagar_cartoes      boolean := false;  -- cartões de teste?
  v_apagar_recorrencias boolean := false;  -- gastos/ganhos fixos de teste?
  v_apagar_orcamentos   boolean := false;  -- orçamentos de teste?

  v_confirmo boolean := false;   -- <<< troque para true para apagar de verdade

  v_tabelas text[] := array['despesas', 'receitas', 'tarefas'];
  v_despesas int; v_receitas int; v_tarefas int;
begin
  if not v_confirmo then
    raise notice 'Nada foi apagado. Para confirmar, troque v_confirmo para true.';
    return;
  end if;

  select count(*) into v_despesas from public.despesas;
  select count(*) into v_receitas from public.receitas;
  select count(*) into v_tarefas  from public.tarefas;

  -- Ordem importa: primeiro o que aponta para cartões/recorrências.
  delete from public.parcelas;
  delete from public.despesas;
  delete from public.receitas;
  delete from public.insights;
  delete from public.tarefas;
  -- v1.2: caixa de entrada da Carteira (a tabela só existe depois do sql/007).
  if to_regclass('public.caixa_entrada') is not null then
    execute 'delete from public.caixa_entrada';
  end if;

  if v_apagar_recorrencias then
    delete from public.recorrencias;
    v_tabelas := array_append(v_tabelas, 'recorrencias');
  end if;

  if v_apagar_cartoes then
    -- Recorrências que ainda usam um cartão impedem apagá-lo.
    if exists (select 1 from public.recorrencias where cartao_id is not null) then
      raise exception 'Há recorrências usando cartão. Marque também v_apagar_recorrencias ou exclua essas recorrências no app. Nada foi apagado.';
    end if;
    delete from public.cartoes;
    v_tabelas := array_append(v_tabelas, 'cartoes');
  end if;

  if v_apagar_orcamentos then
    delete from public.orcamentos;
    v_tabelas := array_append(v_tabelas, 'orcamentos');
  end if;

  -- O histórico de auditoria do teste também sai (inclusive os registros de
  -- DELETE que esta própria limpeza gerou), para o log começar limpo.
  delete from public.auditoria where tabela = any (v_tabelas);

  raise notice 'Limpeza concluída: % gasto(s), % ganho(s) e % tarefa(s) apagados. Também apagado: %.',
    v_despesas, v_receitas, v_tarefas,
    coalesce(nullif(array_to_string(v_tabelas[4:], ', '), ''), 'nada além disso');
end $$;
