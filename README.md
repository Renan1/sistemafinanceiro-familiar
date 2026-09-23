# 💰 Finanças da Família

Sistema de controle financeiro pessoal/familiar do Renan e da Camilla.
PWA (app que roda no navegador e é instalado na Tela de Início do celular) + Supabase (banco na nuvem).

- **Endereço (a partir da Fase 2):** https://financaspessoais.couveflorrefeicoes.com.br
- **Fechado:** sem login, nada é exibido. Não existe cadastro público.
- **100% online:** GitHub Pages (app) + Supabase (dados). Nenhum servidor próprio.
- **Funciona sem sinal:** o gasto fica guardado no celular e sobe sozinho quando a internet volta.

![Testes](https://github.com/Renan1/sistemafinanceiro-familiar/actions/workflows/testes.yml/badge.svg)

## Andamento

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Banco de dados (schema, RLS, seeds, views, auditoria) + Supabase | ✅ v0.1.0 |
| 2 | App: login, novo gasto, novo ganho, parcelas, offline, localização, publicação | ⏳ próxima |
| 3 | Lançamentos, recorrências, cartões, categorias, orçamentos | — |
| 4 | Dashboard com conciliação, gráficos e mapa | — |
| 5 | Saúde financeira (regras, tarefas), exportação, Skill do Claude | — |

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/REQUISITOS.md](docs/REQUISITOS.md) | **O que** o sistema faz (requisitos numerados RF/RNF/RN, critérios de aceite) |
| [docs/DECISOES.md](docs/DECISOES.md) | **Por que** cada escolha técnica foi feita |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Diagramas, tabelas, fluxo de um gasto, estrutura de pastas |
| [docs/ambiente-windows.md](docs/ambiente-windows.md) | Preparar o PC (Git, VS Code, GitHub CLI) e baixar o projeto |
| [docs/fase1-supabase.md](docs/fase1-supabase.md) | Passo a passo para criar e configurar o Supabase |
| [docs/CONVENCOES.md](docs/CONVENCOES.md) | Padrão de commits, versões, branches e mudanças no banco |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |

## Início rápido

1. Prepare o PC → [docs/ambiente-windows.md](docs/ambiente-windows.md)
2. Configure o Supabase → [docs/fase1-supabase.md](docs/fase1-supabase.md)
3. Publicação no GitHub Pages, subdomínio no Cloudflare e instalação no celular → *entram neste README na Fase 2.*

## Estrutura

```
sql/                  scripts do banco — rodar no Supabase, em ordem
  001_schema.sql        estrutura completa + segurança
  002_bootstrap_familia.sql  cria a família e liga os usuários
  003_verificacao.sql   confere se a segurança ficou OK
tests/sql/            testes automáticos do banco (rodam no GitHub Actions)
docs/                 documentação
.github/workflows/    testes a cada push + "manter Supabase ativo"
```

## Segurança em uma frase

Sem login, o banco nega tudo; com login, cada um vê a família e altera só o que é seu. Nenhuma senha ou chave fica no repositório. Detalhes em [docs/DECISOES.md](docs/DECISOES.md) (D-07 a D-10).
