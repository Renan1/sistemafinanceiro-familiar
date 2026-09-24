# Fase 3 — Lançamentos, recorrências, categorias, orçamentos (guia)

## Passo 1 — Atualizar o banco (uma vez)

Supabase → **SQL Editor → New query** → cole `sql/004_fase3_recorrencias.sql` → **Run**.
Resultado esperado: **"Success. No rows returned"**.

> Faça isso **antes** de publicar a Fase 3 (antes do merge do Pull Request). Sem ele, só a ação "alterar valor a partir de um mês" falha; o resto funciona.

## Passo 2 — Publicar

No GitHub, abra o **Pull Request da Fase 3** → confira que os testes estão ✅ → **Merge pull request**. O workflow "Publicar app" coloca no ar em 1–2 minutos. No celular, aparece **"✨ Nova versão disponível — toque para atualizar"**.

## O que mudou no app

### Lançamentos (aba 📋)
- **Filtros**: pessoa (Todos / Eu / Camilla), tipo (Tudo / Gastos / Ganhos), categoria, forma de pagamento, fixo/variável.
- **Busca** por descrição, categoria ou local (ignora acentos: "farmacia" acha "Farmácia").
- **Totais** do que está filtrado (gastos, ganhos, quantidade).
- **Toque num lançamento seu → editar ou excluir.** Os da Camilla aparecem, mas só ela altera (e vice-versa).
  - Editar um gasto parcelado recalcula **todas** as parcelas.
  - Funciona **sem internet**: a alteração aparece na hora com "⏳ aguardando envio" e sobe sozinha depois.

### Mais → 🔁 Recorrências (gastos e ganhos fixos)
Cadastre uma vez o que se repete todo mês — **salário, pró-labore, aluguel, internet, streaming, escola…**
- O app **lança sozinho** o mês atual (e meses que ficaram para trás) ao abrir com internet — **sem duplicar**, mesmo abrindo em dois celulares.
- Tocar numa recorrência sua: **alterar valor a partir de um mês** (ex.: aumento de salário em outubro — setembro fica com o valor antigo), **pausar/retomar**, **encerrar** ou **excluir** (os lançamentos já feitos continuam).
- Se o início for num mês passado, lança desde lá (até 24 meses).

### Mais → 🏷️ Categorias
Criar, editar (nome, emoji, cor, ordem), **desativar** (some das telas, histórico fica) e **excluir**. Se a categoria estiver em uso, o app pergunta **para qual mover** os lançamentos.

### Mais → 🎯 Orçamentos
Valor mensal por categoria — **da família** ou individual (Eu / Camilla). O Painel vai comparar orçado × realizado na Fase 4, e os alertas de 80%/100% chegam na Fase 5.

### Mais → 💳 Cartões
Agora também dá para **editar** (apelido, fechamento, vencimento, limite). Mudanças valem para as próximas compras.

### Mais → 👤 Perfil
Nome, cor de identificação e **trocar senha**.

## Roteiro de testes no celular

- [ ] **Recorrência de ganho**: Mais → Recorrências → Ganho fixo → "Salário" → valor → categoria Salário → dia → Salvar. Aparece "🔁 1 lançamento(s) fixo(s)"; em Lançamentos, o salário do mês com "🔁 fixo".
- [ ] **Sem duplicar**: feche e abra o app → o salário continua aparecendo **uma vez**.
- [ ] **Recorrência de gasto no crédito**: Internet/streaming no cartão → o lançamento do mês aparece com o cartão.
- [ ] **Alterar valor a partir de um mês**: toque na recorrência → "Alterar valor" → novo valor, mês atual → o lançamento do mês muda de valor.
- [ ] **Editar**: Lançamentos → toque num gasto seu → mude o valor → Salvar alterações. Aparece uma vez só, com o valor novo.
- [ ] **Editar parcelado**: um gasto 3x → mude para 6x → no Painel dos próximos meses, as parcelas mudam.
- [ ] **Excluir**: toque num gasto → Excluir → some da lista (e do Painel).
- [ ] **Editar sem internet**: modo avião → edite um lançamento → aparece "⏳ aguardando envio" com o valor novo → desligue o modo avião → "✓ Tudo sincronizado".
- [ ] **Não edita o do cônjuge**: toque num lançamento da Camilla → "Só Camilla pode alterar".
- [ ] **Filtros e busca**: filtre por Eu/Camilla, Gastos, uma categoria; busque por uma descrição.
- [ ] **Categoria**: crie "Padaria 🥖"; ela aparece em Novo gasto. Exclua uma categoria que tenha lançamentos → escolha para onde mover.
- [ ] **Orçamento**: defina R$ 600 em Restaurante/Delivery (Família).
- [ ] **Perfil**: mude sua cor → aparece no topo de Mais.
