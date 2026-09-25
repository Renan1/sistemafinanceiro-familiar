-- =============================================================================
-- Finanças da Família — 008_v13_importar_extrato.sql
-- -----------------------------------------------------------------------------
-- O QUE FAZ (v1.3 — RF-17)
--   Importação de extrato/fatura (Itaú e Nubank) no app:
--     * tabela regras_categoria: o que o app APRENDEU quando você trocou a
--       categoria sugerida de um lugar (ex.: "padaria sao jose" → Padaria).
--       Vale para a família inteira, nos dois celulares, na próxima importação;
--     * origem 'importacao_conta' (extrato da conta) nos gastos e ganhos —
--       'importacao_fatura' (fatura do cartão) já existia desde o 001.
--
--   O ARQUIVO do banco é lido NO APARELHO: ele não é enviado para lugar
--   nenhum. Só os lançamentos que você confirmar vão para o banco.
--
-- COMO RODAR
--   Supabase → SQL Editor → colar este arquivo → Run. Uma vez só (pode rodar
--   de novo sem problema). ANTES do merge da v1.3.
--
-- Versão: 1.3.0
-- =============================================================================

create table if not exists public.regras_categoria (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  tipo          text not null check (tipo in ('despesa', 'receita')),
  -- Nome do lugar normalizado (minúsculas, sem acento, sem números).
  padrao        text not null check (length(padrao) between 2 and 80),
  categoria_id  uuid not null references public.categorias(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, tipo, padrao)
);
comment on table public.regras_categoria is
  'Categoria aprendida por lugar/estabelecimento na importação de extrato (v1.3).';

drop trigger if exists trg_regras_categoria_updated_at on public.regras_categoria;
create trigger trg_regras_categoria_updated_at before update on public.regras_categoria
  for each row execute function public.tg_set_updated_at();
drop trigger if exists trg_regras_categoria_dono on public.regras_categoria;
create trigger trg_regras_categoria_dono before insert on public.regras_categoria
  for each row execute function public.tg_preencher_dono('sem_usuario');

-- A categoria precisa ser da mesma família e do mesmo tipo da regra.
create or replace function public.tg_validar_regra_categoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.categorias c
                  where c.id = new.categoria_id and c.household_id = new.household_id and c.tipo = new.tipo) then
    raise exception 'Categoria inválida para esta regra.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_validar_regra_categoria() from anon, public, authenticated;
drop trigger if exists trg_regras_categoria_refs on public.regras_categoria;
create trigger trg_regras_categoria_refs before insert or update on public.regras_categoria
  for each row execute function public.tg_validar_regra_categoria();

-- RLS: tabela da família (qualquer membro lê e ensina).
alter table public.regras_categoria enable row level security;
drop policy if exists regras_categoria_familia on public.regras_categoria;
create policy regras_categoria_familia on public.regras_categoria for all to authenticated
  using (household_id = public.meu_household())
  with check (household_id = public.meu_household());
revoke all on public.regras_categoria from anon;
grant select, insert, update, delete on public.regras_categoria to authenticated;

-- Origem dos lançamentos importados do extrato da conta.
alter table public.despesas drop constraint if exists despesas_origem_check;
alter table public.despesas add constraint despesas_origem_check
  check (origem in ('manual', 'recorrencia', 'importacao_fatura', 'importacao_conta', 'carteira_iphone'));
alter table public.receitas drop constraint if exists receitas_origem_check;
alter table public.receitas add constraint receitas_origem_check
  check (origem in ('manual', 'recorrencia', 'importacao_fatura', 'importacao_conta'));

-- Conferência (só leitura): deve vir "OK".
select 'v1.3: regras de categoria com RLS e sem acesso anônimo' as verificacao,
       case when (select relrowsecurity from pg_class where oid = 'public.regras_categoria'::regclass)
             and not has_table_privilege('anon', 'public.regras_categoria', 'select')
            then 'OK' else 'FALHA' end as resultado;
