-- =============================================================================
-- tests/sql/30_testes_fase5.sql — Testes da Fase 5 (alertas e tarefas)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

set role authenticated;
select teste.como('renan@teste.com');
select id as renan_id from profiles where nome = 'Renan' \gset

select substituir_insights('2026-10-15', jsonb_build_array(
  jsonb_build_object('regra_codigo', 'POUPANCA_BAIXA', 'severidade', 'atencao', 'mensagem', 'Poupança 5%', 'dados', '{"taxa":5}'::jsonb),
  jsonb_build_object('regra_codigo', 'SEM_RECEITA', 'severidade', 'atencao', 'mensagem', 'Sem ganho', 'user_id', :'renan_id')));
select teste.ok((select count(*) from insights where competencia = '2026-10-01') = 2,
                'Grava os alertas do mês (competência normalizada para o dia 1)');

update insights set lido = true where regra_codigo = 'POUPANCA_BAIXA';

-- Reavaliação: POUPANCA continua, SEM_RECEITA sumiu, entrou DESPESA_MAIOR_RECEITA
select substituir_insights('2026-10-01', jsonb_build_array(
  jsonb_build_object('regra_codigo', 'POUPANCA_BAIXA', 'severidade', 'critico', 'mensagem', 'Poupança -2%'),
  jsonb_build_object('regra_codigo', 'DESPESA_MAIOR_RECEITA', 'severidade', 'critico', 'mensagem', 'Gastos > ganhos')));
select teste.ok((select count(*) from insights where competencia = '2026-10-01') = 2
            and not exists (select 1 from insights where regra_codigo = 'SEM_RECEITA'),
                'Alerta que deixou de valer é removido');
select teste.ok((select lido and severidade = 'critico' and mensagem = 'Poupança -2%' from insights where regra_codigo = 'POUPANCA_BAIXA'),
                'Alerta que continua mantém "lido" e atualiza severidade/mensagem');
select teste.ok((select not lido from insights where regra_codigo = 'DESPESA_MAIOR_RECEITA'), 'Alerta novo chega como não lido');

select teste.erro($$select substituir_insights('2026-10-01', '[{"regra_codigo":"X","severidade":"grave","mensagem":"m"}]')$$,
  'Severidade inválida é recusada (constraint)');

-- Tarefas: importação do Claude e da regra não duplicam a regra aberta
insert into tarefas (titulo, origem, regra_codigo) values ('Fechar o mês no azul', 'regra', 'DESPESA_MAIOR_RECEITA_F5');
select teste.erro($$insert into tarefas (titulo, origem, regra_codigo) values ('De novo', 'regra', 'DESPESA_MAIOR_RECEITA_F5')$$,
  'Regra não abre segunda tarefa enquanto a primeira está aberta');
update tarefas set status = 'feita', concluida_em = now() where regra_codigo = 'DESPESA_MAIOR_RECEITA_F5';
insert into tarefas (titulo, origem, regra_codigo) values ('Fechar o mês no azul', 'regra', 'DESPESA_MAIOR_RECEITA_F5');
select teste.ok((select count(*) from tarefas where regra_codigo = 'DESPESA_MAIOR_RECEITA_F5') = 2,
                'Depois de concluída, a regra pode abrir uma nova tarefa');
insert into tarefas (titulo, descricao, origem, prioridade) values ('Montar reserva de emergência', 'Meta: 6 meses de fixos', 'claude', 1);
select teste.ok((select origem from tarefas where titulo = 'Montar reserva de emergência') = 'claude', 'Tarefa importada do Claude');

-- Camilla vê e conclui tarefa da família; intruso não vê nada
select teste.como('camilla@teste.com');
select teste.ok((select count(*) from insights where competencia = '2026-10-01') = 2, 'Camilla vê os alertas da família');
update tarefas set status = 'feita', concluida_em = now() where titulo = 'Montar reserva de emergência';
select teste.ok((select status from tarefas where titulo = 'Montar reserva de emergência') = 'feita', 'Camilla conclui tarefa da família');

select teste.como('intruso@teste.com');
select teste.ok((select count(*) from insights) = 0 and (select count(*) from tarefas) = 0, 'Intruso não vê alertas nem tarefas');
select substituir_insights('2026-10-01', '[]');
select teste.como('renan@teste.com');
select teste.ok((select count(*) from insights where competencia = '2026-10-01') = 2,
                'Intruso rodando a função não apaga alertas de outra família');

reset role;
\echo '==> TESTES DA FASE 5 PASSARAM'
