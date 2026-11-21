#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Образ forgejo-mcp для пакета установщика — архивом docker save, без реестра.
// Слово владелицы 20.11.2026: «а только не публиковать включить в инсталятор потом решим куда».
// Выход: <out>/images/forgejo-mcp-<коммит8>.tar и .tar.sha256 (формат sha256sum -c), <out>/src/forgejo-mcp-<коммит8>.tar.gz
// с .sha256 (исходник того же коммита) и src/forgejo-mcp-<коммит8>.LICENSE. Клон из нашего git — шаг НАШЕЙ сборки пакета. install.sh грузит архив
// docker load только при совпадении sha256. Никаких push и login: образ живёт только в архиве.
//
// Запуск: node forgejo-mcp-image.mjs --out build [--src <клон AIDA/forgejo-mcp>] [--dry]
// Без --src репозиторий клонируется во временный каталог; он приватный, поэтому токен чтения берётся из
// FORGEJO_MCP_CLONE_TOKEN и идёт заголовком через окружение git (GIT_CONFIG_*), не в адресе и не в аргументах.
// Нет ни --src, ни токена — громкий BLOCKED, а не тихий пропуск.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FORGEJO_MCP_REPO = 'https://git.seidrstudio.pro/AIDA/forgejo-mcp.git';
export const FORGEJO_MCP_COMMIT = 'bbe9f59c2167655c3c87fb51b102db29a275d13a'; // develop AIDA/forgejo-mcp, 0.1.7
export const FORGEJO_MCP_IMAGE = 'lore-install-forgejo-mcp:' + FORGEJO_MCP_COMMIT.slice(0, 8);
export const FORGEJO_MCP_ARCHIVE = 'images/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.tar';
// Исходник forgejo-mcp того же коммита — в пакете установки (владелица 21.11.2026: «исходник кладём прямо в пакет
// установки»). install.sh по умолчанию собирает образ из него, сетевого умолчания у установки нет. Лицензия (MIT) — рядом.
export const FORGEJO_MCP_SRC_ARCHIVE = 'src/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.tar.gz';
export const FORGEJO_MCP_LICENSE = 'src/forgejo-mcp-' + FORGEJO_MCP_COMMIT.slice(0, 8) + '.LICENSE';

/** Шаги сборки архива. src — свой клон (без git clone); иначе клон в work. */
export function imagePlan({ out, work, src, proxy = {} }) {
  const dir = src || work;
  // Прокси раннера — build-args, как в CD самого forgejo-mcp (npm ci внутри сборки ходит в сеть).
  const pa = Object.entries(proxy).filter(([, v]) => v).flatMap(([k, v]) => ['--build-arg', k + '=' + v]);
  const p = [];
  if (!src) p.push({ id: 'clone', cmd: 'git', args: ['clone', '--no-checkout', FORGEJO_MCP_REPO, work] });
  p.push({ id: 'checkout', cmd: 'git', args: ['-C', dir, 'checkout', '--detach', FORGEJO_MCP_COMMIT] });
  p.push({ id: 'verify', cmd: 'git', args: ['-C', dir, 'rev-parse', 'HEAD'], expect: FORGEJO_MCP_COMMIT });
  p.push({ id: 'source', cmd: 'git', args: ['-C', dir, 'archive', '--format=tar.gz', '-o', out + '/' + FORGEJO_MCP_SRC_ARCHIVE, FORGEJO_MCP_COMMIT] });
  p.push({ id: 'license', cmd: 'copy', args: [dir + '/LICENSE', out + '/' + FORGEJO_MCP_LICENSE] });
  p.push({ id: 'build', cmd: 'docker', args: ['build', ...pa, '-t', FORGEJO_MCP_IMAGE, dir] });
  p.push({ id: 'save', cmd: 'docker', args: ['save', '-o', out + '/' + FORGEJO_MCP_ARCHIVE, FORGEJO_MCP_IMAGE] });
  p.push({ id: 'sha256', cmd: 'sha256', args: [out + '/' + FORGEJO_MCP_ARCHIVE] });
  p.push({ id: 'sha256', cmd: 'sha256', args: [out + '/' + FORGEJO_MCP_SRC_ARCHIVE] });
  return p;
}

export function sha256Line(bytes, name) {
  return crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name + '\n';
}

function sha256File(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
  const out = path.resolve(arg('--out') || 'build'), src = arg('--src') ? path.resolve(arg('--src')) : '';
  const dry = process.argv.includes('--dry');
  const token = process.env.FORGEJO_MCP_CLONE_TOKEN || '';
  if (!src && !token && !dry) {
    console.error('BLOCKED: образ forgejo-mcp не собран — репозиторий AIDA/forgejo-mcp приватный, а нет ни --src <клон>, ни FORGEJO_MCP_CLONE_TOKEN (токен чтения этого репозитория). Разблокировать: секрет LORE_FJ_MCP_CLONE_TOKEN в CI (в шаг приходит переменной FORGEJO_MCP_CLONE_TOKEN) или свой клон через --src.');
    process.exit(3);
  }
  const work = src ? '' : dry ? path.join(os.tmpdir(), 'forgejo-mcp-<временный>') : fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-mcp-'));
  const proxy = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].map(k => [k, process.env[k] || '']));
  const plan = imagePlan({ out, work, src, proxy });
  // Токен клона — только в окружении процесса git, заголовком; в аргументах, адресе и логе его нет.
  const gitEnv = token ? { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: 'Authorization: token ' + token } : process.env;
  if (!dry) for (const d of ['images', 'src']) fs.mkdirSync(path.join(out, d), { recursive: true });
  for (const s of plan) {
    console.log((dry ? 'план: ' : '── ') + [s.cmd, ...s.args].join(' '));
    if (dry) continue;
    if (s.id === 'sha256') {
      const file = s.args[0], name = path.basename(file);
      const line = sha256File(file) + '  ' + name + '\n';
      fs.writeFileSync(file + '.sha256', line);
      console.log(`архив: ${file} · ${Math.round(fs.statSync(file).size / 1048576)} МБ · sha256 ${line.slice(0, 16)}…`);
      continue;
    }
    if (s.id === 'license') {
      // Лицензия обязана ехать рядом с исходником: нет файла — пакет не собирается.
      if (!fs.existsSync(s.args[0])) throw new Error('в исходниках forgejo-mcp нет LICENSE (' + s.args[0] + ') — без лицензии в пакет не кладём');
      fs.copyFileSync(s.args[0], s.args[1]);
      continue;
    }
    const res = execFileSync(s.cmd, s.args, { env: s.cmd === 'git' ? gitEnv : process.env, encoding: 'utf8', stdio: s.expect ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (s.expect && String(res).trim() !== s.expect) throw new Error('коммит в клоне ' + String(res).trim() + ', ждали ' + s.expect);
  }
  if (work && !dry) fs.rmSync(work, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ошибка: ' + e.message); process.exit(1); });
}
