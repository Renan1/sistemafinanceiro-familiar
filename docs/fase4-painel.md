# Fase 4 — Painel com gráficos e mapa (guia)

**Não há nada para rodar no Supabase nesta fase** — o Painel usa as views criadas na Fase 1. Basta fazer o merge do Pull Request; o app atualiza sozinho ("✨ Nova versão disponível").

## Como ler o Painel

No topo: **mês** (‹ ›) e **visão** — *Eu*, *Camilla* ou *Família* (soma dos dois). Tudo abaixo segue esses dois filtros.

| Bloco | O que mostra | Como é calculado |
|---|---|---|
| **Números do mês** | Ganhos, gastos, saldo, taxa de poupança e % dos fixos sobre a renda | Gastos pelo **mês da fatura** (competência): uma compra 3x pesa 1/3 em cada mês |
| **Previsto × realizado** | Ganhos, gastos fixos e gastos variáveis: o que era esperado × o que aconteceu, e a diferença (▲ acima / ▼ abaixo) | **Previsto**: ganhos e gastos fixos = recorrências ativas no mês; variáveis = soma dos orçamentos. Parcelas de compras de meses anteriores aparecem destacadas |
| **Para onde foi o dinheiro** | Rosca por categoria + lista com valor e % | As 5 maiores categorias; o resto vira "Outras" |
| **Ganhos × gastos** | Barras dos últimos 12 meses | Azul = ganhos, laranja = gastos |
| **Fixos × variáveis** | Barras empilhadas dos últimos 6 meses | Violeta = fixos, laranja = variáveis |
| **Por forma de pagamento** | Quanto saiu em PIX, crédito, débito… no mês | |
| **Faturas do cartão** | Parcelas já comprometidas nos próximos 6 meses | Só crédito |
| **Orçamento × realizado** | Cada categoria com orçamento: barra, % e situação | ✓ dentro (< 80%) · ⚠ atenção (80–99%) · ⛔ estourou (≥ 100%) |
| **Mapa dos gastos** | Gastos com localização no mês; pontos próximos se agrupam (toque para abrir) | Cor = cor da categoria; toque num ponto: valor, data, categoria, quem |

Em cada gráfico, **"Ver números"** abre a tabela com os valores exatos.

### Detalhes importantes
- **Visão Eu/Camilla + orçamento**: mostra os orçamentos *individuais* daquela pessoa. Orçamentos da família aparecem na visão *Família*.
- **Sem internet**: o Painel mostra a última cópia guardada daquele mês. Os gráficos funcionam offline depois do primeiro acesso ao Painel; o **mapa** precisa de internet (as ruas vêm do OpenStreetMap).
- **Lançamentos aguardando sinal** entram no Painel depois de sincronizar.
- **Privacidade do mapa**: para desenhar as ruas, o navegador baixa "pedaços" do mapa da região dos seus gastos do servidor público do OpenStreetMap. Nenhum valor ou descrição sai do app — só a região do mapa visível.

## Roteiro de testes no celular

- [ ] Abra **Painel**: aparecem os números do mês, Previsto × realizado e os gráficos.
- [ ] **Visão**: toque em Eu / Camilla / Família — números e gráficos mudam.
- [ ] **Mês**: volte um mês (‹) e avance (›).
- [ ] **Previsto × realizado**: com o salário cadastrado em Recorrências, a linha *Ganhos* mostra o previsto; com orçamentos, *Gastos variáveis* mostra o previsto.
- [ ] **Categorias**: os valores da lista batem com os lançamentos do mês (considerando o mês da fatura).
- [ ] **Faturas do cartão**: uma compra parcelada no crédito aparece nos meses seguintes.
- [ ] **Orçamento**: uma categoria acima de 80% aparece com ⚠; acima de 100% com ⛔.
- [ ] **Mapa**: gastos feitos com localização aparecem; toque num ponto e veja o valor.
- [ ] **"Ver números"** abre a tabela de um gráfico.
- [ ] **Tema escuro**: ative o modo escuro do celular — o Painel continua legível.
- [ ] **Modo avião**: abra o Painel de um mês já visto — mostra a última cópia.
