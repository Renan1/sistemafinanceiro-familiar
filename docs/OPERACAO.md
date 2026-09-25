# Operação — manual de uso e manutenção (v1.0.0)

O sistema está completo. Este guia diz **o que fazer de rotina**, **o que vigiar** e **o que fazer quando algo der errado**. Nada aqui exige programar.

---

## 0. Começar o uso real (uma vez)

Os dados de teste (gastos, ganhos, alertas, tarefas e, se quiser, cartões, recorrências e orçamentos) saem com um script. Não precisa apagar nada na mão.

1. Nos **dois celulares**, abra o app com internet e confira **"✓ Tudo sincronizado"** no topo.
2. (Opcional) **Mais → Exportar dados → Backup completo**, para guardar o teste.
3. Supabase → **SQL Editor** → cole `sql/manutencao/limpar_lancamentos_teste.sql`:
   - rode a **PARTE 1** (prévia);
   - na **PARTE 2**, escolha o que mais apagar (`true`/`false`), troque `v_confirmo` para `true` e rode;
   - rode a **PARTE 1** de novo: tudo zerado (as categorias ficam).
4. No app: exclua as **categorias** criadas no teste (Mais → Categorias). Cadastre ou confira os **cartões**, as **recorrências** (salário, aluguel, assinaturas) e os **orçamentos** reais.
5. Feche e abra o app nos dois celulares. Pronto para os dados reais.

---

## 1. Rotinas

### Todo dia (segundos)
- Lançar gastos na hora (**Gasto** é a tela inicial). Sem sinal, tudo bem: o gasto fica no celular e sobe sozinho depois.

### Todo início de mês (5–10 minutos, a dois)
1. **Painel** → mês que acabou → **Família**: leiam juntos ganhos, gastos, saldo e previsto × realizado.
2. **Mais → Exportar dados → Gerar JSON do mês** → **Compartilhar** para o Claude.
3. No Claude: *"Analise com o Consultor Financeiro Familiar"*.
4. Copie o bloco de tarefas → **Saúde → ✨ Importar tarefas do Claude**.
5. **Mais → Exportar dados → Backup completo** → guarde no PC ou na nuvem (pasta `Backups Finanças`, um arquivo por mês).
6. Ajustem **orçamentos** e **recorrências** que mudaram (reajustes, assinaturas novas/canceladas).

### A cada 3 meses (jan, abr, jul, out)
- O app cria sozinho a tarefa **"Revisar assinaturas"**. Façam a revisão e marquem como feita.
- Confiram no GitHub → **Actions → Manter Supabase ativo** que as últimas execuções estão verdes (✅).

### Uma vez por ano
- Revisar os limites das regras (seção 4) — a renda e o padrão de gastos mudam.
- Apagar backups muito antigos se quiserem (guardar pelo menos os 12 últimos).

---

## 2. O que vigiar

| Sinal | Onde aparece | O que fazer |
|---|---|---|
| E-mail do GitHub: *"scheduled workflow disabled"* | Sua caixa de entrada | O GitHub desliga agendamentos após **60 dias sem commits**. GitHub → Actions → **Manter Supabase ativo** → **Enable workflow** → **Run workflow**. |
| E-mail do Supabase: *"project will be paused"* | Sua caixa de entrada | Abra o app (qualquer uso conta) **e** reative o workflow acima. |
| Indicador de pendentes que não zera | Topo do app | Toque no indicador para enviar. Se algo foi **recusado**, veja a seção 3. |
| Selo vermelho na aba **Saúde** | Barra de abas | Alertas do mês não lidos. Leiam e toquem **Marcar como lidos**. |

---

## 3. Quando algo der errado

| Problema | Causa provável | Solução |
|---|---|---|
| App abre e pede login toda hora | Sessão expirou (normal após muitos dias) | Faça login de novo; nada da fila se perde. |
| "Esqueci minha senha" não chega | E-mail na caixa de spam / limite de envios do Supabase | Olhe o spam; espere 1 hora e tente de novo. |
| App não abre / tela branca | Versão antiga presa no cache | Feche e abra de novo. Se persistir: **Mais → Diagnóstico → Copiar logs** e me mande. |
| Lançamento marcado como **recusado** | Dado inválido (ex.: cartão excluído) | Aba **Lançam.** → no item recusado → **Tentar de novo** ou **Descartar**. |
| Supabase pausado (app não carrega dados) | Mais de 7 dias sem uso e ping desligado | supabase.com → projeto → **Restore project** (1–2 min). Depois reative o workflow (seção 2). Os dados **não** se perdem. |
| Site fora do ar | GitHub Pages / Cloudflare | Veja se o último **Publicar app** em Actions está verde; em Settings → Pages, confirme o domínio e *Enforce HTTPS*. |

Para qualquer outra coisa: **Mais → Diagnóstico → Copiar logs** (sem senha nem chave) e me mande junto com um print.

---

## 4. Ajustes comuns (sem mexer no banco)

| Quero… | Onde |
|---|---|
| Mudar o orçamento de uma categoria | App → **Mais → Orçamentos** |
| Criar/renomear/excluir categoria | App → **Mais → Categorias** (excluir move os lançamentos para outra) |
| Salário novo a partir de um mês | App → **Mais → Recorrências** → tocar no salário → **Alterar valor a partir de…** |
| Cartão novo / trocar vencimento | App → **Mais → Cartões** |
| Mudar os limites das regras (ex.: poupança mínima de 10% para 15%) | Arquivo `js/regras.js` → objeto `LIMITES`. É uma mudança de código: peça numa nova sessão, que eu faço com teste e Pull Request. |

---

## 5. Backup e restauração

- O **backup completo** (`financas-backup-AAAA-MM-DD.json`, formato `financas-familia/backup@1`) tem todas as tabelas da família.
- O plano gratuito do Supabase **não** faz backup automático — por isso o backup mensal é importante.
- **Restaurar** não tem botão no app (é raro e delicado). Se um dia precisar, guarde o arquivo e me peça: a restauração é feita pelo SQL Editor do Supabase a partir do JSON.

---

## 6. Segurança (lembretes)

- Senhas **só** no gerenciador de senhas. Nada de senha ou chave em arquivos, commits ou prints.
- A chave `service_role` do Supabase **nunca** vai para o app nem para o GitHub.
- Não existe cadastro público: um usuário novo só entra se for criado no Supabase **e** ligado à família (`sql/002_bootstrap_familia.sql`).
- **Atalho do iPhone (v1.2):** a chave pessoal fica só no app Atalhos. Trocou de celular, perdeu o aparelho ou desconfia que vazou? **Mais → Atalho do iPhone → Revogar** e crie outra. Ela só consegue colocar compras na sua caixa de entrada: não lê nada.
- Trocou de celular? Basta instalar o app de novo e fazer login. Perdeu o celular? Troque a senha em **Mais → Perfil** (ou pelo "Esqueci minha senha" em outro aparelho).

---

## 7. Evoluir o sistema

O fluxo continua o mesmo das fases: nova sessão comigo → branch → testes → Pull Request → você roda o SQL novo (se houver) → merge → o app se atualiza sozinho.

**Marcar uma versão (Release)** — depois do merge de uma versão nova (ex.: `v1.0.0`):
GitHub → repositório → **Releases** → **Draft a new release** → **Choose a tag** → digite `v1.0.0` → **Create new tag on publish** (alvo: `main`) → título `v1.0.0` → cole a seção da versão do `CHANGELOG.md` → **Publish release**.

Ideias já previstas (docs/REQUISITOS.md §10): importação de fatura do cartão (PDF/CSV/OFX), metas de economia, verificação em duas etapas no login. Também já documentado: leitura direta pelo Claude via MCP (`claude-skill/consultor-financeiro/referencias/mcp-supabase.md`).
