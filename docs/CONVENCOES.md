# Convenções do projeto

## Commits (Conventional Commits, em português)

Formato: `tipo(escopo): descrição curta no imperativo`

| Tipo | Quando usar | Exemplo |
|---|---|---|
| `feat` | Funcionalidade nova | `feat(gasto): teclado numérico em centavos` |
| `fix` | Correção de erro | `fix(parcelas): vencimento em fevereiro` |
| `docs` | Só documentação | `docs(readme): passo a passo do Cloudflare` |
| `test` | Testes | `test(rls): intruso não vê receitas` |
| `refactor` | Reorganização sem mudar comportamento | `refactor(offline): separa fila e cache` |
| `chore` | Manutenção (configs, workflows) | `chore(ci): usa Postgres 17 nos testes` |
| `db` | Mudança no banco (novo arquivo em `sql/`) | `db: adiciona metas de economia` |

No corpo do commit, cite os requisitos afetados: `Refs: RF-12, RN-13`.

## Versões (SemVer) e CHANGELOG

- `v0.X.0` = fim de cada fase. `v1.0.0` = sistema completo em uso.
- `v0.X.Y` = correções dentro de uma fase.
- Toda versão tem uma seção no `CHANGELOG.md` (o que entrou, o que mudou, o que foi corrigido).
- A tag Git (`v0.1.0`) é criada quando a fase entra na `main`.

## Branches

- `main` → o que está publicado no GitHub Pages.
- Desenvolvimento em branch separada → Pull Request → testes ✅ → merge na `main`.

## Mudanças no banco

- Os scripts em `sql/` são **numerados e executados em ordem**: `001_…`, `002_…`.
- Depois que um script foi executado no Supabase, **ele não é mais alterado**: mudanças novas viram um novo arquivo (`004_…`). Assim sempre se sabe exatamente o que foi aplicado.
- Todo script novo precisa passar nos testes de `tests/sql/`.

## Código

- Nomes e comentários em **português**.
- Todo arquivo começa com um cabeçalho: o que faz, de quem depende, quem usa.
- Toda função tem um comentário explicando **o quê** e **por quê**.
- Valores monetários sempre em centavos (inteiros); formatação só na hora de exibir.
