# Documento de Requisitos — Finanças da Família

| Campo | Valor |
|---|---|
| Versão do documento | 1.0 (Fase 1) |
| Responsável | Renan |
| Usuários | Renan e Camilla (uma família) |
| Última atualização | 23/09/2026 |

Este documento é a **fonte oficial** do que o sistema deve fazer. Cada requisito tem um código (RF = funcional, RNF = não funcional, RN = regra de negócio) para ser citado em commits, testes e conversas. Mudou o requisito? Atualize aqui **e** registre no `CHANGELOG.md`.

---

## 1. Visão geral

Sistema web (PWA) de controle financeiro familiar. Cada membro registra os **próprios gastos e ganhos**. O sistema consolida tudo numa **visão familiar** com dashboard, conciliação (ganhos × gastos), alertas, conselhos e tarefas para melhorar a saúde financeira.

- **Roda 100% na internet**: frontend no GitHub Pages, dados no Supabase. Nenhum servidor físico próprio.
- **Uso principal no celular** (iPhone ou Android), adicionado à Tela de Início, **no ato da compra**.
- **Endereço:** `https://financaspessoais.couveflorrefeicoes.com.br`
- **Sistema fechado:** sem login, nada é exibido.

## 2. Usuários e permissões

| Código | Requisito |
|---|---|
| RF-01 | Login por **e-mail e senha** (sem magic link). |
| RF-02 | **Não existe cadastro público.** Contas são criadas pelo administrador no painel do Supabase. |
| RF-03 | Existe a entidade **família** (household). Renan e Camilla pertencem à mesma família. |
| RF-04 | Cada membro **vê** todos os lançamentos da família, mas só **edita/exclui** os próprios. |
| RF-05 | Categorias, orçamentos, tarefas e alertas são **da família**: ambos podem criar, editar e excluir. |
| RF-06 | Cartões e recorrências têm **dono**: todos veem, só o dono altera. |
| RNF-01 | Senha com **mínimo de 8 caracteres**, contendo **maiúscula, minúscula, número e caractere especial** (configurado no Supabase e validado no app). Recomendado: 12+. |

## 3. Lançamentos

### 3.1 Gastos (despesas)
| Código | Requisito |
|---|---|
| RF-10 | Registrar gasto em **menos de 10 segundos**: teclado numérico grande (digitação em centavos), chips de forma de pagamento, grade de categorias (mais usadas primeiro), botão Salvar grande. |
| RF-11 | Formas de pagamento: PIX, Débito, Crédito, Dinheiro, Boleto, Outro. |
| RF-12 | No crédito: escolher cartão e parcelas (1x a 24x), mostrando p.ex. "12x de R$ 83,33 — 1ª em Nov/26". |
| RF-13 | Natureza **Fixa** ou **Variável**; descrição opcional; data padrão = hoje (editável). |
| RF-14 | Captura de **localização** ao abrir a tela (não ao salvar). Se negar/falhar/demorar, salva sem localização. Campo opcional "nome do local". |
| RF-17 | (v1.3) **Importar extrato e fatura** (Nubank .csv, Itaú .xlsx/.xls, OFX), lidos no aparelho, com prévia (para importar / parece já lançado / ignorado / já importado), categoria sugerida e aprendida, parcelas da fatura projetadas e sem duplicar. |
| RF-16 | (v1.2) **Carteira do iPhone**: uma automação do app Atalhos ("Transação") envia valor, estabelecimento e cartão de cada compra por aproximação para uma **caixa de entrada** da pessoa; no app, "Lançar" abre o gasto preenchido (cartão e categoria sugeridos, aprendendo com as escolhas anteriores) e "Descartar" remove. A chave do atalho é pessoal, revogável e só consegue inserir na caixa. |
| RF-15 | (v1.1) No crédito, informar pelo **valor da parcela** (total = parcela × N, parcelas iguais às da loja) e, opcionalmente, o **preço à vista** para mostrar os juros pagos e a taxa ao mês. |

### 3.2 Ganhos (receitas) — **os ganhos do mês**
| Código | Requisito |
|---|---|
| RF-20 | Tela **Novo ganho**: valor, categoria (salário, pró-labore, aluguel…), data, fixo/variável, descrição. |
| RF-21 | Ganhos **fixos** (ex.: salário) são cadastrados uma vez como **recorrência** e lançados automaticamente todo mês. |
| RF-22 | Ganhos **variáveis** (freelance, reembolso…) são lançados manualmente quando acontecem. |

### 3.3 Recorrências
| Código | Requisito |
|---|---|
| RF-30 | Gastos e ganhos fixos mensais cadastrados como recorrência (valor, dia do mês, início, fim opcional). |
| RF-31 | Ao abrir o app, gerar os lançamentos pendentes (inclusive meses que ficaram para trás), **sem duplicar**. |
| RF-32 | Pausar, encerrar e **alterar valor a partir de um mês** (encerra a atual e cria nova, preservando o histórico). |

### 3.4 Lista de lançamentos
| Código | Requisito |
|---|---|
| RF-40 | Lista por mês com filtros (pessoa, categoria, forma de pagamento, fixo/variável) e busca. |
| RF-41 | Editar/excluir apenas os próprios lançamentos. |

## 4. Cadastros

| Código | Requisito |
|---|---|
| RF-50 | **Cartões**: apelido, bandeira, 4 últimos números, dia de fechamento, dia de vencimento, limite (opcional). |
| RF-51 | Excluir cartão: **sem compras → apaga**; **com compras → arquiva** (some das telas, histórico preservado). |
| RF-52 | **Categorias**: criar, editar (nome, tipo gasto/ganho, ícone, cor, ordem) e excluir **a qualquer momento**. |
| RF-53 | Excluir categoria em uso: o app pergunta **para qual categoria mover** os lançamentos, depois exclui. |
| RF-54 | Categorias padrão criadas automaticamente na criação da família (15 de gasto, 7 de ganho). |
| RF-55 | **Orçamentos** mensais por categoria, familiares ou individuais. |

## 5. Dashboard e conciliação

| Código | Requisito |
|---|---|
| RF-60 | **Dashboard único** com filtros no topo: **mês** e **visão** (Eu / cônjuge / Família). |
| RF-61 | **Bloco de conciliação** (topo do dashboard): ganhos previsto × realizado, gastos previsto × realizado (fixos, variáveis, cartão), saldo, taxa de poupança, % de fixos sobre a renda, parcelas já comprometidas nos próximos meses. |
| RF-62 | Gráficos: pizza por categoria; barras 12 meses (ganho × gasto); fixos × variáveis; por forma de pagamento; projeção das faturas dos próximos 6 meses; orçamento × realizado. |
| RF-63 | **Mapa** com os gastos geolocalizados do período (pontos agrupados, cor por categoria, popup com valor/data/categoria). |
| RN-01 | "Previsto" = recorrências + parcelas que caem no mês + orçamentos. "Realizado" = o que foi lançado. |
| RN-02 | Gastos são contados pela **competência das parcelas** (mês da fatura), não pela data da compra. |

## 6. Regras de negócio

| Código | Regra |
|---|---|
| RN-10 | Valores monetários sempre em **centavos** (inteiros). |
| RN-11 | **Toda despesa gera parcelas**; à vista = 1 parcela na competência do mês da compra. O dashboard lê só das parcelas. |
| RN-12 | Divisão: `total / N` em centavos; a diferença de arredondamento vai na **1ª parcela**. A soma é sempre igual ao total. Ex.: R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33. |
| RN-13 | Compra **antes** do dia de fechamento → fatura que fecha no mês corrente; **no dia ou depois** → fatura do mês seguinte. |
| RN-14 | Vencimento: se `dia_vencimento ≤ dia_fechamento`, vence no mês seguinte ao fechamento; senão, no mesmo mês. **Competência = mês do vencimento.** Parcelas seguintes: +1 mês. |
| RN-15 | Meses curtos: dia 31 (ou 29/30) em mês que não tem esse dia → último dia do mês. |
| RN-16 | Toda a lógica de parcelas em **uma função JS pura** (`calcularParcelas`) com testes (antes/depois do fechamento, virada de ano, fevereiro, 1x, 12x, arredondamento). |
| RN-17 | Editar/excluir uma despesa parcelada regenera/remove **todas** as parcelas. |
| RN-18 | Recorrência + competência é chave única: um mês nunca é gerado duas vezes. |

## 7. Saúde financeira

| Código | Requisito |
|---|---|
| RF-70 | Motor de regras (`js/regras.js`) com limites num objeto de configuração. Gera **alertas** e, quando fizer sentido, **tarefas** (sem duplicar tarefa aberta da mesma regra). |
| RF-71 | Regras mínimas: gastos > ganhos (crítico); categoria acima do orçamento (80% atenção, 100% crítico); categoria 30% acima da média de 3 meses; parcelas futuras > 30% da renda média; fixos > 50% da renda; poupança < 10%; mais de 15 compras < R$ 30 em Restaurante/Delivery no mês; revisão trimestral de assinaturas; mês sem nenhum ganho registrado. |
| RF-72 | Tela com alertas e lista de tarefas com checkbox. |
| RF-73 | **Importar tarefas do Claude** (JSON gerado pela Skill). |

## 8. Exportação e Skill do Claude

| Código | Requisito |
|---|---|
| RF-80 | Exportar dados em **JSON** e **CSV**. |
| RF-81 | **Rotina mensal**: exportar o JSON do mês e enviar para a Skill "Consultor Financeiro Familiar" (serve também de backup). |
| RF-82 | A Skill produz diagnóstico, comparação com meses anteriores, pontos de atenção, 3 a 5 conselhos priorizados e tarefas em JSON importável. |
| RF-83 | Documentar a futura troca do export manual por conector MCP do Supabase. |

## 9. Requisitos não funcionais

| Código | Requisito |
|---|---|
| RNF-10 | **Sem internet no momento da compra:** o gasto é guardado no navegador (IndexedDB) e enviado sozinho quando houver sinal (ao abrir o app, ao voltar a conexão, ao voltar o app para a tela, ou pelo botão "sincronizar"). Não depende de Background Sync. |
| RNF-11 | Envio **idempotente** (id gerado no aparelho + upsert): reenviar nunca duplica. |
| RNF-12 | Indicador visível de pendentes ("3 lançamentos aguardando sinal"). Sessão expirada **não apaga** a fila. |
| RNF-13 | App abre e permite registrar sem internet após o primeiro acesso (cache do app, categorias, cartões). |
| RNF-20 | **RLS em todas as tabelas.** Quem não está logado não acessa nada; outra família não enxerga nada. |
| RNF-21 | **Nenhuma senha/chave no repositório.** URL e chave pública do Supabase ficam nos Secrets do GitHub; a `service_role` nunca sai do painel. |
| RNF-22 | Validação no app **e** constraints no banco (valor > 0, parcelas 1–24, etc.). |
| RNF-23 | **Auditoria**: toda criação/alteração/exclusão registrada no banco (quem, quando, antes/depois). |
| RNF-30 | Formatação pt-BR (R$ 1.234,56; dd/mm/aaaa), fuso America/Sao_Paulo. |
| RNF-31 | Mobile-first, visual de app nativo, tema claro/escuro automático, respeita a *safe area* (notch/barra). |
| RNF-32 | Funciona em **qualquer celular** (iPhone via Safari, Android via Chrome) e no computador. |
| RNF-40 | Código **comentado e documentado** em português; cabeçalho explicativo em cada arquivo. |
| RNF-41 | **Logs** do app com níveis (info/aviso/erro), visíveis e exportáveis em Configurações → Diagnóstico. |
| RNF-42 | Controle de versão com Git, commits no padrão *Conventional Commits*, versões semânticas por fase e `CHANGELOG.md`. |
| RNF-43 | Testes automáticos rodando no GitHub Actions a cada envio. |
| RNF-50 | O projeto Supabase gratuito **não pode pausar** por inatividade: ping automático a cada 3 dias. |

## 10. Preparado para o futuro (não implementar agora)

- ~~Importação de fatura (PDF/CSV/OFX) com classificação automática~~ — feito na v1.3 (RF-17), exceto PDF.
- Metas de economia (reserva de emergência, viagem).
- Múltiplas famílias — a estrutura de household já permite.
- Verificação em duas etapas (TOTP) no login.

## 11. Critérios de aceite

| Código | Critério | Como é verificado |
|---|---|---|
| CA-01 | Gasto registrado em modo avião sincroniza sozinho ao reabrir com internet, sem duplicar. | Teste do banco ✅ + teste no navegador ✅ + roteiro no celular ✅ (docs/fase2-publicacao.md) |
| CA-02 | R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33 nas faturas corretas. | Teste do banco ✅ + 31 testes JS ✅ + teste no navegador ✅ |
| CA-03 | Camilla vê o dashboard familiar com os gastos do Renan, mas não consegue editá-los. | Teste do banco ✅ |
| CA-04 | Negar localização não impede nenhum registro. | Teste no navegador ✅ + roteiro no celular ✅ |
| CA-05 | App abre e registra sem internet após o primeiro acesso. | Teste no navegador ✅ + roteiro no celular ✅ |
| CA-06 | Quem abre o link sem login não vê nenhum dado. | Teste do banco ✅ |

## 12. Fases de entrega

| Fase | Conteúdo | Versão |
|---|---|---|
| 1 | Banco completo (schema, RLS, seeds, views, auditoria) + passo a passo do Supabase | v0.1.0 |
| 2 | PWA: login, novo gasto, novo ganho, parcelamento, offline/sincronização, geolocalização, testes de parcelas, publicação no GitHub Pages | v0.2.0 |
| 3 | Lançamentos, recorrências, cartões, categorias, orçamentos | v0.3.0 |
| 4 | Dashboard (conciliação, gráficos, mapa) | v0.4.0 |
| 5 | Motor de regras, tarefas, exportação JSON/CSV, Skill do Claude | v0.5.0 |
| — | Validação completa no celular pelos dois usuários + manual de operação | **v1.0.0** |
