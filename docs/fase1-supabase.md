# Fase 1 — Criar e configurar o Supabase (passo a passo)

Tempo estimado: 20 minutos. Tudo pelo navegador, nada para instalar.

> ⚠️ **Guarde as senhas num gerenciador de senhas** (Bitwarden, 1Password, o do navegador…). **Nunca** cole senhas ou chaves em arquivos do projeto, commits ou prints públicos.
>
> Os nomes dos menus do Supabase mudam de vez em quando. Se algum não bater exatamente, procure pelo nome parecido — ou me mande um print.

---

## Passo 1 — Criar o projeto

1. Acesse **https://supabase.com** → **Start your project** → entre com sua conta do GitHub.
2. **New project**:
   - **Organization:** a sua (plano **Free**)
   - **Project name:** `financas-familia`
   - **Database password:** clique em **Generate a password** e **guarde no gerenciador de senhas**. (Não é a senha de login do app; é a senha do banco, usada só em emergências.)
   - **Region:** **South America (São Paulo)**
3. **Create new project** e aguarde 1–2 minutos até ficar verde.

## Passo 2 — Criar o banco (rodar `001_schema.sql`)

1. Menu lateral → **SQL Editor** → **New query**.
2. Abra no VS Code o arquivo `sql/001_schema.sql`, **selecione tudo** (Ctrl+A), copie (Ctrl+C).
3. Cole no editor do Supabase e clique **Run** (ou Ctrl+Enter).
4. Resultado esperado: **"Success. No rows returned"**.
   - Se aparecer erro, **não rode de novo por cima**: me mande o print do erro.

## Passo 3 — Fechar o cadastro e definir a política de senha

Menu lateral → **Authentication**:

1. **Sign In / Providers** (ou **Providers → Email**):
   - **Email** habilitado ✅
   - **Allow new users to sign up** → **DESLIGADO** ❌ (ninguém cria conta sozinho)
2. Na mesma área (ou em **Policies/Passwords**):
   - **Minimum password length:** `8` (recomendo `12`)
   - **Password requirements:** **Lowercase, uppercase letters, digits and symbols**
3. **URL Configuration**:
   - **Site URL:** `https://financaspessoais.couveflorrefeicoes.com.br`
   - (Usado nos e-mails de "esqueci minha senha".)
4. **Save** em cada tela.

## Passo 4 — Criar as duas contas

**Authentication → Users → Add user → Create new user**:

| Campo | Renan | Camilla |
|---|---|---|
| Email | seu e-mail | e-mail da Camilla |
| Password | senha forte (regra do passo 3) | senha forte |
| Auto Confirm User | ✅ marcado | ✅ marcado |

> Dica: a Camilla pode trocar a senha depois pelo próprio app (Fase 3, tela Perfil).

## Passo 5 — Criar a família (rodar `002_bootstrap_familia.sql`)

1. Abra `sql/002_bootstrap_familia.sql` no VS Code e **copie tudo**.
2. SQL Editor → **New query** → cole.
3. **No editor do Supabase** (não precisa salvar no arquivo), troque:
   - `EMAIL_DO_RENAN@exemplo.com` → seu e-mail do passo 4
   - `EMAIL_DA_CAMILLA@exemplo.com` → e-mail da Camilla
4. **Run**. Resultado esperado: uma tabela com **2 linhas** (Renan e Camilla) e **22** na coluna categorias.

> Os e-mails reais ficam só no Supabase. Não salve o arquivo com eles, para não irem para o GitHub.

## Passo 6 — Conferir a segurança (rodar `003_verificacao.sql`)

1. SQL Editor → **New query** → cole `sql/003_verificacao.sql` → **Run**.
2. **Todas** as linhas devem mostrar **OK**. Se alguma mostrar FALHA, me mande o print.

## Passo 7 — Anotar a URL e a chave pública

Menu **Project Settings** (engrenagem) → **API Keys** (ou **Data API**):

| O que copiar | Onde está | Guardar como |
|---|---|---|
| **Project URL** | `https://xxxxxxxx.supabase.co` | `SUPABASE_URL` |
| **Publishable key** (ou **anon public**, na aba "Legacy") | começa com `sb_publishable_…` ou `eyJ…` | `SUPABASE_ANON_KEY` |

> 🚫 **NÃO copie** a `secret` / `service_role` key. Ela ignora toda a segurança e nunca deve sair do painel.

## Passo 8 — Cadastrar os Secrets no GitHub

1. Abra **https://github.com/Renan1/sistemafinanceiro-familiar** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Crie os dois:
   - Name: `SUPABASE_URL` → Secret: a Project URL
   - Name: `SUPABASE_ANON_KEY` → Secret: a publishable/anon key
3. Teste o "mantenha acordado": aba **Actions** → **Manter Supabase ativo** → **Run workflow**. Ao terminar (✅), abra a execução: deve aparecer `Supabase respondeu: "ok 2026-…"`.

> Os workflows só aparecem na aba Actions depois que esta fase estiver na branch principal (`main`). Até lá, pule o teste do item 3 — fazemos juntos.

## Pronto ✅

Checklist da Fase 1:

- [ ] Projeto criado em São Paulo
- [ ] `001_schema.sql` executado sem erro
- [ ] Cadastro público desligado + política de senha
- [ ] Contas do Renan e da Camilla criadas
- [ ] `002_bootstrap_familia.sql` → 2 membros, 22 categorias
- [ ] `003_verificacao.sql` → tudo OK
- [ ] URL e chave pública anotadas no gerenciador de senhas
- [ ] Secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` no GitHub

Me avise quando concluir (ou mande print de qualquer erro) para seguirmos para a **Fase 2**.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `relation "auth.users" does not exist` | Rodou em outro banco que não o Supabase | Rode no SQL Editor do Supabase |
| `already exists` ao rodar o 001 | Rodou o 001 duas vezes | Me avise; faço um script de limpeza |
| 002: `Usuário ... não encontrado` | E-mail digitado diferente do passo 4 | Confira em Authentication → Users |
| Projeto "Paused" | Ficou 7+ dias sem uso antes do ping estar ativo | Botão **Restore project** no painel; nada se perde |
