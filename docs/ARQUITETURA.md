# Arquitetura

## Visão geral

```mermaid
flowchart LR
  subgraph Celular["Celular / navegador"]
    UI["PWA<br/>(HTML/CSS/JS)"]
    IDB[("IndexedDB<br/>fila de pendentes<br/>+ cache")]
    SW["Service Worker<br/>(cache do app)"]
    UI <--> IDB
    SW -.-> UI
  end

  subgraph GitHub
    PAGES["GitHub Pages<br/>financaspessoais.couveflorrefeicoes.com.br"]
    ACT["GitHub Actions<br/>testes · deploy · ping"]
  end

  subgraph Supabase["Supabase (São Paulo)"]
    AUTH["Auth<br/>e-mail + senha"]
    API["API REST/RPC"]
    DB[("Postgres<br/>RLS + auditoria")]
    AUTH --> API --> DB
  end

  CF["Cloudflare DNS<br/>CNAME"] --> PAGES
  PAGES -- "baixa o app" --> UI
  UI -- "login" --> AUTH
  UI -- "sincroniza (upsert)" --> API
  ACT -- "ping a cada 3 dias" --> API
```

## Fluxo de um gasto

```mermaid
sequenceDiagram
  participant U as Você
  participant App as PWA
  participant IDB as IndexedDB
  participant S as Supabase

  U->>App: abre "Novo gasto"
  App->>App: pede localização (até 5s, em paralelo)
  U->>App: digita valor, toca categoria, Salvar
  App->>App: calcularParcelas() + id = randomUUID()
  App->>IDB: grava como "pendente"
  App-->>U: "Salvo ✓" (na hora)
  alt tem internet
    App->>S: rpc salvar_despesa(despesa, parcelas)
    S-->>App: ok
    App->>IDB: marca "sincronizado"
  else sem sinal
    Note over App,IDB: fica na fila — tenta de novo ao abrir o app,<br/>ao voltar a conexão ou ao voltar para a tela
  end
```

## Banco de dados

```mermaid
erDiagram
  households ||--o{ profiles : tem
  households ||--o{ categorias : tem
  profiles   ||--o{ cartoes : "é dono"
  profiles   ||--o{ despesas : lança
  profiles   ||--o{ receitas : lança
  profiles   ||--o{ recorrencias : "é dono"
  despesas   ||--|{ parcelas : "gera 1..24"
  categorias ||--o{ despesas : classifica
  categorias ||--o{ receitas : classifica
  cartoes    ||--o{ despesas : "paga (crédito)"
  recorrencias ||--o{ despesas : gera
  recorrencias ||--o{ receitas : gera
  categorias ||--o{ orcamentos : limita
  households ||--o{ tarefas : tem
  households ||--o{ insights : tem
  households ||--o{ auditoria : registra
```

| Tabela | Dono | Quem vê | Quem altera |
|---|---|---|---|
| households, profiles | — | a família | só o próprio perfil (nome/cor) |
| categorias, orcamentos, tarefas, insights | família | a família | qualquer membro |
| cartoes, recorrencias | pessoa | a família | só o dono |
| despesas, parcelas, receitas | pessoa | a família | só o dono |
| auditoria | — | a família | ninguém (só o banco escreve) |

### Views do dashboard

| View | Para quê |
|---|---|
| `vw_parcelas_detalhe` | Parcelas vivas + dados da despesa e categoria (base de tudo) |
| `vw_resumo_mensal` | Conciliação: ganhos, gastos (fixos/variáveis/cartão), saldo, % poupança, % fixos. `user_id` nulo = família |
| `vw_gastos_categoria_mes` | Gráfico de pizza / orçamento × realizado |
| `vw_comprometimento_futuro` | Projeção das faturas dos próximos meses |

### Funções chamadas pelo app (RPC)

| Função | Faz |
|---|---|
| `salvar_despesa(despesa, parcelas)` | Cria/edita/exclui despesa e regenera parcelas, atômico e idempotente |
| `excluir_categoria(categoria, destino)` | Move lançamentos para o destino e exclui |
| `excluir_cartao(cartao)` | Apaga (sem uso) ou arquiva (com histórico) |
| `ping()` | Mantém o Supabase gratuito ativo |

## Estrutura de pastas (alvo ao final das fases)

```
/                       ← publicado no GitHub Pages
├─ index.html           app (Fase 2)
├─ manifest.json        PWA (Fase 2)
├─ sw.js                Service Worker (Fase 2)
├─ CNAME                subdomínio (Fase 2)
├─ css/
├─ js/
│  ├─ config.js         gerado no deploy (NÃO vai para o Git)
│  ├─ app.js            inicialização e navegação
│  ├─ db.js             Supabase (único ponto de contato)
│  ├─ offline.js        IndexedDB: fila + cache
│  ├─ sync.js           envio da fila
│  ├─ parcelas.js       calcularParcelas()
│  ├─ estado.js · geo.js · log.js · formato.js · validacao.js
│  ├─ regras.js         motor de regras (Fase 5)
│  ├─ dashboard.js · mapa.js  (Fase 4)
│  └─ ui/               telas
├─ sql/                 scripts do banco (rodar no Supabase, em ordem)
├─ tests/               testes (SQL e JS)
├─ docs/                documentação
├─ claude-skill/        Skill "Consultor Financeiro Familiar" (Fase 5)
└─ .github/workflows/   automações
```
