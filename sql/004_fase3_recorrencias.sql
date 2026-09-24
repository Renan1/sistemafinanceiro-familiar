-- =============================================================================
-- Finanças da Família — 004_fase3_recorrencias.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Função alterar_valor_recorrencia(): "alterar o valor de um gasto/ganho
--   fixo A PARTIR DE UM MÊS" (RF-32), preservando o histórico.
--
--   Exemplo: salário de R$ 5.000 desde janeiro; aumento para R$ 5.500 a
--   partir de outubro. Resultado:
--     * recorrência antiga: continua valendo de janeiro a setembro;
--     * recorrência nova (R$ 5.500): a partir de outubro, apontando para a
--       antiga (substitui_id) — dá para ver o histórico de reajustes;
--     * lançamentos já gerados de outubro em diante passam para o valor novo.
--   Tudo numa transação: ou faz tudo, ou nada.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só.
--   Pré-requisito: 001_schema.sql já executado.
--
-- Versão: 0.3.0 (Fase 3)
-- =============================================================================

create or replace function public.alterar_valor_recorrencia(
  p_recorrencia uuid,
  p_a_partir    date,      -- qualquer dia do mês; vale o mês inteiro
  p_valor       bigint     -- novo valor em centavos
)
returns public.recorrencias
language plpgsql
security invoker          -- RLS: só o dono da recorrência consegue
set search_path = public
as $$
declare
  v_antiga  public.recorrencias;
  v_nova    public.recorrencias;
  v_mes     date := date_trunc('month', p_a_partir)::date;
  v_destino uuid;
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'O novo valor precisa ser maior que zero.' using errcode = '22023';
  end if;

  select * into v_antiga from public.recorrencias
   where id = p_recorrencia and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'Recorrência não encontrada ou não é sua.' using errcode = 'P0002';
  end if;
  if v_antiga.data_fim is not null and v_antiga.data_fim < v_mes then
    raise exception 'Esta recorrência já terminou antes desse mês.' using errcode = '22023';
  end if;

  if v_mes <= date_trunc('month', v_antiga.data_inicio)::date then
    -- Vale desde o começo: só troca o valor (não há histórico a preservar).
    update public.recorrencias set valor_centavos = p_valor where id = v_antiga.id
    returning * into v_nova;
    v_destino := v_antiga.id;
  else
    -- Encerra a antiga no último dia do mês anterior…
    update public.recorrencias set data_fim = v_mes - 1 where id = v_antiga.id;
    -- …e cria a nova a partir do mês escolhido.
    insert into public.recorrencias (household_id, user_id, tipo, descricao, valor_centavos,
      categoria_id, forma_pagamento, cartao_id, dia_do_mes, data_inicio, data_fim, ativa, substitui_id)
    values (v_antiga.household_id, v_antiga.user_id, v_antiga.tipo, v_antiga.descricao, p_valor,
      v_antiga.categoria_id, v_antiga.forma_pagamento, v_antiga.cartao_id, v_antiga.dia_do_mes,
      v_mes, v_antiga.data_fim, v_antiga.ativa, v_antiga.id)
    returning * into v_nova;
    v_destino := v_nova.id;

    -- Lançamentos já gerados (inclusive excluídos) desse mês em diante passam
    -- a pertencer à nova recorrência — assim o app não gera de novo.
    update public.receitas set recorrencia_id = v_destino
     where recorrencia_id = v_antiga.id and competencia_recorrencia >= v_mes;
    update public.despesas set recorrencia_id = v_destino
     where recorrencia_id = v_antiga.id and competencia_recorrencia >= v_mes;
  end if;

  -- Atualiza o valor dos lançamentos já gerados (não excluídos) a partir do mês.
  update public.receitas set valor_centavos = p_valor
   where recorrencia_id = v_destino and competencia_recorrencia >= v_mes and excluido_em is null;

  -- Despesas de recorrência têm sempre 1 parcela: atualiza despesa e parcela.
  update public.parcelas p set valor_centavos = p_valor
    from public.despesas d
   where p.despesa_id = d.id and d.recorrencia_id = v_destino
     and d.competencia_recorrencia >= v_mes and d.excluido_em is null and d.qtd_parcelas = 1;
  update public.despesas set valor_total_centavos = p_valor
   where recorrencia_id = v_destino and competencia_recorrencia >= v_mes
     and excluido_em is null and qtd_parcelas = 1;

  return v_nova;
end;
$$;

comment on function public.alterar_valor_recorrencia(uuid, date, bigint) is
  'Altera o valor de uma recorrência a partir de um mês, preservando o histórico (RF-32).';

revoke execute on function public.alterar_valor_recorrencia(uuid, date, bigint) from anon, public;
grant  execute on function public.alterar_valor_recorrencia(uuid, date, bigint) to authenticated;
