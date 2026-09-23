# Changelog

Todas as mudanças relevantes do projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em [SemVer](https://semver.org/lang/pt-BR/).

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
