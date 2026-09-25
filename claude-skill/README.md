# Skill do Claude — Consultor Financeiro Familiar

Pasta: `consultor-financeiro/`

| Arquivo | O que é |
|---|---|
| `SKILL.md` | A Skill: como analisar o export e o formato da resposta |
| `referencias/formato-export.md` | Dicionário do JSON exportado e do JSON de tarefas |
| `referencias/mcp-supabase.md` | Como, no futuro, conectar direto no Supabase (MCP) |
| `exemplos/export-exemplo.json` | Export de exemplo (dados FICTÍCIOS), gerado pelo próprio código do app |
| `exemplos/resposta-exemplo.md` | Como deve ficar uma resposta para o exemplo |

## Instalar no Claude (uma vez)

1. **Compactar a pasta** (PowerShell, na pasta do projeto):
   ```powershell
   Compress-Archive -Path claude-skill\consultor-financeiro -DestinationPath consultor-financeiro.zip -Force
   ```
2. **claude.ai → Configurações → Capabilities (Recursos) → Skills → Upload skill** → escolha `consultor-financeiro.zip`.
3. Ative a Skill. (No celular, as Skills instaladas no claude.ai valem também no app do Claude.)

> Os nomes dos menus do Claude podem mudar; procure por "Skills".

## Rotina mensal (5 minutos)

1. **Todo início de mês**, no app Finanças: **Mais → Exportar dados** → o mês que acabou já vem selecionado → **Gerar JSON do mês** → **Compartilhar** (ou Baixar).
2. **No Claude**: anexe o arquivo `financas-AAAA-MM.json` e escreva: *"Analise com o Consultor Financeiro Familiar"*.
3. Leia o diagnóstico e os conselhos com a Camilla.
4. **Copie o bloco de tarefas** da resposta → no app: **Saúde → ✨ Importar tarefas do Claude** → cole → **Ver prévia** → **Importar**.
5. Aproveite e gere o **Backup completo** (mesma tela) e guarde no PC/nuvem.

## Testar a Skill antes de usar com dados reais

Anexe `exemplos/export-exemplo.json` e peça a análise. Compare com `exemplos/resposta-exemplo.md`: os números precisam bater (ex.: saldo de outubro R$ 6.854,70; poupança 55,7%; Restaurante/Delivery 158% do orçamento).
