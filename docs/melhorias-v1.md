# Melhorias depois da v1.0 — guia de atualização e testes

Cada melhoria é uma versão, no fluxo de sempre: Pull Request → testes → **você roda o SQL novo (se houver) ANTES do merge** → merge → o app se atualiza sozinho.

| Versão | O que traz | SQL novo |
|---|---|---|
| **v1.1** | Compra parcelada **com juros** (informar pelo valor da parcela + preço à vista) | `sql/006_v11_parcela_com_juros.sql` |
| **v1.2** | Compras da **Carteira do iPhone** direto no app (Atalhos + caixa de entrada) | `sql/007_v12_carteira_iphone.sql` |
| **v1.3** | **Importar extrato e fatura** (Nubank, Itaú, OFX) com categoria sugerida, sem duplicar | `sql/008_v13_importar_extrato.sql` |
| **v1.3.1** | Parcelas "/mês" na lista, recorrências com valor variável, categoria **Financiamentos** | `sql/009_v131_financiamentos.sql` |

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

---

## v1.3 — Importar extrato e fatura (Nubank, Itaú, OFX)

**Como funciona:** em **Mais → Importar extrato ou fatura** você escolhe o arquivo exportado do banco.
- O app lê o arquivo **no próprio aparelho**: ele não vai para lugar nenhum.
- Antes de gravar, mostra uma **prévia** dividida em abas:

| Aba | O que é | Vem marcado? |
|---|---|---|
| ✅ Para importar | Lançamentos novos, com a **categoria sugerida** | Sim |
| 🟰 Parece já lançado | Mesmo valor e data (ou mesma parcela no mesmo cartão) de algo que já está no app: digitado, pela Carteira, por recorrência ou por outra importação | Não; marque se for outro |
| ⏭️ Ignorados | Pagamento de fatura, aplicação e resgate, rendimento automático, compra estornada, "Controle de saldo" | Não |
| ✔️ Já importados | O mesmo arquivo (ou a mesma linha) importado antes | Não |

- **Trocar a categoria** de uma linha troca todas as linhas do **mesmo lugar**. Ao importar, o app **aprende**: na próxima importação, esse lugar já vem com a categoria certa, para os dois.
- **Parcelas:** "Parcela 9/12" da fatura vira **uma** compra com as parcelas 9 a 12, nos meses certos. Assim o Painel já mostra o que está comprometido. No mês seguinte, a "Parcela 10/12" é reconhecida como já lançada.
- **Ordem das faturas:** pode importar em qualquer ordem. Se a fatura mais nova entrou primeiro, na mais antiga as compras parceladas entram só com a parcela daquele mês (aviso na prévia) — sem duplicar (v1.3.2).
- **Conferência:** na 1ª importação de um cartão, o total "Para importar" deve bater com o **valor da fatura**. Nas seguintes, some também o "Parece já lançado" (as parcelas que já estavam no app). Nos testes com faturas reais do Nubank e do Itaú, bateu no centavo.

### Arquivos aceitos e onde exportar

| Banco | Arquivo | Onde |
|---|---|---|
| Nubank | **Fatura do cartão** (.csv) | App → Cartão de crédito → Faturas → escolha a fatura → **Exportar fatura** (chega por e-mail) |
| Itaú | **Fatura do cartão** (.xlsx) | Site do Itaú → Cartões → Fatura (aberta ou fechada) → **Salvar em Excel** |
| Itaú | **Extrato da conta** (.xls) | Site do Itaú → Conta → Extrato → escolha o período → **Salvar em Excel** |
| Outros | Extrato em **OFX** | Site/app do banco → exportar OFX |

> Nas faturas, o app descobre o **cartão** (pelos 4 últimos números, no Itaú, ou pelo nome "Nubank" no apelido) e o **mês da fatura** (pelo vencimento). Confira os dois no topo da prévia.

### Passo 1 — Banco (antes do merge)
Supabase → **SQL Editor → New query** → cole `sql/008_v13_importar_extrato.sql` → **Run** → a conferência no final deve vir **OK**.

### Passo 2 — Merge do PR → "✨ Nova versão disponível" no app.

### Passo 3 — Testar (com os arquivos que você já tem)
Pode testar com os dados reais: o que for importado nos testes sai na limpeza geral (passo 4).
- [ ] Rodou o `008` no Supabase (conferência **OK**).
- [ ] Cadastre (ou confira) os cartões em **Mais → Cartões**: **Nubank** e **Itaú** (com os 4 últimos números do cartão da fatura), com dia de fechamento e vencimento.
- [ ] **Importar** uma fatura Nubank já paga (`Nubank_AAAA-MM-DD.csv`):
  - cartão Nubank e mês 09/2026 já escolhidos;
  - o total "Para importar" é o **valor que foi pago** daquela fatura;
  - estornos e "Pagamento recebido" estão em Ignorados.
- [ ] Troque a categoria de uma loja que aparece mais de uma vez → as outras linhas da mesma loja mudam juntas → **Importar**.
- [ ] Importe a **mesma** fatura de novo → tudo em "✔️ Já importados".
- [ ] Importe a fatura Nubank do **mês seguinte**:
  - as compras parceladas que continuam ("Parcela 10/12", "4/4"…) aparecem em "🟰 Parece já lançado";
  - a loja cuja categoria você trocou já vem com a categoria nova. Atenção: no Mercado Livre e na Shopee, cada vendedor tem um nome, então cada um é aprendido separado;
  - "Para importar" + "Parece já lançado" = total da fatura.
- [ ] Importe a **fatura Itaú** (.xlsx): cartão (pelo final) e mês certos; o total bate com a fatura.
- [ ] Importe o **extrato da conta Itaú** (.xls): "FATURA PAGA", "PAG BOLETO NU PAGAMENTOS", "RESGATE CDB" e "REND PAGO" estão em Ignorados.
- [ ] Veja em **Lançamentos** e no **Painel**: os meses batem com as faturas.

### Passo 4 — Começar de verdade (limpeza geral + importação real)
Quando os testes da v1.3 estiverem ok:
1. **Backup** (opcional): Mais → Exportar dados → Backup completo.
2. **Limpeza**: `docs/OPERACAO.md` seção 0 (script `sql/manutencao/limpar_lancamentos_teste.sql`).
   - Apague lançamentos, alertas, tarefas e caixa da Carteira.
   - Recomendo marcar também `v_apagar_regras := true`, porque as categorias aprendidas no teste podem ter ficado erradas. Se gostou delas, deixe `false`.
   - Cartões e recorrências: só apague se forem de teste.
3. **Cadastros reais** (Mais): cartões (Nubank e Itaú, com os 4 últimos números), recorrências (salário, aluguel, assinaturas) e orçamentos.
4. **Importação real** de setembro, nesta ordem:
   1. a fatura de cada cartão que **vence em setembro** (e a de outubro, se já fechou);
   2. o extrato da conta de setembro.
5. Daqui em diante, a **rotina mensal**:
   - importe cada fatura quando ela **fechar**;
   - importe o extrato da conta uma vez por mês;
   - o dia a dia continua pelo app e pela Carteira. O que já foi lançado aparece como "🟰 Parece já lançado" e não duplica.

> Recorrências e importação convivem: se o salário é uma recorrência, o "SISPAG" do extrato aparece como "🟰 Parece já lançado". Deixe desmarcado.

---

## v1.3.1 — Parcelas na lista, recorrências variáveis e Financiamentos

### Passo 1 — Banco (antes do merge)
Supabase → **SQL Editor → New query** → cole `sql/009_v131_financiamentos.sql` → **Run** → a conferência deve vir **OK**. Isso cria a categoria **🏦 Financiamentos**.

### Passo 2 — Merge do PR → "✨ Nova versão disponível".

### O que muda
- **Lançamentos:**
  - compra parcelada mostra **"R$ 500,00/mês"**, com "12x · total R$ 6.000,00" nos detalhes;
  - o card **"Gastos no mês"** é o mesmo número do Painel: pelas faturas, a parcelada pesa só a parcela do mês;
  - uma nota logo abaixo mostra o total das compras lançadas;
  - com algum filtro ligado (tipo, categoria…), o card volta a somar a lista ("Compras").
- **Financiamentos:**
  - na importação do extrato, troque a categoria das parcelas dos financiamentos (ex.: o boleto do banco do financiamento do carro) para **🏦 Financiamentos** uma vez: o app aprende;
  - elas entram como **Fixo**;
  - boletos de "financeira", "CFI", "consórcio" e "empréstimo" já vêm nessa categoria;
  - **não crie recorrência** para financiamento cujo valor muda uns centavos todo mês: deixe entrar pelo extrato.
- **Pensão, aluguel e salário com valor variável:**
  - se existe uma **recorrência** (ex.: Pensão R$ 1.000) e o extrato traz R$ 1.050, a linha aparece em "🟰 Parece já lançado", com os dois valores;
  - deixe **desmarcada** e corrija o valor do lançamento em **Lançamentos**, tocando nele;
  - vale para diferenças de até 10% e até 5 dias.
- **Fixos:** na importação, Financiamentos, Moradia, Contas, Assinaturas, Salário, Pró-labore e Aluguel entram como **Fixo**.

### Roteiro de testes
- [ ] Rodou o `009` (conferência **OK**). Em **Mais → Categorias** aparece **🏦 Financiamentos**.
- [ ] **Lançamentos:** uma compra parcelada mostra "R$ …/mês" e "16x · total …". O card "Gastos no mês" bate com o **Painel** do mesmo mês.
- [ ] **Importar** o extrato da conta:
  - a linha da pensão (valor diferente da recorrência) aparece em "🟰 Parece já lançado" com os dois valores;
  - um financiamento de banco com "CFI" no nome já vem em Financiamentos;
  - troque o outro financiamento para Financiamentos.
- [ ] Depois de importar: os financiamentos aparecem com "fixo" em Lançamentos.
