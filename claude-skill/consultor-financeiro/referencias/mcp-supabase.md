# Futuro: trocar o export manual por conexão direta (MCP + Supabase)

**Hoje:** app → *Exportar JSON* → anexar no Claude → copiar tarefas → *Importar no app*.
**Com MCP:** o Claude consulta o banco diretamente ("Analise outubro") e, se permitido, grava as tarefas.

> ⚠️ Isto ainda **não** está configurado. É um guia para quando quiserem dar esse passo. Leia a seção de segurança antes.

## Opções

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. MCP oficial do Supabase** (`@supabase/mcp-server-supabase`) | Conector com *Personal Access Token* do Supabase, em modo `--read-only` e `--project-ref=<seu projeto>` | Pronto, mantido pelo Supabase | O token é da **conta** (acesso de administrador ao projeto); ignora o RLS |
| **B. MCP Postgres com usuário somente-leitura** (recomendado) | Um usuário Postgres próprio, que só lê as views/tabelas necessárias | Menor privilégio; nada de escrita | Precisa criar o usuário (SQL abaixo) e guardar a senha |
| **C. Edge Function "export"** | Uma função no Supabase que devolve o mesmo JSON do app, chamada por um conector HTTP | Reaproveita o formato `export@1` e o RLS do usuário | Mais código para manter |

## Recomendação: opção B (somente-leitura)

### 1. Criar o usuário de leitura (Supabase → SQL Editor)
```sql
-- Troque a senha por uma forte e guarde no gerenciador de senhas.
create role claude_leitura login password 'TROQUE-POR-UMA-SENHA-FORTE';

grant usage on schema public to claude_leitura;
grant select on public.vw_resumo_mensal, public.vw_gastos_categoria_mes,
                public.vw_comprometimento_futuro, public.vw_parcelas_detalhe,
                public.categorias, public.recorrencias, public.orcamentos,
                public.insights, public.tarefas
  to claude_leitura;

-- O RLS usa auth.uid(), que não existe para este usuário: libere a leitura
-- da SUA família só para ele (troque o id; veja em: select id from households).
do $$ declare t text; begin
  foreach t in array array['categorias','recorrencias','orcamentos','insights','tarefas','parcelas','despesas','receitas'] loop
    execute format('create policy %1$s_claude_leitura on public.%1$I for select to claude_leitura
                    using (household_id = %2$L::uuid)', t, 'ID-DA-SUA-FAMILIA');
  end loop;
end $$;
grant select on public.parcelas, public.despesas, public.receitas to claude_leitura; -- base das views
grant execute on function public.mes_atual() to claude_leitura;             -- usada por uma view
```
> As views usam `security_invoker`, então elas respeitam as políticas acima.

### 2. Conectar no Claude
No Claude Desktop/Code, adicione um servidor MCP de Postgres apontando para a *connection string* do Supabase (Project Settings → Database → Connection string, modo **Session pooler**), com o usuário `claude_leitura`. **Nunca** use a senha do usuário `postgres` nem a `service_role`.

### 3. Adaptar a Skill
Troque a seção 1 do `SKILL.md` ("confira a entrada") por consultas equivalentes ao export:
```sql
select * from vw_resumo_mensal where competencia between :inicio6 and :mes;
select * from vw_gastos_categoria_mes where competencia = :mes and user_id is null;
select * from vw_comprometimento_futuro where cartao_id is null;
select * from insights where competencia = :mes;
select * from tarefas where status = 'aberta';
```
As tarefas continuam indo pelo bloco `tarefas@1` → *Importar no app* (o usuário de leitura não grava nada — de propósito).

## Segurança — checklist
- [ ] Usuário **somente-leitura**, limitado às tabelas/views acima e à sua família.
- [ ] Nunca `service_role`, nunca o usuário `postgres`, nunca a senha no repositório.
- [ ] Revogar quando não usar mais: `drop owned by claude_leitura; drop role claude_leitura;`
- [ ] Lembrar que os dados consultados passam pela conversa com o Claude.
