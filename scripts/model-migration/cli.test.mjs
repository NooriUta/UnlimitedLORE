// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — точка входа установщика переноса.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, help, COMMANDS, VERSION } from './cli.mjs';

test('команды названы в порядке шагов; пишущие в новую базу помечены', () => {
  assert.deepEqual(COMMANDS.map(c => c.name), ['install-bundle', 'connect', 'init-empty', 'census', 'orphans', 'statuses', 'dry-run', 'transfer', 'edges', 'ui', 'pr-backfill', 'dst-fingerprint']);
  assert.deepEqual(COMMANDS.filter(c => c.write).map(c => c.name), ['init-empty', 'transfer', 'edges']);
  const h = help();
  for (const c of COMMANDS) assert.ok(h.includes(c.name), c.name);
  assert.ok(h.includes(VERSION));
});

test('строка запуска: команда, файл доступа, файл решений; остальные ключи идут команде', () => {
  const a = parseArgs(['statuses', '--env', 'access.env', '--decisions', 'd.json', '--out', 'x.json']);
  assert.equal(a.command.name, 'statuses');
  assert.equal(a.env, path.resolve('access.env'));
  assert.equal(a.decisions, path.resolve('d.json'));
  assert.deepEqual(a.rest, ['--out', 'x.json']);
  // порядок ключей и команды не важен
  assert.equal(parseArgs(['--env', 'a.env', 'dry-run']).command.name, 'dry-run');
});

test('ошибки строки запуска называются словами, а не падением', () => {
  const saved = process.env.MIG_ENV_FILE;
  delete process.env.MIG_ENV_FILE;
  try {
    assert.match(parseArgs(['statuses']).error, /файл доступа/);
    assert.match(parseArgs(['нет-такой', '--env', 'a']).error, /нет-такой/);
    assert.match(parseArgs(['statuses', '--env']).error, /путь к файлу/);
    assert.match(parseArgs(['statuses', '--env', '--out']).error, /путь к файлу/);
    assert.equal(parseArgs([]).help, true);
    assert.equal(parseArgs(['help']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
  } finally { if (saved !== undefined) process.env.MIG_ENV_FILE = saved; }
});

test('независимость от операционки: в коде установщика нет оболочки, внешних программ и путей машины', () => {
  const dir = new URL('.', import.meta.url);
  const own = ['cli.mjs', 'resources.mjs', 'env.mjs', 'db.mjs', 'apply-map.mjs', 'decisions.mjs', 'status-unify.mjs', 'fingerprint.mjs',
    'probe.mjs', 'dst-fingerprint.mjs', 'pr-backfill.mjs', 'ui.mjs', 'status-run.mjs', 'auth.mjs', 'report.mjs', 'dicts.mjs', 'edge-census.mjs', 'orphan-census.mjs', 'status-check.mjs', 'dry-run.mjs', 'transfer.mjs', 'transfer-edges.mjs', 'structure-plan.mjs', 'key-dups.mjs', 'qg-actions.mjs', 'edge-history.mjs', 'decision-milestones.mjs', 'orphan-sprints.mjs', 'question-owner.mjs',
    // 18.11.2026: модули окна установщика — тоже код, который едет к пользователю.
    'setup.mjs', 'setup-check.mjs', 'machine-enroll.mjs', 'kc-realm.mjs'];
  for (const f of own) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/node:child_process|execSync|spawn\(/.test(s), f + ': запуск внешней программы');
    assert.ok(!/['"`][A-Za-z]:[\\/]/.test(s), f + ': путь диска Windows');
    assert.ok(!/['"`]\/(tmp|home|usr|etc|var)\//.test(s), f + ': путь файловой системы Linux');
    assert.ok(!/process\.platform/.test(s), f + ': ветвление по операционке');
    const imports = [...s.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    for (const i of imports) assert.ok(i.startsWith('node:') || i.startsWith('.'), f + ': сторонний пакет ' + i);
  }
});

test('код установщика не ищет файлы рядом с собой: в исполняемом файле модуль живёт в памяти, import.meta.url — не путь', () => {
  const dir = new URL('.', import.meta.url);
  for (const f of ['cli.mjs', 'resources.mjs', 'env.mjs', 'db.mjs', 'apply-map.mjs', 'decisions.mjs', 'status-unify.mjs', 'fingerprint.mjs',
    'probe.mjs', 'dst-fingerprint.mjs', 'pr-backfill.mjs', 'ui.mjs', 'status-run.mjs', 'auth.mjs', 'report.mjs', 'dicts.mjs', 'edge-census.mjs', 'orphan-census.mjs', 'status-check.mjs', 'dry-run.mjs', 'transfer.mjs', 'transfer-edges.mjs', 'structure-plan.mjs', 'edge-history.mjs', 'orphan-sprints.mjs']) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/import\.meta\.url/.test(s), f + ': поиск файла рядом с модулем');
  }
});
