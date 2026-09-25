# 💰 Finanças da Família

Sistema de controle financeiro pessoal/familiar do Renan e da Camilla.
PWA (app que roda no navegador e é instalado na Tela de Início do celular) + Supabase (banco na nuvem).

- **Endereço:** https://financaspessoais.couveflorrefeicoes.com.br
- **Fechado:** sem login, nada é exibido. Não existe cadastro público. (O Atalho do iPhone usa uma chave pessoal que só consegue *inserir* compras na caixa de entrada — D-44.)
- **100% online:** GitHub Pages (app) + Supabase (dados). Nenhum servidor próprio.
- **Funciona sem sinal:** o gasto fica guardado no celular e sobe sozinho quando a internet volta.

![Testes](https://github.com/Renan1/sistemafinanceiro-familiar/actions/workflows/testes.yml/badge.svg)

## Andamento

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Banco de dados (schema, RLS, seeds, views, auditoria) + Supabase | ✅ v0.1.0 |
| 2 | App: login, novo gasto, novo ganho, parcelas, offline, localização, publicação | ✅ v0.2.0 |
| 3 | Lançamentos, recorrências, cartões, categorias, orçamentos | ✅ v0.3.0 |
| 4 | Dashboard com conciliação, gráficos e mapa | ✅ v0.4.0 |
| 5 | Saúde financeira (regras, tarefas), exportação, Skill do Claude | ✅ v0.5.0 |
| — | **Sistema completo em uso** (validado no celular) + manual de operação | ✅ **v1.0.0** |
| 1.1 | Compra parcelada com juros (valor da parcela + preço à vista) | ✅ v1.1.0 |
| 1.2 | Compras da Carteira do iPhone direto no app (Atalhos + caixa de entrada) | ✅ v1.2.1 |
| 1.3 | Importar extrato e fatura (Nubank, Itaú, OFX) com categoria sugerida e sem duplicar | ✅ v1.3.0 |
| 1.3.1 | Parcelas "/mês" na lista, recorrências com valor variável, categoria Financiamentos | 🔄 v1.3.1 |

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/melhorias-v1.md](docs/melhorias-v1.md) | Melhorias depois da v1.0 (juros, Carteira do iPhone, importar extrato): SQL, uso e testes |
| [docs/OPERACAO.md](docs/OPERACAO.md) | **Uso e manutenção**: rotinas, o que vigiar, quando algo der errado, backup |
| [docs/REQUISITOS.md](docs/REQUISITOS.md) | **O que** o sistema faz (requisitos numerados RF/RNF/RN, critérios de aceite) |
| [docs/DECISOES.md](docs/DECISOES.md) | **Por que** cada escolha técnica foi feita |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Diagramas, tabelas, fluxo de um gasto, estrutura de pastas |
| [docs/ambiente-windows.md](docs/ambiente-windows.md) | Preparar o PC (Git, VS Code, GitHub CLI) e baixar o projeto |
| [docs/fase1-supabase.md](docs/fase1-supabase.md) | Passo a passo para criar e configurar o Supabase |
| [docs/fase2-publicacao.md](docs/fase2-publicacao.md) | Publicar no GitHub Pages, subdomínio no Cloudflare, instalar no celular, roteiro de testes |
| [docs/fase3-cadastros.md](docs/fase3-cadastros.md) | Fase 3: atualizar o banco (004), o que mudou e roteiro de testes |
| [docs/fase4-painel.md](docs/fase4-painel.md) | Fase 4: como ler o Painel (previsto × realizado, gráficos, mapa) e roteiro de testes |
| [docs/fase5-saude.md](docs/fase5-saude.md) | Fase 5: atualizar o banco (005), regras, tarefas, exportação, rotina mensal com o Claude |
| [claude-skill/README.md](claude-skill/README.md) | Skill "Consultor Financeiro Familiar": instalar no Claude e usar todo mês |
| [docs/CONVENCOES.md](docs/CONVENCOES.md) | Padrão de commits, versões, branches e mudanças no banco |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |

## Início rápido

1. Prepare o PC → [docs/ambiente-windows.md](docs/ambiente-windows.md)
2. Configure o Supabase → [docs/fase1-supabase.md](docs/fase1-supabase.md)
3. Publique e instale no celular → [docs/fase2-publicacao.md](docs/fase2-publicacao.md)
   - **GitHub Pages:** Settings → Pages → Source: *GitHub Actions*. O workflow `Publicar app` roda a cada push na `main`.
   - **Cloudflare:** registro `CNAME` `financaspessoais` → `renan1.github.io` (nuvem cinza) + domínio em Settings → Pages + *Enforce HTTPS*.
   - **iPhone:** Safari → Compartilhar → *Adicionar à Tela de Início* → abrir pelo ícone e fazer login.

### Rotina mensal com o Claude

1. App → **Mais → Exportar dados → Gerar JSON do mês** → Compartilhar.
2. Claude (com a Skill instalada): *"Analise com o Consultor Financeiro Familiar"*.
   (Antes, importe as faturas e o extrato do mês: Mais → Importar extrato ou fatura.)
3. Copie o bloco de tarefas → App → **Saúde → ✨ Importar tarefas do Claude**.
4. Gere o **Backup completo** e guarde.

### Onde ficam a URL e a chave do Supabase?

Em **Secrets do GitHub** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Na publicação, o GitHub Actions gera `js/config.js` com eles. Para testar no PC, copie `js/config.exemplo.js` para `js/config.js` (esse arquivo nunca vai para o Git).

### Comandos (PowerShell)

```powershell
npm test        # testes das parcelas, formatação e validação
npm run dev     # app em http://localhost:3000 (precisa do js/config.js)
```

## Estrutura

```
index.html, manifest.json, sw.js   casca do app (PWA) e Service Worker
css/app.css           visual (claro/escuro automático, safe area do iPhone)
js/                   código do app
  app.js                inicialização e navegação
  db.js                 comunicação com o Supabase (único ponto)
  offline.js            IndexedDB: fila de pendentes + cache
  sync.js               envio da fila (abrir app, voltar sinal, voltar à tela)
  parcelas.js           calcularParcelas() — regra do cartão
  recorrencias.js       geração automática dos gastos/ganhos fixos
  dashboard.js          cálculos do Painel (previsto × realizado, séries, orçamento)
  regras.js             motor de regras (limites em LIMITES) · saude.js roda e grava
  exportacao.js         export JSON (Claude) / CSV e importação de tarefas do Claude
  importacao.js         importar extrato/fatura (Nubank, Itaú, OFX) · planilha-worker.js lê .xls/.xlsx isolado
  mapa.js · libs.js     mapa (Leaflet) e carregamento sob demanda de gráficos/mapa
  geo.js · log.js · formato.js · validacao.js · estado.js
  ui/                   telas (login, gasto, ganho, lançamentos, painel, saúde, recorrências, categorias, orçamentos, perfil, exportar, mais)
icons/                ícones do app
sql/                  scripts do banco — rodar no Supabase, em ordem
  001_schema.sql        estrutura completa + segurança
  002_bootstrap_familia.sql  cria a família e liga os usuários
  003_verificacao.sql   confere se a segurança ficou OK
  004_fase3_recorrencias.sql  alterar valor de recorrência a partir de um mês
  005_fase5_saude.sql   gravar alertas do mês (mantendo os lidos)
  006_v11_parcela_com_juros.sql  preço à vista (juros) nas compras parceladas
  007_v12_carteira_iphone.sql    caixa de entrada + chave do Atalho do iPhone
  008_v13_importar_extrato.sql   categorias aprendidas na importação de extrato
  009_v131_financiamentos.sql    categoria Financiamentos
  manutencao/           scripts avulsos (ex.: zerar lançamentos de teste)
claude-skill/          Skill "Consultor Financeiro Familiar" (SKILL.md, formato, exemplos, MCP)
scripts/              utilitários (gera o exemplo da Skill com o código do app)
tests/                testes automáticos (banco e JS — rodam no GitHub Actions)
docs/                 documentação
.github/workflows/    testes, publicação no Pages e "manter Supabase ativo"
```

## Segurança em uma frase

Sem login, o banco nega tudo; com login, cada um vê a família e altera só o que é seu. Nenhuma senha ou chave fica no repositório. Detalhes em [docs/DECISOES.md](docs/DECISOES.md) (D-07 a D-10).
