// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Архив исходников LORE в пакете установщика — «наш проект для собственной
// сборки если что» (владелица 20.11.2026). Сторож: секретов и .env в архиве нет; имя и sha256 — по образцу.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { archiveName, forbiddenEntries, tarEntries, archivePlan } from './source-archive.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const gitTar = () => execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '--worktree-attributes', 'HEAD'], { maxBuffer: 1 << 30 });

test('имя архива — src/lore-<версия>.tar.gz; кривая версия отбивается', () => {
  assert.equal(archiveName('1.18.0'), 'src/lore-1.18.0.tar.gz');
  assert.equal(archiveName('0.0.0-preview.abcdef01'), 'src/lore-0.0.0-preview.abcdef01.tar.gz');
  assert.throws(() => archiveName('../x'), /версия/);
  assert.throws(() => archiveName(''), /версия/);
});

test('запретные имена: .env*, *.secret, *.key (и ключи pem/p12/jks) — на любой глубине', () => {
  const bad = forbiddenEntries(['.env', 'a/.env.local', 'deploy/install/.env.example', 'x/y.secret', 'k.key', 'tls/c.pem', 'ok/readme.md', 'src/env.ts', 'keys.md']);
  assert.deepEqual(bad, ['.env', 'a/.env.local', 'deploy/install/.env.example', 'x/y.secret', 'k.key', 'tls/c.pem']);
});

test('план сборки архива: git archive коммита, без push и реестров', () => {
  const p = archivePlan({ rev: 'abc1234', out: '/b', version: '1.0.0' });
  assert.deepEqual(p.git, ['archive', '--format=tar', '--worktree-attributes', 'abc1234']);
  assert.equal(p.file, '/b/src/lore-1.0.0.tar.gz');
  assert.equal(p.sha, '/b/src/lore-1.0.0.tar.gz.sha256');
  assert.doesNotMatch(JSON.stringify(p), /push|login|registry/);
});

test('разбор tar: длинные пути (pax) и обычные; глобальный заголовок коммита — не файл', () => {
  const tar = gitTar();
  const names = tarEntries(tar);
  assert.ok(names.includes('backend/Dockerfile.local'), 'в архиве есть исходники бэкенда');
  assert.ok(names.includes('web-next/Dockerfile'), 'в архиве есть исходники веба');
  assert.ok(names.some(n => n.length > 100), 'длинный путь (pax) разобран');
  assert.ok(!names.some(n => n.startsWith('pax_global_header')), 'глобальный заголовок — не файл');
});

test('сторож: в архиве исходников HEAD нет .env*, *.secret, *.key (.gitattributes export-ignore)', () => {
  const tar = gitTar();
  assert.deepEqual(forbiddenEntries(tarEntries(tar)), []);
  // и сжатый вид разбирается тем же сторожем
  assert.deepEqual(forbiddenEntries(tarEntries(zlib.gunzipSync(zlib.gzipSync(tar)))), []);
});
