-- =============================================================================
-- Finanças da Família — 006_v11_parcela_com_juros.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ (v1.1 — RF-15)
--   Compra parcelada COM JUROS: guarda, opcionalmente, o PREÇO À VISTA da
--   compra, para o app mostrar quanto se pagou de juros (e a Skill do Claude
--   poder apontar isso).
--     * nova coluna despesas.valor_a_vista_centavos (vazia = não informado);
--     * salvar_despesa() passa a gravar essa coluna (resto igual ao 001).
--
--   O total da compra continua em valor_total_centavos (= soma das parcelas).
--   Informar pela parcela ("12x de R$ 189,90") é feito no app: o total vira
--   parcela × 12 e as 12 parcelas saem iguais.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só
--   (pode rodar de novo sem problema). ANTES do merge da v1.1.
--
-- Versão: 1.1.0
-- =============================================================================

alter table public.despesas
  add column if not exists valor_a_vista_centavos bigint;

-- À vista: maior que zero e nunca maior que o total parcelado.
alter table public.despesas drop constraint if exists ck_desp_a_vista;
alter table public.despesas add constraint ck_desp_a_vista check (
  valor_a_vista_centavos is null
  or (valor_a_vista_centavos > 0 and valor_a_vista_centavos <= valor_total_centavos)
);

comment on column public.despesas.valor_a_vista_centavos is
  'Preço à vista informado numa compra parcelada com juros (opcional). Juros = valor_total_centavos − este.';


-- -----------------------------------------------------------------------------
-- salvar_despesa(): mesma função do 001, agora gravando valor_a_vista_centavos.
-- -----------------------------------------------------------------------------
create or replace function public.salvar_despesa(p_despesa jsonb, p_parcelas jsonb default '[]'::jsonb)
returns public.despesas
language plpgsql
security invoker
set search_path = public
as $$
declare
  d        public.despesas;
  v_qtd    int;
  v_soma   bigint;
  v_ok_num boolean;
begin
  -- Converte o JSON para o tipo da tabela; household/user vêm SEMPRE da sessão.
  d := jsonb_populate_record(null::public.despesas, p_despesa);
  if d.id is null then
    raise exception 'A despesa precisa de um id (gerado no app).' using errcode = '22023';
  end if;
  d.household_id := public.meu_household();
  d.user_id      := auth.uid();
  d.qtd_parcelas := coalesce(d.qtd_parcelas, 1);
  if d.household_id is null then
    raise exception 'Usuário sem família associada.' using errcode = '42501';
  end if;

  -- Validação das parcelas (exceto em exclusão).
  if d.excluido_em is null then
    select count(*), coalesce(sum((p ->> 'valor_centavos')::bigint), 0),
           bool_and((p ->> 'total')::int = d.qtd_parcelas)
             and count(distinct (p ->> 'numero')::int) = count(*)
             and min((p ->> 'numero')::int) = 1
             and max((p ->> 'numero')::int) = count(*)
      into v_qtd, v_soma, v_ok_num
      from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) as p;

    if v_qtd <> d.qtd_parcelas or not coalesce(v_ok_num, false) then
      raise exception 'Parcelas inconsistentes: esperado % parcela(s) numeradas 1..%.',
        d.qtd_parcelas, d.qtd_parcelas using errcode = '22023';
    end if;
    if v_soma <> d.valor_total_centavos then
      raise exception 'Soma das parcelas (%) difere do valor total (%).',
        v_soma, d.valor_total_centavos using errcode = '22023';
    end if;
  end if;

  -- Upsert da despesa. Em conflito de id, só atualiza se for do próprio
  -- usuário (a política de UPDATE do RLS barra os demais com erro).
  insert into public.despesas as t (
    id, household_id, user_id, data_compra, valor_total_centavos, descricao,
    categoria_id, forma_pagamento, cartao_id, qtd_parcelas, natureza,
    recorrencia_id, competencia_recorrencia, latitude, longitude,
    precisao_metros, local_nome, origem, observacao, excluido_em,
    valor_a_vista_centavos)
  values (
    d.id, d.household_id, d.user_id, d.data_compra, d.valor_total_centavos, d.descricao,
    d.categoria_id, d.forma_pagamento, d.cartao_id, d.qtd_parcelas, coalesce(d.natureza, 'variavel'),
    d.recorrencia_id, d.competencia_recorrencia, d.latitude, d.longitude,
    d.precisao_metros, d.local_nome, coalesce(d.origem, 'manual'), d.observacao, d.excluido_em,
    d.valor_a_vista_centavos)
  on conflict (id) do update set
    data_compra             = excluded.data_compra,
    valor_total_centavos    = excluded.valor_total_centavos,
    descricao               = excluded.descricao,
    categoria_id            = excluded.categoria_id,
    forma_pagamento         = excluded.forma_pagamento,
    cartao_id               = excluded.cartao_id,
    qtd_parcelas            = excluded.qtd_parcelas,
    natureza                = excluded.natureza,
    recorrencia_id          = excluded.recorrencia_id,
    competencia_recorrencia = excluded.competencia_recorrencia,
    latitude                = excluded.latitude,
    longitude               = excluded.longitude,
    precisao_metros         = excluded.precisao_metros,
    local_nome              = excluded.local_nome,
    origem                  = excluded.origem,
    observacao              = excluded.observacao,
    excluido_em             = excluded.excluido_em,
    valor_a_vista_centavos  = excluded.valor_a_vista_centavos
  returning t.* into d;

  -- Substitui as parcelas (editar = regenerar todas; excluir = remover todas).
  delete from public.parcelas where despesa_id = d.id;

  if d.excluido_em is null then
    insert into public.parcelas (despesa_id, household_id, user_id, numero, total,
                                 valor_centavos, competencia, data_vencimento, cartao_id)
    select d.id, d.household_id, d.user_id,
           (p ->> 'numero')::smallint,
           (p ->> 'total')::smallint,
           (p ->> 'valor_centavos')::bigint,
           (p ->> 'competencia')::date,
           (p ->> 'data_vencimento')::date,
           d.cartao_id
      from jsonb_array_elements(p_parcelas) as p;
  end if;

  return d;
end;
$$;
comment on function public.salvar_despesa(jsonb, jsonb) is
  'Cria/atualiza/exclui (soft) uma despesa e regenera as parcelas de forma atômica e idempotente.';
