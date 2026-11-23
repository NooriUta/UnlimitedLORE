#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Выкладка установщика в kkRepo (raw-hosted репозиторий, PUT по адресу файла).
// Каталог версии: <base>/<repo>/<версия>/lore-migrate-<версия>.mjs, …-linux-x64, …-win-x64.exe, images/ (forgejo-mcp),
// src/lore-<версия>.tar.gz (исходники для собственной сборки) и SHA256SUMS.
// Учётка — KKREPO_USER / KKREPO_PASSWORD из секретов CI; в лог не печатаются.
// Запуск: node publish-plan.mjs --dir build --version 0.1.0 [--dry]   (адрес и репозиторий — KKREPO_BASE, KKREPO_REPO)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prunePlan, versionsFromAssets } from './prune-plan.mjs';
import { FORGEJO_MCP_ARCHIVE, FORGEJO_MCP_LICENSE, FORGEJO_MCP_SRC_ARCHIVE } from './forgejo-mcp-image.mjs';
import { MINILORE_ARCHIVE } from './minilore-image.mjs';

const FMCP_TAR = path.basename(FORGEJO_MCP_ARCHIVE);
// Образ сервера miniLORE — тем же каталогом images/ версии (22.11.2026): в пакете он зовётся без реестра,
// адрес реестра остаётся в трубе. Без этой строки архив образа молча не выкладывался бы.
const MINILORE_TAR = path.basename(MINILORE_ARCHIVE);
// Исходник forgejo-mcp и его лицензия (владелица 21.11.2026: «исходник кладём прямо в пакет установки») — каталогом src/.
const FMCP_SRC = [path.basename(FORGEJO_MCP_SRC_ARCHIVE), path.basename(FORGEJO_MCP_SRC_ARCHIVE) + '.sha256', path.basename(FORGEJO_MCP_LICENSE)];

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
  // MSI для Windows собирается на Windows (build-msi.mjs) и приходит готовым — имя уже с версией; чужая версия — отказ.
  const msi = /^lore-installer-(.+)-win-x64\.msi$/.exec(name);
  if (msi) {
    if (msi[1] !== version) throw new Error('версия в имени MSI (' + msi[1] + ') не совпадает с версией каталога ' + version);
    return name;
  }
  // Образ forgejo-mcp архивом docker save (20.11.2026: «не публиковать, включить в инсталятор») — каталогом images/ версии.
  if (name === FMCP_TAR || name === FMCP_TAR + '.sha256') return 'images/' + name;
  if (name === MINILORE_TAR || name === MINILORE_TAR + '.sha256') return 'images/' + name;
  if (FMCP_SRC.includes(name)) return 'src/' + name;
  // Архив исходников LORE для собственной сборки (20.11.2026: «архивом наш проект для собственной сборки если что») —
  // каталогом src/ версии (source-archive.mjs); версия в имени обязана совпасть с каталогом.
  const src = /^lore-(.+)\.tar\.gz(\.sha256)?$/.exec(name);
  if (src) {
    if (src[1] !== version) throw new Error('версия в имени архива исходников (' + src[1] + ') не совпадает с версией каталога ' + version);
    return 'src/' + name;
  }
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

/**
 * Чистка репозитория по prune-plan.mjs. Список — search/assets kkRepo (Nexus-совместимый, постранично); время выкладки
 * предварительных — Last-Modified их SHA256SUMS. Удаление — DELETE по пути файла и проверка, что файл больше не отдаётся.
 */
async function prune({ base, repo, auth, dry }) {
  const origin = new URL(base).origin, items = [], hdr = auth ? { authorization: auth } : {};
  let token = '';
  do {
    const u = new URL('/service/rest/v1/search/assets', origin);
    u.searchParams.set('repository', repo);
    if (token) u.searchParams.set('continuationToken', token);
    const r = await fetch(u, { headers: hdr });
    if (!r.ok) throw new Error('список файлов kkRepo не прочитан: ' + r.status + ' — чистку не делаю');
    const j = await r.json();
    items.push(...(j.items || []));
    token = j.continuationToken || '';
  } while (token);
  const dir = base.replace(/\/+$/, '') + '/' + repo + '/';
  const byVersion = versionsFromAssets(items);
  const list = [];
  for (const [version, paths] of Object.entries(byVersion)) {
    let at = '';
    if (version.includes('-')) {
      const h = await fetch(dir + version + '/SHA256SUMS', { method: 'HEAD', headers: hdr });
      const lm = h.headers.get('last-modified');
      at = lm ? new Date(lm).toISOString() : '';
    }
    list.push({ version, at, paths });
  }
  const plan = prunePlan(list);
  console.log('чистка: версий ' + list.length + ', остаются ' + plan.keep.length + (plan.keep.length ? ' (' + plan.keep.join(', ') + ')' : '')
    + ', удаляются ' + plan.remove.length + (plan.remove.length ? ' (' + plan.remove.join(', ') + ')' : ''));
  if (dry) return;
  for (const v of plan.remove) for (const p of byVersion[v]) {
    const r = await fetch(dir + p, { method: 'DELETE', headers: hdr });
    if (!r.ok && r.status !== 404) throw new Error('DELETE ' + p + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200) + ' (нужно право delete у роли lore-installer-publisher)');
    const g = await fetch(dir + p, { method: 'HEAD', headers: hdr });
    if (g.status !== 404) throw new Error('удалено, но файл ещё отдаётся: ' + p + ' → ' + g.status);
    console.log('удалено и проверено: ' + p);
  }
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = arg('--dir') || 'build', dry = process.argv.includes('--dry');
  const base = process.env.KKREPO_BASE || 'http://192.168.3.131:8081/repository', repo = process.env.KKREPO_REPO || 'lore-installer';
  if (process.argv.includes('--prune-only')) {
    const u = process.env.KKREPO_USER, pw = process.env.KKREPO_PASSWORD;
    if (!dry && (!u || !pw)) throw new Error('BLOCKED: нет KKREPO_USER / KKREPO_PASSWORD — чистка без учётки невозможна');
    return prune({ base, repo, auth: u && pw ? 'Basic ' + Buffer.from(u + ':' + pw).toString('base64') : '', dry });
  }
  const version = versionOf({ input: arg('--version'), sha: process.env.GITHUB_SHA });
  const msis = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^lore-installer-.+-win-x64\.msi$/.test(n)) : [];
  const files = ['lore-migrate.mjs', 'lore-migrate', 'lore-migrate.exe', ...msis].filter(n => fs.existsSync(path.join(dir, n)))
    .map(n => ({ name: n, bytes: fs.readFileSync(path.join(dir, n)) }));
  for (const n of [FORGEJO_MCP_ARCHIVE, FORGEJO_MCP_ARCHIVE + '.sha256', MINILORE_ARCHIVE, MINILORE_ARCHIVE + '.sha256']) {
    if (fs.existsSync(path.join(dir, n))) files.push({ name: path.basename(n), bytes: fs.readFileSync(path.join(dir, n)) });
  }
  const srcDir = path.join(dir, 'src');
  if (fs.existsSync(srcDir)) for (const n of fs.readdirSync(srcDir).filter(n => /^lore-.+\.tar\.gz(\.sha256)?$/.test(n) || FMCP_SRC.includes(n)).sort()) files.push({ name: n, bytes: fs.readFileSync(path.join(srcDir, n)) });
  if (!files.length) throw new Error('в ' + dir + ' нет файлов установщика — сначала build-installer.mjs или готовый MSI');
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
