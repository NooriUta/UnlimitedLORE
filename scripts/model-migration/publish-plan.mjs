#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Выкладка установщика в kkRepo (raw-hosted репозиторий, PUT по адресу файла).
// Каталог версии: <base>/<repo>/<версия>/lore-migrate-<версия>.mjs, …-linux-x64, …-win-x64.exe и SHA256SUMS.
// Учётка — KKREPO_USER / KKREPO_PASSWORD из секретов CI; в лог не печатаются.
// Запуск: node publish-plan.mjs --dir build --version 0.1.0 [--dry]   (адрес и репозиторий — KKREPO_BASE, KKREPO_REPO)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

export function versionOf({ input, sha }) {
  if (!(input && input.trim()) && !/^[0-9a-f]{8,}$/.test(sha || '')) throw new Error('версия не задана и коммит неизвестен — задайте --version');
  const v = input && input.trim() ? input.trim() : '0.0.0-preview.' + sha.slice(0, 8);
  if (!VERSION_RE.test(v)) throw new Error('версия не по образцу 1.2.3[-метка]: ' + v);
  return v;
}

/** Имя в каталоге: версия внутри имени, чтобы скачанный файл не путался с другим. */
function published(name, version) {
  if (name === 'lore-migrate.mjs') return `lore-migrate-${version}.mjs`;
  if (name === 'lore-migrate') return `lore-migrate-${version}-linux-x64`;
  if (name === 'lore-migrate.exe') return `lore-migrate-${version}-win-x64.exe`;
  throw new Error('неизвестный файл установщика: ' + name);
}

export function sha256sums(files) {
  return files.map(f => crypto.createHash('sha256').update(f.bytes).digest('hex') + '  ' + f.name + '\n').join('');
}

export function publishPlan({ base, repo, version, files }) {
  if (!/^https?:\/\/[^/]+/.test(base || '')) throw new Error('адрес kkRepo не http(s): ' + base);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(repo || '')) throw new Error('репозиторий kkRepo — только строчные, цифры и дефис: ' + repo);
  versionOf({ input: version });
  const dir = base.replace(/\/+$/, '') + '/' + repo + '/' + version + '/';
  const out = files.map(f => ({ name: published(f.name, version), bytes: f.bytes }));
  return [...out.map(f => ({ url: dir + f.name, bytes: f.bytes })), { url: dir + 'SHA256SUMS', bytes: Buffer.from(sha256sums(out)) }];
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = arg('--dir') || 'build', dry = process.argv.includes('--dry');
  const version = versionOf({ input: arg('--version'), sha: process.env.GITHUB_SHA });
  const files = ['lore-migrate.mjs', 'lore-migrate', 'lore-migrate.exe'].filter(n => fs.existsSync(path.join(dir, n)))
    .map(n => ({ name: n, bytes: fs.readFileSync(path.join(dir, n)) }));
  if (!files.some(f => f.name === 'lore-migrate.mjs')) throw new Error('нет ' + path.join(dir, 'lore-migrate.mjs') + ' — сначала build-installer.mjs');
  const plan = publishPlan({ base: process.env.KKREPO_BASE || 'http://192.168.3.131:8081/repository', repo: process.env.KKREPO_REPO || 'lore-installer', version, files });
  const user = process.env.KKREPO_USER, pass = process.env.KKREPO_PASSWORD;
  if (!dry && (!user || !pass)) throw new Error('BLOCKED: нет KKREPO_USER / KKREPO_PASSWORD — учётку с правом записи заводит владелица в админке kkRepo');
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  for (const p of plan) {
    if (dry) { console.log('план: PUT ' + p.url + ' · ' + p.bytes.length + ' байт'); continue; }
    const r = await fetch(p.url, { method: 'PUT', headers: { authorization: auth, 'content-type': 'application/octet-stream' }, body: p.bytes });
    if (!r.ok) throw new Error('PUT ' + p.url + ' → ' + r.status + ' ' + (await r.text()).slice(0, 300));
    // Проба фактом: файл читается обратно и совпадает по размеру — код ответа PUT не доказательство.
    const g = await fetch(p.url, { headers: { authorization: auth } });
    const got = g.ok ? Buffer.from(await g.arrayBuffer()) : null;
    if (!got || got.length !== p.bytes.length) throw new Error('выложено, но не читается обратно: ' + p.url + ' → ' + g.status);
    console.log('выложено и прочитано обратно: ' + p.url + ' · ' + got.length + ' байт');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('::error::' + e.message); process.exitCode = 1; });
}
