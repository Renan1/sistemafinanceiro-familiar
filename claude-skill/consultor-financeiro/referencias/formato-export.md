# Formato `financas-familia/export@1`

Gerado pelo app em **Mais → Exportar dados → Gerar JSON do mês** (código: `js/exportacao.js`, função `montarExport`). Exemplo completo (dados fictícios): `../exemplos/export-exemplo.json`.

> **Todos os valores monetários estão em centavos** (inteiros). `100` = R$ 1,00.
> Datas: `AAAA-MM-DD`. "Competência" = 1º dia do mês a que o valor pertence (`2026-10-01` = outubro/2026).

## Campos

| Campo | Tipo | Conteúdo |
|---|---|---|
| `formato` | texto | Sempre `"financas-familia/export@1"`. Mudanças incompatíveis viram `@2`. |
| `gerado_em` | data/hora ISO | Quando o arquivo foi gerado. |
| `moeda` | texto | `"BRL"`. |
| `valores_em` | texto | Lembrete: centavos. |
| `familia.nome` | texto | Nome da família. |
| `familia.membros` | lista de textos | Nomes das pessoas (use exatamente estes nomes em `responsavel`). |
| `periodo.competencia` | data | Mês analisado (`AAAA-MM-01`). |
| `periodo.rotulo` | texto | Ex.: `"outubro de 2026"`. |
| `resumo_mensal[]` | lista | Até 6 meses (o analisado e os 5 anteriores). **Uma linha por pessoa + uma linha `"pessoa": "Família"` (soma).** |
| `receitas[]` | lista | Ganhos do mês (pela data). |
| `despesas[]` | lista | Compras do mês (pela data da compra), valor CHEIO. |
| `gastos_por_categoria[]` | lista | Gastos do mês da família por categoria, **pela competência**, com `%`. Ordenado do maior. |
| `parcelas_futuras[]` | lista | 12 meses seguintes: total de parcelas de cartão já comprometidas e divisão por pessoa. |
| `recorrencias[]` | lista | Gastos e ganhos fixos cadastrados. |
| `orcamentos[]` | lista | Orçamento do mês por categoria × realizado (pela competência). |
| `alertas[]` | lista | Alertas do motor de regras do app no mês. |
| `tarefas[]` | lista | Tarefas abertas e concluídas nos últimos 90 dias. |
| `instrucoes` | texto | Lembrete do fluxo. |

### `resumo_mensal[]`
| Campo | Significado |
|---|---|
| `competencia` | Mês. |
| `pessoa` | Nome, ou `"Família"`. |
| `receitas` | Ganhos do mês. |
| `despesas` | Gastos do mês **pela competência** (parcelas do mês). |
| `despesas_fixas` / `despesas_variaveis` | Divisão dos gastos por natureza. |
| `despesas_cartao` | Parte paga no crédito (faturas do mês). |
| `saldo` | receitas − despesas. |
| `taxa_poupanca_pct` | % da renda que sobrou (null sem ganho). |

### `receitas[]`
`data`, `pessoa`, `categoria`, `descricao`, `valor`, `natureza` (`fixa`/`variavel`), `recorrente` (veio de uma recorrência).

### `despesas[]`
`data_compra`, `pessoa`, `categoria`, `descricao`, `valor_total` (valor cheio da compra), `forma_pagamento` (PIX, Débito, Crédito, Dinheiro, Boleto, Outro), `cartao` (apelido), `parcelas` (1 a 24), `natureza`, `recorrente`, `local` (nome do lugar, se informado), `juros` (centavos pagos a mais que o preço à vista numa compra parcelada; `null` = preço à vista não informado).

> Uma compra de R$ 1.200 em 6x aparece aqui com `valor_total: 120000` e `parcelas: 6`, mas pesa só R$ 200 no mês em `resumo_mensal` e `gastos_por_categoria`.

### `parcelas_futuras[]`
`competencia`, `total`, `por_pessoa` (`{ "Renan": 60000 }`).

### `recorrencias[]`
`tipo` (`ganho`/`gasto`), `descricao`, `valor`, `dia_do_mes`, `categoria`, `pessoa`, `forma_pagamento`, `desde`, `ate` (null = sem fim), `ativa`.

### `orcamentos[]`
`categoria`, `pessoa` (`"Família"` ou nome), `orcado`, `realizado`.

### `alertas[]`
`regra` (código), `severidade` (`critico`/`atencao`/`info`), `mensagem`, `pessoa`.

Códigos das regras: `DESPESA_MAIOR_RECEITA`, `ORCAMENTO_CATEGORIA`, `CATEGORIA_ACIMA_MEDIA`, `PARCELAS_FUTURAS_ALTAS`, `FIXOS_ACIMA_LIMITE`, `POUPANCA_BAIXA`, `MUITAS_COMPRAS_PEQUENAS`, `REVISAR_ASSINATURAS`, `SEM_RECEITA`.

### `tarefas[]`
`titulo`, `descricao`, `prioridade` (1 alta · 2 média · 3 baixa), `status` (`aberta`/`feita`/`descartada`), `origem` (`regra`/`claude`/`manual`), `pessoa`.

## O que NÃO vem no export (privacidade)
E-mails, identificadores internos, coordenadas de GPS e dados de cartão além do apelido.

---

# Formato `financas-familia/tarefas@1` (resposta do Claude → app)

```json
{
  "formato": "financas-familia/tarefas@1",
  "competencia": "2026-10-01",
  "tarefas": [
    { "titulo": "…", "descricao": "…", "prioridade": 1, "responsavel": "Família" }
  ]
}
```

Como o app lê (`lerTarefasDoClaude` em `js/exportacao.js`):
- aceita o JSON puro ou dentro de um bloco ```` ```json ```` no meio do texto;
- `titulo` obrigatório (corta em 120 caracteres); `descricao` opcional (1000);
- `prioridade` fora de 1–3 vira 2;
- `responsavel` = `"Família"` ou nome de um membro (sem diferenciar maiúsculas); nome desconhecido vira Família, com aviso;
- no máximo 20 tarefas; tarefas já abertas com o mesmo título são ignoradas (reimportar não duplica).
