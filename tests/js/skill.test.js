/**
 * tests/js/skill.test.js — A Skill do Claude e o app falam o mesmo formato
 *
 * Se o formato do export mudar no app (js/exportacao.js), estes testes falham
 * até o exemplo e a documentação da Skill serem atualizados juntos.
 * Rodar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarExport, lerTarefasDoClaude, FORMATO_EXPORT, FORMATO_TAREFAS } from '../../js/exportacao.js';

const PASTA = 'claude-skill/consultor-financeiro';
const exemplo = JSON.parse(readFileSync(`${PASTA}/exemplos/export-exemplo.json`, 'utf8'));
const skill = readFileSync(`${PASTA}/SKILL.md`, 'utf8');
const referencia = readFileSync(`${PASTA}/referencias/formato-export.md`, 'utf8');

test('SKILL.md tem frontmatter válido (name em minúsculas com hífens, description ≤ 1024)', () => {
  const fm = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1].trim();
  assert.match(name, /^[a-z0-9-]{1,64}$/);
  assert.ok(description && description.length <= 1024);
  assert.ok(skill.includes(FORMATO_EXPORT) && skill.includes(FORMATO_TAREFAS));
});

test('o exemplo tem exatamente os campos que o app gera hoje', () => {
  const vazio = montarExport({ competencia: '2026-10-01', familia: { nome: 'X' }, membros: [], categorias: [], cartoes: [], recorrencias: [],
    dados: { resumo: [], despesas: [], receitas: [], parcelas: [], orcamentos: [], insights: [], tarefas: [] } });
  assert.deepEqual(Object.keys(exemplo), Object.keys(vazio));
  assert.equal(exemplo.formato, FORMATO_EXPORT);
});

test('todo campo de primeiro nível está documentado na referência', () => {
  const faltando = Object.keys(exemplo).filter((c) => !referencia.includes(`\`${c}`));
  assert.deepEqual(faltando, []);
});

test('o bloco de tarefas da resposta de exemplo é importável pelo app', () => {
  const resposta = readFileSync(`${PASTA}/exemplos/resposta-exemplo.md`, 'utf8');
  const r = lerTarefasDoClaude(resposta, [{ id: 'r', nome: 'Renan' }, { id: 'c', nome: 'Camilla' }]);
  assert.deepEqual(r.erros, []);
  assert.ok(r.tarefas.length >= 3 && r.tarefas.length <= 5);
  assert.equal(r.tarefas.at(-1).user_id, 'c');
});

test('os números citados no README da Skill batem com o exemplo', () => {
  const familiaOut = exemplo.resumo_mensal.find((l) => l.competencia === '2026-10-01' && l.pessoa === 'Família');
  assert.equal(familiaOut.saldo, 685470);
  assert.equal(familiaOut.taxa_poupanca_pct, 55.7);
  const deliv = exemplo.orcamentos.find((o) => o.categoria === 'Restaurante/Delivery');
  assert.equal(Math.round(100 * deliv.realizado / deliv.orcado), 158);
});
