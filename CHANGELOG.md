# Changelog

Todas as mudanças relevantes do projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em [SemVer](https://semver.org/lang/pt-BR/).

## [1.3.0] — 2026-09-25 — Importar extrato e fatura (Nubank, Itaú, OFX)

### Adicionado
- **Mais → Importar extrato ou fatura**. O arquivo é lido no aparelho e não é enviado a lugar nenhum. Formatos:
  - fatura **Nubank** (.csv);
  - fatura **Itaú** (.xlsx);
  - extrato da conta **Itaú** (.xls);
  - **OFX** de qualquer banco.
- **Prévia com 4 abas** (Para importar, Parece já lançado, Ignorados, Já importados):
  - categoria sugerida, e trocar uma troca todas as linhas do mesmo lugar;
  - forma de pagamento (PIX, boleto, débito);
  - na fatura, o cartão e o mês vêm sugeridos pelo final e pelo vencimento.
- **Não duplica:**
  - id fixo por linha, então reimportar mostra "já importado";
  - parcela seguinte da mesma compra, compra digitada ou pela Carteira, conta paga e salário de recorrência aparecem como "parece já lançado".
- **Ignora:**
  - pagamento de fatura (no cartão e na conta, inclusive o boleto do Nubank);
  - aplicação e resgate;
  - rendimento automático;
  - compra e estorno no mesmo mês;
  - "Controle de saldo".
- **"Parcela k/N"** vira uma compra com as parcelas k a N, nas faturas certas. O Painel já mostra o comprometimento futuro.
- **Aprende:** categoria trocada vira regra da família (`regras_categoria`), usada na próxima importação.
- `sql/008_v13_importar_extrato.sql`:
  - tabela `regras_categoria` com RLS e validação da categoria;
  - origem `importacao_conta` nos gastos e ganhos.
- **Módulos:**
  - `js/importacao.js`: leitores, classificação, duplicados e montagem;
  - `js/planilha-worker.js`: SheetJS isolada num Web Worker, com tempo limite;
  - `js/ui/importar.js`.
- **Limpeza de teste:** opção de apagar as categorias aprendidas. O backup inclui as regras.
- **Testes:**
  - 26 JS, com arquivos fictícios no formato real de cada banco;
  - 8 do banco;
  - 8 no navegador (CSV, .xlsx e .xls de verdade, reimportação, duplicados, regra aprendida), mais a regressão da v1.2, v1.1 e Fases 2 a 5;
  - conferido com os arquivos reais: os totais batem com as faturas.

### Alterado
- O backup completo segue mesmo se as tabelas das versões 1.x ainda não existirem no banco.

## [1.2.1] — 2026-09-25 — Passo a passo do Atalho com os nomes reais do iOS

### Corrigido
- Guia (`docs/melhorias-v1.md`) e tela **Mais → Atalho do iPhone**:
  - a variável é **Entrada do Atalho → Valor**, e não "Quantia";
  - o cartão vem de **Cartão ou Tiquete**, e não "Cartão ou Passe";
  - explica que "Entrada do Atalho" fica na faixa acima do teclado, e não em "Selecionar Variável";
  - validado no iPhone do Renan.

## [1.2.0] — 2026-09-25 — Compras da Carteira do iPhone direto no app

### Adicionado
- **Carteira do iPhone**:
  - uma automação do app **Atalhos** ("Transação") manda valor, estabelecimento e cartão de cada compra por aproximação para a **caixa de entrada** da pessoa;
  - "📥 N compras da Carteira para lançar" aparece na tela de gasto;
  - **Lançar** abre o gasto preenchido: valor, data, local, cartão reconhecido pelo nome e categoria lembrada daquele lugar;
  - **Descartar** tira a compra da caixa.
- **Mais → Atalho do iPhone**:
  - cria a chave pessoal, mostrada uma única vez;
  - endereço e chave pública para copiar;
  - passo a passo da automação;
  - lista de chaves com último uso e **Revogar**.
- `sql/007_v12_carteira_iphone.sql`:
  - tabelas `atalhos` (só o hash SHA-256 da chave) e `caixa_entrada`, com RLS;
  - funções `criar_atalho()` e `registrar_compra_atalho()`, esta a única nova liberada sem login, que só insere e responde "ok";
  - `valor_texto_centavos()`;
  - origem `carteira_iphone` nos gastos;
  - conferência de segurança no final.
- `js/carteira.js`: sugestão de gasto a partir da compra (cartão por dígitos, apelido ou palavra; lembranças por lugar e cartão).
- Telas `js/ui/caixa.js` e `js/ui/atalho.js`.
- Gasto lançado sem internet marca a caixa quando o sinal volta (`js/sync.js`).
- Backup completo inclui a caixa de entrada.
- A limpeza dos dados de teste também esvazia a caixa de entrada (mantém as chaves).
- Testes:
  - 13 JS (`carteira.test.js`);
  - 29 do banco (leitura de valor, chave, anônimo, RLS, revogar, limite por hora, máximo de chaves);
  - 10 no navegador, mais a regressão da v1.1 e das Fases 2 a 5.

### Alterado
- A numeração do plano mudou: a **Carteira do iPhone** virou a v1.2, porque saiu antes. A **importação de extrato** (Itaú e Nubank) passa a ser a v1.3.

## [1.1.0] — 2026-09-25 — Compra parcelada com juros

### Adicionado
- **Gasto → Crédito**: escolha entre **"Valor total"** e **"Valor da parcela"**.
  - Com "12x de R$ 189,90", o total vira R$ 2.278,80 e as 12 parcelas saem iguais às da loja.
- **Preço à vista** (opcional, com 2x ou mais): mostra "Juros: R$ 278,80 (13,9% a mais) · ≈ 2,1% ao mês".
- `sql/006_v11_parcela_com_juros.sql`:
  - nova coluna `despesas.valor_a_vista_centavos`, que precisa ser maior que zero e não pode passar do total;
  - `salvar_despesa()` passa a gravar essa coluna.
- `js/parcelas.js`:
  - `totalPelaParcela()`;
  - `jurosDaCompra()`, com a taxa ao mês pela tabela Price.
- **Lançamentos** mostram "juros R$ X".
- CSV com coluna `juros`.
- Export para o Claude com `despesas[].juros`. A Skill passa a comentar os juros pagos.
- `docs/melhorias-v1.md`: guia de atualização e testes das versões 1.x.
- Testes:
  - 5 JS: parcela, juros e taxa;
  - 2 de exportação;
  - 6 do banco;
  - 8 no navegador, mais a regressão das Fases 2 a 5 (11, 14, 10 e 13).

## [1.0.1] — 2026-09-25 — Zerar os dados de teste

### Alterado
- `sql/manutencao/limpar_lancamentos_teste.sql`:
  - agora também apaga as **tarefas** (antes ficavam as tarefas de teste);
  - opcionalmente apaga **cartões, recorrências e orçamentos** de teste (escolha true/false);
  - prévia com a contagem de tudo;
  - recusa, sem apagar nada, se pedir para apagar cartões ainda usados por uma recorrência.
- `docs/OPERACAO.md`: seção "Começar o uso real".

## [1.0.0] — 2026-09-25 — Sistema completo em uso

As 5 fases foram entregues e validadas no celular pelos dois usuários. Isso inclui a rotina mensal completa: exportar → Skill do Claude → importar tarefas.

### Adicionado
- `docs/OPERACAO.md`: manual de uso e manutenção:
  - rotinas diária, mensal, trimestral e anual;
  - o que vigiar (workflow de ping desativado pelo GitHub, pausa do Supabase);
  - solução de problemas, ajustes comuns, backup e segurança.
- Release `v1.0.0` no GitHub (criada após o merge, pelo passo a passo em docs/OPERACAO.md §7).

### Alterado
- Versão do app e do `package.json` para 1.0.0.
- Critérios de aceite CA-01, CA-04 e CA-05 marcados como validados no celular.

## [0.5.0] — 2026-09-24 — Fase 5: Saúde financeira, exportação e Skill do Claude

### Adicionado
- **Motor de regras** (`js/regras.js`) com as 9 regras especificadas e todos os limites em `LIMITES`: gastos > ganhos, orçamento 80%/100%, categoria +30% sobre a média de 3 meses, parcelas futuras > 30% da renda, fixos > 50%, poupança < 10%, > 15 compras pequenas em delivery, revisão trimestral de assinaturas, mês sem ganho. Avalia família e cada pessoa; roda ao abrir o app (a cada 6 h) e sob demanda.
- `sql/005_fase5_saude.sql`: `substituir_insights()` — grava os alertas do mês de uma vez, mantendo os já lidos.
- **Aba Saúde**: alertas por severidade (ícone + texto), selo de não lidos na aba, tarefas com checkbox/descartar/criar, **Importar tarefas do Claude** com prévia e sem duplicar.
- **Exportar** (Mais): JSON do mês para o Claude (`financas-familia/export@1`, sem e-mail/ids/GPS), CSV para Excel e backup completo; Compartilhar (iPhone) ou Baixar.
- **Skill "Consultor Financeiro Familiar"** (`claude-skill/`): SKILL.md, dicionário do formato, exemplo gerado pelo código do app, resposta-gabarito e guia de conexão futura via MCP.
- Testes: 29 das regras, 11 de exportação/importação, 5 de contrato Skill ↔ app, 12 do banco (alertas, tarefas, isolamento entre famílias).

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
