-- =============================================================================
-- Finanças da Família — 005_fase5_saude.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Função substituir_insights(): grava os ALERTAS do motor de regras
--   (js/regras.js) de um mês, de uma vez só (RF-70):
--     * apaga os alertas antigos daquele mês (da família);
--     * grava os novos;
--     * mantém "lido" nos alertas que continuam valendo (você não precisa
--       marcar de novo o que já viu).
--   Se uma situação deixou de acontecer (ex.: voltou para dentro do
--   orçamento), o alerta some sozinho.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só.
--
-- Versão: 0.5.0 (Fase 5)
-- =============================================================================

create or replace function public.substituir_insights(p_competencia date, p_insights jsonb)
returns integer
language plpgsql
security invoker          -- RLS: só a própria família
set search_path = public
as $$
declare
  v_hh    uuid := public.meu_household();
  v_mes   date := date_trunc('month', p_competencia)::date;
  v_lidos jsonb;
  v_qtd   integer;
begin
  if v_hh is null then
    raise exception 'Usuário sem família.' using errcode = '42501';
  end if;

  -- Guarda quais alertas já estavam lidos (chave: regra|pessoa).
  select coalesce(jsonb_object_agg(regra_codigo || '|' || coalesce(user_id::text, ''), lido), '{}'::jsonb)
    into v_lidos
    from public.insights
   where household_id = v_hh and competencia = v_mes;

  delete from public.insights where household_id = v_hh and competencia = v_mes;

  insert into public.insights (household_id, user_id, competencia, regra_codigo, severidade, mensagem, dados, lido)
  select v_hh,
         nullif(i ->> 'user_id', '')::uuid,
         v_mes,
         i ->> 'regra_codigo',
         i ->> 'severidade',
         i ->> 'mensagem',
         coalesce(i -> 'dados', '{}'::jsonb),
         coalesce((v_lidos ->> ((i ->> 'regra_codigo') || '|' || coalesce(i ->> 'user_id', '')))::boolean, false)
    from jsonb_array_elements(coalesce(p_insights, '[]'::jsonb)) as i;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

comment on function public.substituir_insights(date, jsonb) is
  'Substitui os alertas (insights) do mês da família, preservando o "lido" dos que continuam.';

revoke execute on function public.substituir_insights(date, jsonb) from anon, public;
grant  execute on function public.substituir_insights(date, jsonb) to authenticated;
