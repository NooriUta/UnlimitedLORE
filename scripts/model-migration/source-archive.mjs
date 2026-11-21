#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Архив исходников LORE для пакета установщика — «так же там же архивом наш проект
// для собственной сборки если что» (владелица 20.11.2026). Тем же путём, что архив образа forgejo-mcp (#1657):
// файл в каталоге версии kkRepo, рядом .sha256; никаких push и реестров.
// Выход: <out>/src/lore-<версия>.tar.gz и .tar.gz.sha256 (формат sha256sum -c). install.sh --build-from-source сверяет
// sha256 и собирает образы из распакованного архива.
// Секретов в архиве нет: .gitattributes export-ignore снимает .env*, *.secret, *.key, *.pem; перед сжатием каждый путь
// архива сверяется ещё раз (forbiddenEntries) — нашёлся запретный файл, архив не пишется.
//
// Запуск: node source-archive.mjs --out build --version 1.18.0 [--rev <коммит|тег>]   (версия пусто — по GITHUB_SHA)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { versionOf } from './publish-plan.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
// Запретные имена (по последнему сегменту пути): окружение и ключи.
const FORBIDDEN = [/^\.env(\..*)?$/, /\.secret$/, /\.key$/, /\.pem$/, /\.p12$/, /\.pfx$/, /\.jks$/];

export function archiveName(version) {
  if (!VERSION_RE.test(version || '')) throw new Error('версия архива не по образцу 1.2.3[-метка]: ' + version);
  return 'src/lore-' + version + '.tar.gz';
}

export function forbiddenEntries(names) {
  return names.filter(n => { const b = n.replace(/\/+$/, '').split('/').pop(); return FORBIDDEN.some(re => re.test(b)); });
}

/** git archive: правила export-ignore — из рабочего дерева (--worktree-attributes), чтобы старый тег не вёз секреты. */
export function archivePlan({ rev, out, version }) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._\/-]*$/.test(rev || '')) throw new Error('коммит или тег не задан или с лишними символами: ' + rev);
  const file = path.posix.join(out.replace(/\\/g, '/'), archiveName(version));
  return { git: ['archive', '--format=tar', '--worktree-attributes', rev], file, sha: file + '.sha256' };
}

/** Пути файлов в tar (ustar; длинные имена — pax «path=» и GNU «L»; глобальный заголовок pax — не файл). */
export function tarEntries(buf) {
  const out = [];
  let off = 0, longName = null;
  const str = (o, n) => { const s = buf.subarray(o, o + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString('utf8'); };
  while (off + 512 <= buf.length) {
    if (buf[off] === 0) break; // два пустых блока — конец архива
    const size = parseInt(str(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const data = off + 512;
    if (type === 'x' || type === 'L') {
      const body = buf.subarray(data, data + size).toString('utf8');
      if (type === 'L') longName = body.replace(/\0.*$/s, '');
      else { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body); if (m) longName = m[1]; }
    } else if (type !== 'g') {
      const prefix = str(off + 345, 155), name = str(off + 0, 100);
      out.push(longName || (prefix ? prefix + '/' + name : name));
      longName = null;
    }
    off = data + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
  const out = path.resolve(arg('--out') || 'build');
  const version = versionOf({ input: arg('--version'), sha: process.env.GITHUB_SHA });
  const rev = arg('--rev') || process.env.GITHUB_SHA || 'HEAD';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const plan = archivePlan({ rev, out, version });
  console.log('── git ' + plan.git.join(' '));
  const tar = execFileSync('git', ['-C', root, ...plan.git], { maxBuffer: 1 << 30 });
  const names = tarEntries(tar);
  const bad = forbiddenEntries(names);
  if (bad.length) throw new Error('в архиве исходников запретные файлы (секреты/окружение): ' + bad.join(', ') + ' — добавьте export-ignore в .gitattributes');
  if (!names.includes('backend/Dockerfile.local')) throw new Error('в архиве нет backend/Dockerfile.local — это не исходники LORE');
  const gz = zlib.gzipSync(tar, { level: 9 });
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  fs.writeFileSync(plan.file, gz);
  const line = crypto.createHash('sha256').update(gz).digest('hex') + '  ' + path.basename(plan.file) + '\n';
  fs.writeFileSync(plan.sha, line);
  console.log(`архив исходников: ${plan.file} · ${(gz.length / 1048576).toFixed(1)} МБ · файлов ${names.length} · sha256 ${line.slice(0, 16)}…`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ошибка: ' + e.message); process.exit(1); });
}
