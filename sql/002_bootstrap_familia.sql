-- =============================================================================
-- Finanças da Família — 002_bootstrap_familia.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ
--   Cria a família e liga os dois usuários (Renan e Camilla) a ela.
--   As categorias padrão são criadas AUTOMATICAMENTE ao criar a família.
--
-- PRÉ-REQUISITOS
--   1. 001_schema.sql já executado.
--   2. Os dois usuários já criados em: Supabase → Authentication → Users →
--      "Add user" → "Create new user" (marcar "Auto Confirm User").
--
-- COMO RODAR
--   1. Troque os DOIS e-mails abaixo pelos e-mails reais usados no passo 2.
--   2. SQL Editor → colar → Run.
--   3. Deve aparecer a mensagem "Família criada com 2 membro(s)".
--
-- Pode rodar de novo sem problema: se a família já existir, só completa o que
-- faltar (não duplica nada).
-- =============================================================================

do $$
declare
  -- >>>>>>>>>>>>>>>>>>>>>> EDITE AQUI <<<<<<<<<<<<<<<<<<<<<<<<
  v_nome_familia  text := 'Família Martins';
  v_email_renan   text := 'EMAIL_DO_RENAN@exemplo.com';
  v_email_camilla text := 'EMAIL_DA_CAMILLA@exemplo.com';
  -- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  v_household uuid;
  v_renan     uuid;
  v_camilla   uuid;
  v_membros   int;
begin
  select id into v_renan   from auth.users where lower(email) = lower(v_email_renan);
  select id into v_camilla from auth.users where lower(email) = lower(v_email_camilla);

  if v_renan is null then
    raise exception 'Usuário % não encontrado em Authentication → Users.', v_email_renan;
  end if;
  if v_camilla is null then
    raise exception 'Usuário % não encontrado em Authentication → Users.', v_email_camilla;
  end if;

  -- Reaproveita a família se algum dos dois já estiver em uma.
  select household_id into v_household
    from public.profiles where id in (v_renan, v_camilla) limit 1;

  if v_household is null then
    insert into public.households (nome) values (v_nome_familia)
    returning id into v_household;   -- o gatilho já cria as categorias padrão
  end if;

  insert into public.profiles (id, household_id, nome, cor_identificacao) values
    (v_renan,   v_household, 'Renan',   '#0A84FF'),
    (v_camilla, v_household, 'Camilla', '#FF375F')
  on conflict (id) do nothing;

  select count(*) into v_membros from public.profiles where household_id = v_household;
  raise notice 'Família criada com % membro(s). household_id = %', v_membros, v_household;
end $$;

-- Conferência: deve listar os 2 membros e a quantidade de categorias (22).
select h.nome as familia, p.nome as membro, u.email,
       (select count(*) from public.categorias c where c.household_id = h.id) as categorias
  from public.households h
  join public.profiles p on p.household_id = h.id
  join auth.users u      on u.id = p.id;
