# Fase 5 — Saúde financeira, exportação e Skill do Claude (guia)

## Passo 1 — Atualizar o banco (uma vez, ANTES do merge)

Supabase → **SQL Editor → New query** → cole `sql/005_fase5_saude.sql` → **Run** → "Success".

> Sem ele, os alertas não são gravados (as tarefas e a exportação funcionam).

## Passo 2 — Publicar

Merge do Pull Request da Fase 5 → o app atualiza sozinho ("✨ Nova versão disponível").

## Passo 3 — Instalar a Skill no Claude

Veja `claude-skill/README.md`. Resumo:
```powershell
Set-Location C:\Projetos\sistemafinanceiro-familiar
git pull
Compress-Archive -Path claude-skill\consultor-financeiro -DestinationPath consultor-financeiro.zip -Force
```
claude.ai → **Configurações → Capabilities → Skills → Upload skill** → `consultor-financeiro.zip` → ativar.

**Teste a Skill com o exemplo** (dados fictícios): anexe `claude-skill/consultor-financeiro/exemplos/export-exemplo.json` e peça *"Analise com o Consultor Financeiro Familiar"*. Compare com `exemplos/resposta-exemplo.md` — saldo de outubro R$ 6.854,70, poupança 55,7%, Delivery a 158% do orçamento.

---

## O que mudou no app

### 🩺 Nova aba **Saúde**
- **Alertas** do mês, do mais grave ao mais leve: ⛔ crítico · ⚠️ atenção · ℹ️ info — por visão (Eu / Camilla / Família).
- **Selo vermelho** na aba com a quantidade de alertas da família ainda não lidos. "Marcar como lidos" zera.
- **Tarefas** da família com **checkbox** (feita), ✕ (descartar), "+ Nova tarefa" e "Concluídas e descartadas".
- **✨ Importar tarefas do Claude**: cole a resposta da Skill (ou escolha o arquivo) → prévia → importar. Reimportar o mesmo bloco não duplica.
- **⟳ Reavaliar agora**: recalcula na hora. Automático: ao abrir o app com internet, no máximo a cada 6 h.

### As 9 regras (limites em `js/regras.js` → `LIMITES`)

| Regra | Dispara quando | Severidade | Cria tarefa? |
|---|---|---|---|
| Gastos > ganhos | gastos do mês passam os ganhos | ⛔ crítico | sim (alta) |
| Orçamento | categoria ≥ 80% do orçamento (⚠️) ou ≥ 100% (⛔) | ⚠️/⛔ | só se estourou |
| Acima da média | categoria > 30% acima da média dos últimos 3 meses (média ≥ R$ 100) | ⚠️ | sim (média) |
| Parcelas futuras | parcelas dos próximos 3 meses > 30% da renda média | ⚠️ | sim (alta) |
| Fixos altos | gastos fixos > 50% da renda do mês | ⚠️ | sim (média) |
| Poupança baixa | taxa de poupança < 10% (negativa = ⛔) | ⚠️/⛔ | sim (média) |
| Compras pequenas | > 15 compras < R$ 30 em restaurante/delivery/lanche | ℹ️ | sim (baixa) |
| Assinaturas | jan/abr/jul/out: lista as recorrências de Assinaturas | ℹ️ | sim (baixa) |
| Sem ganho | mês sem nenhum ganho (mês atual: só a partir do dia 10) | ⚠️ | sim (alta) |

Tarefas de regra são **da família** e nunca duplicam: enquanto houver uma aberta da mesma regra, outra não é criada. Depois de concluída, pode voltar se a situação se repetir.

### 📤 Mais → Exportar dados
- **JSON do mês para o Claude** (sem e-mails, ids ou GPS) — o mês que acabou já vem selecionado.
- **CSV do mês** — abre no Excel (separador `;`, vírgula decimal, acentos ok).
- **Backup completo** — todas as tabelas.
- **Compartilhar** (iPhone: manda direto para o app do Claude, Arquivos, WhatsApp…) ou **Baixar**.

## Rotina mensal (5 minutos, todo início de mês)

1. App → **Mais → Exportar dados** → **Gerar JSON do mês** → **Compartilhar** para o Claude.
2. No Claude: *"Analise com o Consultor Financeiro Familiar"*.
3. Leiam juntos o diagnóstico e os conselhos.
4. Copie o bloco de tarefas → App → **Saúde → ✨ Importar tarefas do Claude**.
5. Gere o **Backup completo** e guarde no PC/nuvem.

## Roteiro de testes no celular

- [ ] Rodou o `005` no Supabase.
- [ ] Abra o app: em alguns segundos, se houver alertas, aparece o **selo** na aba Saúde.
- [ ] **Saúde**: alertas do mês aparecem; troque Eu / Camilla / Família.
- [ ] **Orçamento**: defina um orçamento baixo numa categoria que já tem gasto → **Reavaliar agora** → aparece o alerta ⚠️ ou ⛔.
- [ ] **Tarefas**: marque uma como feita (checkbox); descarte outra (✕); crie uma manual.
- [ ] **Camilla** vê as mesmas tarefas da família e consegue concluir.
- [ ] **Exportar**: gere o JSON de um mês com lançamentos → Compartilhar → envie ao Claude com a Skill.
- [ ] **Importar**: cole a resposta do Claude em Saúde → Importar tarefas → as tarefas aparecem com ✨ Claude.
- [ ] **Reimportar** o mesmo bloco → "nada novo para importar".
- [ ] **CSV**: abra no Excel — acentos e valores corretos.
- [ ] **Backup completo**: gera e baixa.
