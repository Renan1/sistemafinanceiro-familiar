# Changelog

Todas as mudanças relevantes do projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em [SemVer](https://semver.org/lang/pt-BR/).

## [0.4.0] — 2026-09-24 — Fase 4: Painel com gráficos e mapa

### Adicionado
- **Painel completo** (filtros de mês e visão Eu / cônjuge / Família):
  - números do mês (ganhos, gastos, saldo, taxa de poupança, % de fixos sobre a renda);
  - **previsto × realizado** — ganhos e gastos fixos (recorrências), variáveis (orçamentos), diferença com ▲/▼ e parcelas de compras anteriores em destaque;
  - gastos por categoria (rosca, 5 maiores + "Outras", lista com valor e %);
  - ganhos × gastos em 12 meses; fixos × variáveis em 6 meses; gastos por forma de pagamento;
  - faturas do cartão nos próximos 6 meses;
  - orçamento × realizado com ✓ / ⚠ 80% / ⛔ 100% (ícone + texto, nunca só cor);
  - **mapa** (Leaflet + OpenStreetMap) com pontos agrupados, cor por categoria e popup.
- "Ver números" (tabela) em todos os gráficos; tema claro/escuro com cores próprias validadas.
- `js/dashboard.js` (cálculos puros, 12 testes), `js/ui/graficos.js`, `js/mapa.js`, `js/libs.js` (Chart.js 4.5.1, Leaflet 1.9.4 e markercluster 1.5.3 carregados só no Painel e guardados em cache).
- Teste que garante que as bibliotecas do Painel estão no cache offline.

## [0.3.0] — 2026-09-24 — Fase 3: Lançamentos e cadastros

### Adicionado
- **Lançamentos**: filtros (pessoa, tipo, categoria, forma de pagamento, fixo/variável), busca sem acento, totais do filtro e **editar/excluir** os próprios lançamentos — também sem internet (a fila do aparelho tem prioridade na lista).
- **Recorrências** (Mais → Recorrências): gastos e ganhos fixos; o app gera os lançamentos do mês (e meses atrasados, até 24) ao abrir com internet, com id determinístico por (recorrência, mês) — sem duplicar mesmo em dois aparelhos. Pausar, retomar, encerrar, excluir e **alterar valor a partir de um mês**.
- `sql/004_fase3_recorrencias.sql`: função `alterar_valor_recorrencia()` — encerra a antiga, cria a nova com `substitui_id`, atualiza lançamentos já gerados; tudo numa transação.
- **Categorias**: criar, editar (nome, emoji, cor, ordem), desativar/reativar, excluir movendo os lançamentos em uso.
- **Orçamentos**: valor mensal por categoria, familiar ou individual.
- **Cartões**: edição (apelido, fechamento, vencimento, limite).
- **Perfil**: nome, cor e troca de senha.
- `js/recorrencias.js` com 16 testes; `lerValorBR()` para valores digitados em R$; teste que garante que todo arquivo JS está no cache offline.
- Testes do banco da Fase 3 (9) e runner que aplica os scripts novos automaticamente.

### Corrigido
- Falha ao carregar um cadastro não mostra mais "Conta sem família" por engano: só o caso real bloqueia; o resto segue com os dados do aparelho.
- No máximo 2 avisos empilhados na tela.

## [0.2.0] — 2026-09-23 — Fase 2: App (PWA)

### Adicionado
- PWA instalável (manifest, ícones, meta tags do iPhone, tema claro/escuro, safe area).
- **Login** por e-mail e senha, "esqueci minha senha" e tela de nova senha com a política de senha.
- **Novo gasto** (tela inicial): teclado em centavos, formas de pagamento (lembra a última), cartão e parcelas 1x–24x com prévia ("3x de R$ 333,33 — 1ª em Out/26"), categorias mais usadas primeiro, Fixo/Variável, data, descrição, nome do local.
- **Novo ganho**: valor, tipo de ganho, data, Fixo/Variável (salário/pró-labore/aluguel já sugerem "Fixo").
- `js/parcelas.js`: `calcularParcelas()` — fechamento, vencimento, virada de ano, meses curtos, arredondamento na 1ª parcela.
- **Offline**: todo lançamento vai primeiro para o IndexedDB (id gerado no aparelho) e é enviado ao abrir o app, ao voltar a internet, ao voltar para a tela, após salvar e pelo indicador. Sessão expirada não perde a fila. Recusas do servidor ficam marcadas para "tentar de novo" ou "descartar".
- Service Worker: app abre sem internet; atualização com aviso "Nova versão disponível".
- **Localização** capturada ao abrir a tela (5 s, maximumAge 60 s); negar não impede nada.
- **Lançamentos** (do mês + pendentes), **Painel** com a conciliação do mês por visão (Eu / Camilla / Família), **Cartões** (cadastrar, excluir/arquivar), **Diagnóstico** com logs exportáveis.
- `js/log.js`: logs com níveis, guardados no aparelho, sem dados sensíveis.
- Workflow **Publicar app** (GitHub Pages): testes → gera `config.js` dos Secrets → carimba versão no Service Worker → publica. Arquivo `CNAME`.
- 43 testes JS (`npm test`) no GitHub Actions; teste ponta a ponta no navegador validou CA-01, CA-02, CA-04 e CA-05.
- `docs/fase2-publicacao.md`: Pages, Cloudflare, instalação no celular e roteiro de testes.

- `sql/manutencao/limpar_lancamentos_teste.sql`: zera os lançamentos de teste (com prévia e confirmação), mantendo cadastros.

### Corrigido
- Workflow de ping: normaliza a `SUPABASE_URL` (barra final / `/rest/v1`) e mostra a resposta do Supabase.

## [0.1.0] — 2026-09-23 — Fase 1: Banco de dados

### Adicionado
- `sql/001_schema.sql`: schema completo no Supabase.
  - Tabelas: households, profiles, categorias, cartoes, recorrencias, despesas, parcelas, receitas, orcamentos, tarefas, insights, auditoria.
  - Constraints: valores > 0, parcelas 1–24, crédito exige cartão, parcelamento só no crédito, dias 1–31, cores e 4 dígitos validados.
  - RLS em todas as tabelas + revogação total do papel anônimo (D-09).
  - Gatilhos: updated_at, preenchimento de dono/família, validação de referências entre famílias, auditoria.
  - RPCs: `salvar_despesa`, `excluir_categoria`, `excluir_cartao`, `ping`.
  - Views: `vw_parcelas_detalhe`, `vw_resumo_mensal`, `vw_gastos_categoria_mes`, `vw_comprometimento_futuro`.
  - Seeds: 15 categorias de gasto e 7 de ganho criadas automaticamente por família.
- `sql/002_bootstrap_familia.sql`: cria a família e liga Renan e Camilla.
- `sql/003_verificacao.sql`: checagem de segurança pós-instalação.
- `tests/sql/`: 38 testes automáticos (RLS, idempotência, parcelas, constraints, anônimo, intruso).
- GitHub Actions: `Testes` (a cada push) e `Manter Supabase ativo` (a cada 3 dias).
- Documentação: README, requisitos, decisões técnicas, arquitetura, convenções, guias de ambiente Windows e de configuração do Supabase.
