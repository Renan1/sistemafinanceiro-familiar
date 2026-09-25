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
**Por quê:** se um dia alguém criar uma política errada, quem não está logado continua sem acesso. Exceções: a função `ping()` (não lê dados) e, desde a v1.2, `registrar_compra_atalho()` (D-44), que só insere na caixa de entrada de quem tem a chave e não devolve dados.

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

### D-29 — Recorrências geradas no aparelho, com id determinístico
**Decisão:** o app (não o banco) gera os lançamentos dos gastos/ganhos fixos, ao abrir com internet, só para as recorrências do próprio usuário. O id de cada lançamento é derivado de (recorrência, mês) por SHA-256.
**Por quê:** despesas no crédito precisam da regra do cartão, que mora em `calcularParcelas()` (D-05). O id determinístico faz dois aparelhos gerando ao mesmo tempo resultarem no MESMO registro (upsert), e o índice único do banco é a trava final.

### D-30 — Excluído não volta
**Decisão:** antes de gerar, o app consulta os meses já gerados **inclusive os excluídos** (soft delete).
**Por quê:** se você excluir o lançamento de um mês (ex.: não pagou a academia em julho), ele não pode reaparecer na próxima abertura.

### D-31 — Alterar valor "a partir de um mês" por função no banco
**Decisão:** `alterar_valor_recorrencia()` encerra a recorrência antiga no mês anterior, cria a nova com `substitui_id` e atualiza os lançamentos já gerados daquele mês em diante — numa transação.
**Por quê:** são 3–4 alterações que precisam acontecer juntas; feitas pelo app, uma queda de conexão no meio deixaria dados inconsistentes. O histórico de reajustes fica navegável pelo `substitui_id`.

### D-32 — Edição passa pela fila
**Decisão:** editar/excluir um lançamento reenvia o registro inteiro com o MESMO id pela fila offline (exclusão = `excluido_em` preenchido).
**Por quê:** mesma garantia do lançamento novo: funciona sem sinal, não duplica, e o banco (RLS) impede alterar o de outra pessoa mesmo que alguém tente.

### D-33 — Cadastros (categorias, recorrências, orçamentos, cartões, perfil) exigem internet
**Por quê:** são raros e afetam a família inteira (ex.: mover lançamentos de categoria). Fazer isso offline abriria espaço para conflitos entre os dois aparelhos, sem ganho real no dia a dia. O registro rápido de gasto/ganho continua 100% offline.

### D-34 — Cores dos gráficos por papel, validadas
**Decisão:** Ganhos = azul, Gastos = laranja, Fixos = violeta, em todo o Painel; categorias usam a cor da própria categoria (a cor segue a entidade). Cada par foi validado com o script de paleta (separação para daltonismo e contraste) no tema claro e no escuro, com tons próprios para cada tema. Cores de status (verde/amarelo/vermelho) ficam reservadas para "dentro/atenção/estourou" e sempre vêm com ícone + texto.
**Por quê:** a mesma cor significando a mesma coisa em todos os gráficos reduz esforço de leitura; validação calculada evita "parece diferente o bastante" no olho.

### D-35 — Gráficos e mapa carregados só no Painel
**Decisão:** Chart.js e Leaflet (com versões fixas) são baixados quando o Painel abre (`js/libs.js`) e guardados pelo Service Worker.
**Por quê:** a tela de gasto — usada no ato da compra — não pode ficar mais lenta por causa de bibliotecas que ela não usa.

### D-36 — Previsto × realizado sem "total inventado"
**Decisão:** o previsto é mostrado por linha: ganhos fixos (recorrências), gastos fixos (recorrências) e gastos variáveis (orçamentos); parcelas de compras de meses anteriores aparecem como informação à parte.
**Por quê:** somar tudo num único "gasto previsto" misturaria coisas de natureza diferente (compromisso fixo, limite desejado, dívida já feita) e esconderia de onde vem a diferença.

### D-37 — Painel calcula no aparelho a partir das views
**Decisão:** 4 consultas por mês (resumo de 12 meses, parcelas do mês até +6, gastos com localização, orçamentos); os agrupamentos por visão/categoria/forma são feitos em `js/dashboard.js`.
**Por quê:** trocar a visão (Eu/Camilla/Família) é instantâneo e funciona offline com a cópia guardada; as funções são puras e testadas.

### D-38 — Regras no aparelho, alertas gravados no banco
**Decisão:** o motor de regras roda no app (`js/regras.js`, funções puras) e grava o resultado com `substituir_insights()` (uma chamada por mês, atômica).
**Por quê:** as regras e os limites ficam num lugar só, legível e testado; o banco guarda o resultado para os dois celulares verem o mesmo, e preserva o "lido". Uma situação que deixou de existir some sozinha na próxima avaliação.

### D-39 — Tarefas de regra são da família e não duplicam
**Decisão:** tarefas geradas por regra têm `user_id` nulo (família) e só existe uma aberta por regra (índice único + checagem no app). Tarefas importadas do Claude não duplicam por título entre as abertas.
**Por quê:** evitar a lista de tarefas virar ruído — cada problema aparece uma vez, até alguém resolvê-lo.

### D-40 — Formatos versionados entre o app e o Claude
**Decisão:** `financas-familia/export@1` (app → Claude) e `financas-familia/tarefas@1` (Claude → app). O exemplo da Skill é gerado pelo próprio `montarExport()` e um teste falha se o formato mudar sem atualizar a Skill.
**Por quê:** o app e a Skill evoluem separados; o campo `formato` e o teste de contrato impedem que um quebre o outro em silêncio.

### D-41 — Export para o Claude minimiza dados pessoais
**Decisão:** o JSON para o Claude leva nomes, valores, categorias e nome do local; **não** leva e-mails, ids internos nem coordenadas GPS. O backup completo (para guardar) leva tudo.
**Por quê:** a análise não precisa desses dados, e o que vai para uma conversa deve ser o mínimo necessário.

### D-51 — Recorrência com valor variável é reconhecida na importação
**Decisão:** na importação, se o lançamento já existente veio de uma **recorrência**, ele casa com a linha do arquivo com até 10% de diferença de valor e ±5 dias; o motivo mostra os dois valores. Lançamento digitado continua exigindo o mesmo valor.
**Por quê:** pensão, aluguel recebido e salário variam de um mês para o outro; a recorrência cria o valor "esperado" e o extrato traz o real. Sem tolerância, o mesmo dinheiro entraria duas vezes. Quem decide é a pessoa (a linha vem desmarcada).

### D-52 — "Financiamentos" como categoria própria e natureza pela categoria
**Decisão:** categoria padrão "Financiamentos" (sql/009). Na importação, a natureza vem da categoria: Financiamentos, Moradia, Contas, Assinaturas, Salário, Pró-labore e Aluguel são **fixos**.
**Por quê:** parcela de financiamento é compromisso mensal, não consumo de transporte; separada, aparece com clareza no Painel e na análise do Claude. Fixos corretos deixam o "fixos × variáveis" e a regra "fixos > 50% da renda" confiáveis sem ajuste manual.

### D-46 — Importação lida no aparelho, com prévia e confirmação
**Decisão:** o arquivo do banco é lido no navegador (`js/importacao.js`); nada é enviado até a pessoa conferir a prévia e tocar em Importar. Os lançamentos vão pela **mesma fila** dos digitados (offline, idempotente).
**Por quê:** extrato é dado sensível — não precisa sair do aparelho; a prévia evita lançamento errado no Painel; reaproveitar a fila garante as mesmas regras de validação e sincronização.

### D-47 — Planilhas com SheetJS 0.18.5 num Web Worker isolado
**Decisão:** .xls/.xlsx são lidos pela SheetJS 0.18.5 (a última publicada no npm/jsDelivr), carregada **dentro de um Web Worker** (`js/planilha-worker.js`) que só devolve as células; tempo limite de 20 s. Não fica no cache de instalação (só é baixada ao importar uma planilha).
**Por quê:** as versões corrigidas da SheetJS só estão no CDN do próprio projeto, fora do padrão do app (jsDelivr com versão fixa). A 0.18.5 tem falhas conhecidas com arquivos **maliciosos**; no worker, um arquivo "envenenado" não alcança a página, a sessão nem os dados, e um travamento é encerrado. Os arquivos importados são exportações dos próprios bancos. Se um dia a SheetJS corrigida chegar ao npm, basta trocar a URL no worker.

### D-48 — "Parcela k/N" da fatura vira uma compra com as parcelas k…N
**Decisão:** a linha "Parcela 9/12" cria uma despesa com as parcelas 9 a 12 (4 parcelas, a partir da fatura importada). No mês seguinte, "Parcela 10/12" casa com a parcela já existente (mesmo cartão, mesmo mês, mesmo valor) e aparece como "parece já lançado".
**Por quê:** mantém a regra de parcelamento única (tabela `parcelas` e competência da fatura) e deixa o Painel mostrar o comprometimento futuro desde a primeira importação, sem precisar dos meses anteriores ao sistema.

### D-49 — Não duplicar: id fixo por linha + "parece já lançado"
**Decisão:** cada linha tem uma chave (pessoa, arquivo/cartão, data, valor, descrição, parcela, ocorrência) e um id fixo derivado dela (SHA-256, como nas recorrências); reimportar encontra o id e marca "já importado". Contra o que foi lançado por outro caminho: mesmo valor e data ±3 dias (conta) ou mesmo cartão, valor e data da compra ±5 dias / mesma parcela no mesmo mês (cartão). Esses aparecem desmarcados, com o lançamento parecido — a pessoa decide.
**Por quê:** a importação tem de conviver com o lançamento no dia a dia (app, Carteira, recorrências) sem contar duas vezes; na dúvida, quem decide é a pessoa, com a informação na tela. A data evita confundir a assinatura do mês passado (mesmo valor) com a deste mês.

### D-50 — O que não é gasto nem ganho
**Decisão:** ignorados por padrão: pagamento de fatura (no cartão e na conta, inclusive boleto do Nubank), aplicação e resgate de investimento, rendimento automático de centavos, compra e estorno que se anulam no mesmo arquivo, "Controle de saldo".
**Por quê:** pagamento de fatura na conta + compras da fatura contariam o mesmo dinheiro duas vezes; investimento não é consumo nem renda. Tudo aparece na aba "Ignorados" com o motivo e pode ser marcado se a pessoa quiser.

### D-44 — Carteira do iPhone: caixa de entrada + chave pessoal do atalho
**Decisão:** o Atalho do iPhone (automação "Transação") chama a função `registrar_compra_atalho()` **sem login**, com uma chave pessoal. A compra entra numa **caixa de entrada** e só vira gasto quando a pessoa confirma no app (categoria sugerida). A chave é gerada pelo banco (2 UUIDs aleatórios ≈ 244 bits), mostrada **uma vez** e guardada só como hash SHA-256; pode ser revogada; limite de 30 envios/hora por chave; no máximo 5 chaves ativas por pessoa. O script `007` confere que só `ping()` e `registrar_compra_atalho()` são chamáveis sem login.
**Por quê:** a Apple não oferece API das transações da Carteira; o Atalhos é o único caminho oficial e não consegue fazer login com e-mail e senha. A caixa de entrada evita gasto errado (sem categoria, valor de estorno) direto no Painel, e a chave limitada a "só inserir na própria caixa" mantém o sistema fechado mesmo se ela vazar — basta revogar.

### D-45 — Gasto da Carteira não usa o GPS do momento
**Decisão:** ao lançar da caixa de entrada, o app não captura a localização.
**Por quê:** a pessoa pode lançar horas depois, em outro lugar; a posição de agora poluiria o mapa do Painel. O nome do estabelecimento já vem da Carteira.

### D-43 — Compra com juros: total = parcela × N, preço à vista opcional
**Decisão:** no modo "Valor da parcela" o app calcula o total como parcela × N e usa a mesma `calcularParcelas()` — a divisão é exata, então as parcelas saem iguais às da loja. O preço à vista fica numa coluna opcional (`valor_a_vista_centavos`); juros = total − à vista; a taxa ao mês é calculada no app (tabela Price, bisseção).
**Por quê:** uma regra de parcelamento só (D-05), sem caso especial no banco nem no Painel; quem não sabe o preço à vista não precisa informar nada. Guardar o à vista (e não os juros) mantém um único dado de origem.

### D-42 — Seis abas
**Decisão:** Gasto · Ganho · Lançamentos · Painel · **Saúde** · Mais.
**Por quê:** a Saúde precisa estar à vista (com o selo de alertas) para cumprir o papel de "tarefas de melhoria"; cabe na largura do iPhone com rótulos curtos.
