/**
 * tests/js/service-worker.test.js — O app precisa abrir SEM INTERNET (RNF-13)
 *
 * Se um arquivo .js novo não estiver na lista ARQUIVOS do sw.js, o app
 * quebra offline sem ninguém perceber. Este teste compara a pasta js/ com a
 * lista e falha se faltar algum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arquivosJs(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivosJs(caminho) : caminho.endsWith('.js') ? [caminho.replaceAll('\\', '/')] : [];
  });
}

test('todo arquivo de js/ está no cache do Service Worker', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const lista = [...sw.matchAll(/'(js\/[^']+\.js)'/g)].map((m) => m[1]);
  // config.exemplo.js não vai para o ar; config.js é gerado no deploy.
  const esperados = arquivosJs('js').filter((f) => f !== 'js/config.exemplo.js' && f !== 'js/config.js');
  const faltando = esperados.filter((f) => !lista.includes(f));
  assert.deepEqual(faltando, [], `Adicione ao ARQUIVOS do sw.js: ${faltando.join(', ')}`);
  assert.ok(lista.includes('js/config.js'), 'js/config.js precisa estar no cache');
});

test('a versão do supabase-js é a mesma no index.html e no sw.js', () => {
  const versao = (texto) => texto.match(/supabase-js@([\d.]+)/)?.[1];
  assert.equal(versao(readFileSync('sw.js', 'utf8')), versao(readFileSync('index.html', 'utf8')));
});

test('as bibliotecas do Painel (js/libs.js) estão no cache do Service Worker', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const libs = [...readFileSync('js/libs.js', 'utf8').matchAll(/'(https:\/\/cdn[^']+)'/g)].map((m) => m[1]);
  assert.ok(libs.length >= 6);
  const faltando = libs.filter((u) => !sw.includes(`'${u}'`));
  assert.deepEqual(faltando, [], `Adicione ao ARQUIVOS do sw.js: ${faltando.join(', ')}`);
});
