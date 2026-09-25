# Melhorias depois da v1.0 — guia de atualização e testes

Cada melhoria é uma versão, no fluxo de sempre: Pull Request → testes → **você roda o SQL novo (se houver) ANTES do merge** → merge → o app se atualiza sozinho.

| Versão | O que traz | SQL novo |
|---|---|---|
| **v1.1** | Compra parcelada **com juros** (informar pelo valor da parcela + preço à vista) | `sql/006_v11_parcela_com_juros.sql` |
| **v1.2** | Compras da **Carteira do iPhone** direto no app (Atalhos + caixa de entrada) | `sql/007_v12_carteira_iphone.sql` |
| v1.3 | Importar extrato/fatura (Itaú, Nubank) com classificação automática | (a definir) |

> A Carteira saiu antes da importação de extrato (que depende dos arquivos dos bancos), por isso virou a v1.2.

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

---

## v1.2 — Compras da Carteira do iPhone direto no app

**Como funciona:** quando você paga **aproximando o iPhone ou o relógio**, o app **Atalhos** manda valor, estabelecimento e cartão para a sua **caixa de entrada** no app. Na tela **Gasto** aparece "📥 N compras da Carteira para lançar". Tocar em **Lançar** abre o gasto já preenchido: você confere a categoria e salva.

- **Não pega** compra com o cartão físico, PIX nem compra online fora da Carteira. Essas você lança como sempre (ou pela importação de extrato, na v1.3).
- **Segurança:** cada pessoa tem uma **chave própria** para o atalho.
  - A chave só consegue **colocar** compras na caixa de entrada dela; não lê nada.
  - O banco guarda só um código (hash) da chave.
  - Dá para **revogar** a qualquer momento.
- **O app aprende:**
  - na 2ª compra no mesmo lugar, a categoria já vem escolhida;
  - o cartão é reconhecido pelo nome que aparece na Carteira;
  - se você trocar a forma de pagamento, ele lembra da próxima vez.

### Passo 1 — Banco (antes do merge)
Supabase → **SQL Editor → New query** → cole `sql/007_v12_carteira_iphone.sql` → **Run**.
No final aparecem 3 linhas de conferência: todas devem vir **OK**.

### Passo 2 — Merge do PR → "✨ Nova versão disponível" no app.

### Passo 3 — Montar o atalho (cada um no próprio iPhone, uma vez, ~5 minutos)
Precisa do **iOS 17 ou mais novo**.

1. No app Finanças: **Mais → Atalho do iPhone → Criar chave** (ex.: "iPhone Renan"). Toque em **Copiar** na chave. Ela aparece só esta vez; se perder, é só revogar e criar outra.
2. Abra o app **Atalhos** → aba **Automação** → **+** (Nova Automação).
3. Escolha **Transação**.
   - Marque os cartões da Carteira que quer acompanhar.
   - Deixe todas as categorias marcadas.
   - Escolha **Executar Imediatamente** (sem pedir confirmação) → **Seguinte**.
4. **Nova Ação em Branco** → procure e adicione **Obter Conteúdo da URL**.
5. No campo de URL, cole o **Endereço** (no app: Mais → Atalho do iPhone → *Endereço (URL)* → Copiar).
6. Toque na setinha **›** da ação:
   - **Método:** `POST`.
   - **Cabeçalhos:** adicione `apikey` com o valor da *apikey (chave pública do app)* (Copiar no app).
   - **Corpo da Solicitação:** `JSON`, com 4 campos do tipo **Texto**:

     | Chave | Valor |
     |---|---|
     | `p_token` | cole a **sua chave pessoal** |
     | `p_valor` | **Entrada do Atalho** → escolha **Valor** |
     | `p_estabelecimento` | **Entrada do Atalho** → **Comerciante** |
     | `p_cartao` | **Entrada do Atalho** → **Cartão ou Tiquete** |

     **Como inserir a variável** (em cada linha):
     1. Toque no campo **Valor** da linha (o da direita, não o nome da chave).
     2. Na faixa **acima do teclado**, toque em **Entrada do Atalho**. Se não aparecer, arraste a faixa para o lado. Ela **não** fica dentro de "Selecionar Variável".
     3. Um botão azul "Entrada do Atalho" entra no campo. **Toque nele**. Aparece a lista da *Transação* (Cartão ou Tiquete, Comerciante, Valor, Nome); escolha o item da tabela.
     4. O botão passa a mostrar o nome escolhido (ex.: "Valor").

     > Em algumas versões do iOS os nomes mudam: **Valor** pode aparecer como *Quantia*, e **Cartão ou Tiquete** como *Cartão ou Passe*. Não use **Nome**.
7. **OK / Concluído.**
8. **Teste:** pague algo pequeno com a Carteira. Abra o app, e em Gasto deve aparecer "📥 1 compra da Carteira para lançar".

> Os nomes dos menus podem variar um pouco conforme a versão do iOS. Se algo não bater, me mande um print da tela do Atalhos.
>
> Se o atalho der erro, o próprio Atalhos mostra a mensagem do servidor:
> - *"Chave inválida ou revogada"*: cole a chave de novo ou crie outra.
> - *"Valor inválido"*: confira se `p_valor` está com a variável **Valor** da Entrada do Atalho.

### Uso no dia a dia
- **Gasto** → "📥 N compras da Carteira para lançar" → **Lançar**. Confira a categoria (e o cartão/forma) → **Salvar gasto**. O app volta para a caixa com as próximas.
- Compra que não deve virar gasto (por exemplo, um estorno ou algo já lançado à mão) → **Descartar**.
- Sem internet, o **Lançar** funciona igual: o gasto fica no aparelho e a caixa é atualizada quando o sinal volta.
- Cada pessoa vê e lança só as **próprias** compras da Carteira.

### Roteiro de testes no celular
- [ ] Rodou o `007` no Supabase e as 3 conferências vieram **OK**.
- [ ] **Mais → Atalho do iPhone → Criar chave**: a chave aparece e o **Copiar** funciona.
- [ ] Montou a automação no Atalhos (passo 3).
- [ ] Pagou algo com a Carteira → em **Gasto** aparece "📥 1 compra da Carteira para lançar".
- [ ] **Lançar**: valor, data e local certos, e o cartão reconhecido (se não, escolha e salve).
- [ ] Salvou → a compra sai da caixa; em **Lançamentos** o gasto aparece (sem 📍, porque não usa o GPS do momento).
- [ ] Segunda compra no mesmo lugar → a categoria já vem escolhida.
- [ ] **Descartar** uma compra → some da caixa e não vira gasto.
- [ ] **Revogar** a chave → a próxima compra dá erro no Atalhos. Depois crie outra chave e atualize o `p_token` no atalho.
- [ ] Camilla: repetir o passo 3 no iPhone dela, com a chave dela.
