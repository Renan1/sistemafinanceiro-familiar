# Melhorias depois da v1.0 — guia de atualização e testes

Cada melhoria é uma versão, no fluxo de sempre: Pull Request → testes → **você roda o SQL novo (se houver) ANTES do merge** → merge → o app se atualiza sozinho.

| Versão | O que traz | SQL novo |
|---|---|---|
| **v1.1** | Compra parcelada **com juros** (informar pelo valor da parcela + preço à vista) | `sql/006_v11_parcela_com_juros.sql` |
| v1.2 | Importar extrato/fatura (Itaú, Nubank) com classificação automática | (a definir) |
| v1.3 | Compras da Carteira do iPhone direto para o app (Atalhos) | (a definir) |

---

## v1.1 — Parcela com juros

### Passo 1 — Banco (antes do merge)
Supabase → **SQL Editor → New query** → cole `sql/006_v11_parcela_com_juros.sql` → **Run** → "Success".

> Sem ele, a lista de lançamentos não carrega depois do merge (ela passa a ler a coluna nova).

### Passo 2 — Merge do PR → "✨ Nova versão disponível" no app.

### Passo 3 — Atualizar a Skill do Claude (a Skill agora comenta os juros)
```powershell
Set-Location C:\Projetos\sistemafinanceiro-familiar
git pull
Compress-Archive -Path claude-skill\consultor-financeiro -DestinationPath consultor-financeiro.zip -Force
```
claude.ai → **Configurações → Capabilities → Skills** → remova a antiga → **Upload skill** → `consultor-financeiro.zip`.

### Como usar
No **Gasto → Crédito**, aparece **"Valor total | Valor da parcela"**:

| Situação na loja | Como lançar |
|---|---|
| "R$ 1.000 em 3x sem juros" | **Valor total** (como sempre): digite 1.000,00 → 3x |
| "12x de R$ 189,90" (com juros) | **Valor da parcela**: digite 189,90 → 12x. O app mostra "12x de R$ 189,90 = R$ 2.278,80" |
| Quer saber quanto pagou de juros | Preencha **Preço à vista** (ex.: 2.000,00) → "Juros: R$ 278,80 (13,9% a mais) · ≈ 2,1% ao mês" |

- As parcelas saem **exatamente** iguais às da loja (sem centavo de arredondamento).
- O preço à vista é opcional e só aparece com 2x ou mais.
- **Lançamentos** mostra "12x · juros R$ 278,80"; o **CSV** ganhou a coluna `juros`; o **JSON para o Claude** leva `juros` em cada compra.

### Roteiro de testes no celular
- [ ] Rodou o `006` no Supabase.
- [ ] Gasto → Crédito → **Valor da parcela** → 189,90 → 12x: prévia "12x de R$ 189,90 = R$ 2.278,80".
- [ ] Preço à vista 2.000,00 → aparece "Juros: R$ 278,80 (13,9% a mais) · ≈ 2,1% ao mês". Salvar.
- [ ] **Lançamentos**: o gasto aparece com R$ 2.278,80 e "juros R$ 278,80".
- [ ] **Painel** do mês da 1ª fatura: entra R$ 189,90 (e não o total).
- [ ] Toque no gasto → editar: abre com R$ 2.278,80 e o preço à vista preenchido.
- [ ] Compra sem juros (**Valor total**, 1.000,00 em 3x) continua 333,34 + 333,33 + 333,33.
- [ ] Preço à vista **maior** que o total → aviso e não salva.
- [ ] Depois dos testes, exclua esses gastos (ou deixe para a limpeza geral no fim da v1.3).
