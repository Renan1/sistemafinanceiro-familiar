# Fase 2 — Publicar o app e instalar no celular (passo a passo)

Tempo estimado: 30 minutos (mais a espera do certificado HTTPS, que pode levar até 1 hora).

Resultado final: o app funcionando em **https://financaspessoais.couveflorrefeicoes.com.br**, instalado na Tela de Início do seu celular e do da Camilla.

---

## Passo 1 — Criar a branch `main` (a que vai para o ar)

A branch `main` é a versão **publicada**. O desenvolvimento acontece em outra branch e entra na `main` quando a fase estiver aprovada (docs/CONVENCOES.md).

No PowerShell, na pasta do projeto:

```powershell
Set-Location C:\Projetos\sistemafinanceiro-familiar
git fetch origin
git push origin origin/claude/financas-familia-pwa-319ept:refs/heads/main
```

Depois, no GitHub: **Settings → General → Default branch** → clique no ícone ⇄ → escolha **main** → **Update** → confirme.

> Das próximas fases em diante, cada fase entra na `main` por um **Pull Request** (com os testes ✅ antes).

## Passo 2 — Ligar o GitHub Pages

1. Repositório → **Settings → Pages**.
2. **Build and deployment → Source:** **GitHub Actions**.
3. Aba **Actions** → workflow **Publicar app** → **Run workflow** → branch `main` → **Run workflow**.
4. Aguarde ✅ (1–2 min). Ele roda os testes, gera o `config.js` com os Secrets e publica.
5. Teste no navegador do PC: `https://renan1.github.io/sistemafinanceiro-familiar/` — deve aparecer a tela de login.

## Passo 3 — Subdomínio no Cloudflare

1. **Cloudflare** → seu domínio `couveflorrefeicoes.com.br` → **DNS → Records → Add record**:

   | Campo | Valor |
   |---|---|
   | Type | `CNAME` |
   | Name | `financaspessoais` |
   | Target | `renan1.github.io` |
   | Proxy status | **DNS only** (nuvem **cinza**) |
   | TTL | Auto |

   > A nuvem cinza é importante: com a nuvem laranja o GitHub não consegue emitir o certificado HTTPS.

2. **GitHub → Settings → Pages → Custom domain:** `financaspessoais.couveflorrefeicoes.com.br` → **Save**.
3. Aguarde o **DNS check successful** ✅ (alguns minutos).
4. Marque **Enforce HTTPS**. (Se estiver cinza, o certificado ainda está sendo emitido — volte em até 1 hora.)
5. Abra `https://financaspessoais.couveflorrefeicoes.com.br` → tela de login ✅

**Recomendado (segurança):** verifique o domínio no GitHub, para ninguém mais conseguir usar esse subdomínio em outro repositório:
GitHub → sua foto → **Settings → Pages → Add a domain** → `couveflorrefeicoes.com.br` → o GitHub mostra um registro **TXT** → crie esse TXT no Cloudflare (DNS → Add record → Type TXT) → volte e clique **Verify**.

> O arquivo `CNAME` na raiz do repositório registra o domínio no projeto. Com a publicação por GitHub Actions, quem vale é a configuração do passo 2 — mantenha os dois iguais.

## Passo 4 — Liberar o endereço no Supabase

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://financaspessoais.couveflorrefeicoes.com.br` (já feito na Fase 1)
- **Redirect URLs** → **Add URL**:
  - `https://financaspessoais.couveflorrefeicoes.com.br/**`
  - `http://localhost:3000/**` (para testar no PC)

Isso é o que permite o link de "Esqueci minha senha" voltar para o app.

## Passo 5 — Instalar no celular

> Instale **primeiro** e faça login **dentro do app instalado**: no iPhone o app da Tela de Início tem login separado do Safari.

**iPhone (Safari):**
1. Abra o **Safari** (precisa ser o Safari) → `financaspessoais.couveflorrefeicoes.com.br`
2. Toque em **Compartilhar** (quadrado com seta para cima).
3. Role e toque em **Adicionar à Tela de Início** → **Adicionar**.
4. Abra pelo ícone **Finanças** na Tela de Início → faça login.
5. Quando pedir **localização**, toque em **Permitir** (ou negue — o app funciona igual, só sem o mapa).

**Android (Chrome):**
1. Abra no **Chrome** → menu **⋮** → **Instalar app** (ou **Adicionar à tela inicial**).
2. Abra pelo ícone → login.

Repita no celular da Camilla com a conta dela.

## Passo 6 — Roteiro de testes (critérios de aceite)

Faça no celular, pelo app instalado. Marque cada um:

- [ ] **Login**: senha errada mostra "E-mail ou senha incorretos"; a certa abre **Novo gasto**.
- [ ] **Cartão**: Mais → Cartões → cadastre um cartão real (apelido, bandeira, 4 finais, fechamento, vencimento).
- [ ] **CA-02 — Parcelas**: Novo gasto → digite `100000` (R$ 1.000,00) → Crédito → cartão → **3x** → a prévia mostra "3x de R$ 333,33 — 1ª em <mês> (1ª de R$ 333,34)". Confira se o mês bate com o fechamento do seu cartão. Salve.
- [ ] **Registro rápido**: um gasto de PIX (valor → categoria → Salvar) em menos de 10 segundos.
- [ ] **CA-01 / CA-05 — Modo avião**: ative o modo avião → registre um gasto → aparece "Salvo ✓ no aparelho" e o indicador "⏳ 1 aguardando sinal" → **feche o app** (arraste para cima) → abra de novo, ainda em modo avião: o app abre e o indicador continua → desligue o modo avião e volte ao app → indicador vira "✓ Tudo sincronizado". Em **Lançamentos**, o gasto aparece **uma vez só**.
- [ ] **CA-04 — Localização negada**: Ajustes do iPhone → Privacidade → Serviços de Localização → Safari/site → Nunca. Registre um gasto: salva normalmente.
- [ ] **Ganho**: Novo ganho → valor → Salário (vira "Fixo" sozinho) → Salvar.
- [ ] **CA-03 — Visão da família**: no celular da Camilla, **Painel → Família** mostra os seus gastos também; **Lançamentos** lista os seus com o seu nome.
- [ ] **Painel**: ganhos, gastos, saldo e taxa de poupança do mês batem com o que foi lançado.

Se algo falhar: **Mais → Diagnóstico → Copiar logs** e me mande (os logs não contêm senha nem chave).

### Depois dos testes: zerar os lançamentos de teste

Os testes gravam dados **reais** no banco. Para começar o uso de verdade do zero:

1. Nos dois celulares, com internet, confira **"✓ Tudo sincronizado"** no topo (nada pendente).
2. Supabase → SQL Editor → cole `sql/manutencao/limpar_lancamentos_teste.sql`:
   - rode a **Parte 1** (prévia) e confira as quantidades;
   - na **Parte 2**, troque `v_confirmo := false` por `true` e rode;
   - rode a Parte 1 de novo: tudo zerado.
3. Feche e abra o app nos celulares.

Apaga só gastos, parcelas, ganhos e alertas. **Mantém** família, usuários, categorias, cartões, recorrências e orçamentos.

---

## Rodar o app no PC (opcional, para testar alterações)

```powershell
Set-Location C:\Projetos\sistemafinanceiro-familiar
Copy-Item js\config.exemplo.js js\config.js   # uma vez; depois edite com URL e chave
code js\config.js                            # cole a Project URL e a publishable/anon key
npm run dev                                  # abre em http://localhost:3000
```

`js/config.js` está no `.gitignore` — nunca vai para o GitHub.

Rodar os testes:

```powershell
npm test
```

## Como as atualizações chegam ao celular

Toda vez que algo entra na `main`, o GitHub publica sozinho. No celular, na próxima abertura com internet, aparece a faixa **"✨ Nova versão disponível — toque para atualizar"**. Tocar recarrega o app na versão nova. Lançamentos pendentes não são afetados.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Workflow "Publicar app" falha em *deploy* | Pages não está em "GitHub Actions" | Passo 2, item 2; depois **Re-run jobs** |
| Workflow falha em "Montar a pasta do site" | Secrets ausentes | docs/fase1-supabase.md, passo 8 |
| "DNS check unsuccessful" | Registro CNAME errado ou nuvem laranja | Confira o passo 3 (Target `renan1.github.io`, DNS only) |
| "Enforce HTTPS" cinza | Certificado sendo emitido | Aguarde até 1 hora |
| Tela "Configuração ausente" | Rodando no PC sem `js/config.js` | Veja "Rodar o app no PC" |
| "Conta sem família" | Usuário não ligado à família | Rode de novo o `sql/002_bootstrap_familia.sql` com o e-mail certo |
| Link de "esqueci minha senha" abre página de erro | Redirect URL não liberada | Passo 4 |
