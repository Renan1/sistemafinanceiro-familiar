# Changelog

Todas as mudanças relevantes do projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em [SemVer](https://semver.org/lang/pt-BR/).

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
