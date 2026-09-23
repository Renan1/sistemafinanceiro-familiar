# Registro de Decisões Técnicas

Cada decisão importante fica registrada aqui com **o que** foi decidido e **por quê**. Assim, daqui a um ano, dá para entender o motivo de cada escolha sem depender da memória. Formato: uma seção por decisão, numerada (D-01, D-02…). Decisões não são apagadas: se mudar, cria-se uma nova que "substitui" a antiga.

---

### D-01 — Sem framework e sem etapa de build
**Decisão:** HTML + CSS + JavaScript puro (ES modules). Bibliotecas por CDN.
**Por quê:** hospedagem direta no GitHub Pages, nada para compilar, qualquer arquivo pode ser lido e entendido isoladamente. Menos peças = menos coisas para quebrar.

### D-02 — Supabase como backend
**Decisão:** Postgres + Auth + RLS do Supabase (plano gratuito), região São Paulo.
**Por quê:** banco relacional de verdade (bom para somas por mês, views, constraints), login pronto e segurança por linha (RLS) sem precisarmos escrever servidor.

### D-03 — Valores em centavos (bigint)
**Por quê:** números com vírgula (float) geram erros de arredondamento (0,1 + 0,2 ≠ 0,3). Inteiros em centavos são sempre exatos.

### D-04 — Toda despesa gera parcelas; dashboard lê só de `parcelas`
**Por quê:** uma compra de 12x no cartão pesa 1/12 em cada mês de fatura. Se à vista também gerar 1 parcela, o dashboard tem **uma única fonte** de "quanto saiu em cada mês", sem regras especiais.

### D-05 — Parcelas calculadas no app, conferidas no banco
**Decisão:** a função JS `calcularParcelas()` calcula (com testes). A RPC `salvar_despesa()` grava despesa + parcelas numa transação e **confere** quantidade, numeração e soma.
**Por quê:** o app precisa calcular sem internet (para mostrar "12x de R$ 83,33 — 1ª em Nov/26" e para a fila offline). Ter a regra em um lugar só evita divergência; o banco garante que nada inconsistente seja gravado.

### D-06 — IDs gerados no aparelho + gravação idempotente
**Decisão:** `crypto.randomUUID()` no celular; o servidor faz upsert por id.
**Por quê:** permite salvar sem internet e reenviar quantas vezes for preciso sem duplicar (critério CA-01).

### D-07 — Nenhuma chave no repositório
**Decisão:** `js/config.js` fica no `.gitignore`. Na publicação, o GitHub Actions gera esse arquivo a partir dos **Secrets** `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
**Observação honesta:** a chave anon/publishable **fica visível no navegador** de quem abre o site — é assim em qualquer app Supabase e ela foi feita para isso. Sozinha, ela **não dá acesso a dado nenhum**: sem login, o banco nega tudo (RLS + GRANTs, ver D-09). A chave perigosa (`service_role`/secret) nunca sai do painel do Supabase.

### D-08 — Sem cadastro público; contas criadas no painel
**Por quê:** o sistema é só da família. Desligar o cadastro público elimina o risco de um estranho criar conta. As duas contas são criadas em Authentication → Users e ligadas à família pelo `002_bootstrap_familia.sql`.

### D-09 — Segurança em duas camadas (RLS + GRANTs)
**Decisão:** RLS em todas as tabelas **e** revogação de todos os privilégios do papel `anon`.
**Por quê:** se um dia alguém criar uma política errada, quem não está logado continua sem acesso. Única exceção: a função `ping()` (não lê dados).

### D-10 — Função `meu_household()` com SECURITY DEFINER
**Por quê:** as políticas de todas as tabelas precisam saber "qual a família do usuário logado", o que exige ler `profiles`. Se essa leitura passasse pelo RLS de `profiles`, cairia em recursão. A função roda com permissão do dono e devolve só o `household_id` do próprio usuário.

### D-11 — Soft delete em despesas e receitas
**Decisão:** excluir = preencher `excluido_em`. As parcelas são apagadas de fato.
**Por quê:** a exclusão feita offline precisa ser sincronizada como qualquer outra alteração (idempotente); o histórico fica para a auditoria.

### D-12 — Cartão com histórico é arquivado, não apagado
**Por quê:** apagar quebraria as faturas e parcelas passadas. Arquivado, some das telas mas mantém os relatórios corretos. Cartão nunca usado é apagado de vez.

### D-13 — Excluir categoria em uso exige destino
**Decisão:** função `excluir_categoria(categoria, destino)` move despesas, receitas e recorrências (de todos os membros) e depois exclui. Orçamentos da categoria são removidos.
**Por quê:** nenhum lançamento pode ficar sem categoria; e categorias são da família, então mover lançamentos de ambos é uma ação legítima (feita por função SECURITY DEFINER com checagem de família).

### D-14 — Validação de referências entre famílias
**Decisão:** gatilho `tg_validar_referencias` confere que categoria/cartão/recorrência usados num lançamento são da mesma família e que o tipo da categoria bate (gasto × ganho).
**Por quê:** chaves estrangeiras só verificam se o id existe, não de quem é.

### D-15 — Recorrências: chave (recorrencia_id, competência) e "alterar a partir de um mês"
**Decisão:** índice único impede gerar o mesmo mês duas vezes (mesmo com dois aparelhos abrindo o app ao mesmo tempo). Alterar valor encerra a recorrência atual (`data_fim`) e cria outra com `substitui_id` apontando para a antiga.
**Por quê:** o histórico dos meses anteriores continua com o valor antigo, sem reescrever o passado.

### D-16 — Auditoria por gatilho no banco
**Por quê:** registra **tudo** (inclusive alterações feitas pelo painel do Supabase), sem depender do app lembrar de logar. Somente leitura para os usuários.

### D-17 — Views com `security_invoker = true`
**Por quê:** sem isso, uma view roda com permissão do dono e ignoraria o RLS — vazaria dados de outras famílias. O `003_verificacao.sql` confere isso.

### D-18 — Dashboard único com conciliação no topo
**Decisão (Renan, 23/09/2026):** não haverá aba "Mês" separada. O **Dashboard** tem filtros de mês e visão (Eu / cônjuge / Família) e começa pelo bloco de conciliação (previsto × realizado).

### D-19 — "100% online" + rede de segurança local
**Decisão (Renan, 23/09/2026):** o sistema roda inteiramente na internet (GitHub Pages + Supabase), sem servidor próprio. O banco online é a única fonte da verdade; o navegador só guarda **temporariamente** o que foi lançado sem sinal, e envia assim que possível.

### D-20 — Supabase gratuito: ping a cada 3 dias
**Por quê:** o plano gratuito pausa o projeto após 7 dias sem uso, e o uso não será diário. O workflow `manter-supabase-ativo.yml` chama `ping()` a cada 3 dias. O GitHub desativa agendamentos após 60 dias sem commits em repositório público — nesse caso ele avisa por e-mail e basta reativar.

### D-21 — Política de senha
**Decisão:** mínimo de 8 caracteres com maiúscula, minúscula, número e especial (configuração do Supabase Auth + validação no app). Recomendado usar 12 ou mais — tamanho é o fator que mais aumenta a segurança.

### D-22 — Testes do banco no GitHub Actions
**Decisão:** `tests/sql/` simula o Supabase num Postgres limpo e roda testes de RLS e regras a cada push.
**Por quê:** garante que uma mudança futura no SQL não abra um buraco de segurança sem ninguém perceber. Não exige nada instalado no Windows.

### D-23 — Publicação pelo GitHub Actions (não pela branch)
**Decisão:** o workflow `publicar.yml` monta a pasta do site, gera `js/config.js` com os Secrets e publica no Pages. Só os arquivos do app vão para o ar (`sql/`, `docs/`, `tests/` não).
**Por quê:** é a única forma de publicar sem colocar a URL/chave no repositório (D-07) e de rodar os testes antes — teste falhou, não publica.

### D-24 — Bibliotecas de CDN com versão fixa
**Decisão:** supabase-js carregado de `cdn.jsdelivr.net` com versão exata (2.117.1), guardado em cache pelo Service Worker.
**Por quê:** uma versão nova da biblioteca não muda o app sem aviso; atualizar é uma decisão consciente (um commit).

### D-25 — Abrir o app sem depender da internet
**Decisão:** se há perfil guardado no aparelho e sessão guardada, o app abre direto na tela de gasto, mesmo que o acesso (token) tenha expirado. A renovação acontece em segundo plano quando houver sinal. A tela de login só aparece se não houver sessão guardada ou se o Supabase encerrar a sessão.
**Por quê:** o token do Supabase dura 1 hora. Sem isso, abrir o app no mercado sem sinal, horas depois, cairia no login e impediria o registro (CA-05).

### D-26 — A fila é por usuário
**Decisão:** cada item da fila guarda o `user_id` de quem lançou; só é enviado quando esse mesmo usuário estiver logado. Sair da conta apaga o cache, mas **não** a fila.
**Por quê:** se outra pessoa entrasse no mesmo aparelho, os lançamentos pendentes não podem ser enviados em nome dela.

### D-27 — Recusa do servidor não fica em loop
**Decisão:** falhas de rede/servidor/sessão mantêm o item "pendente" (tenta de novo depois). Recusa definitiva (dado inválido, sem permissão) marca o item como "erro", visível em Lançamentos com "tentar de novo" e "descartar".
**Por quê:** um item inválido tentando para sempre travaria a fila e gastaria bateria.

### D-28 — Service Worker: cache primeiro, versão por commit
**Decisão:** arquivos do app e bibliotecas são servidos do cache (rápido e offline). Cada publicação troca o nome do cache pelo hash do commit, o que faz o navegador baixar a versão nova e o app oferecer "toque para atualizar" — nunca recarrega sozinho no meio de um lançamento. No PC (versão não publicada) usa rede primeiro, para ver alterações na hora.
