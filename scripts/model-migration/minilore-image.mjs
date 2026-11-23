#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-04 · Образ сервера miniLORE для пакета установки — архивом docker save.
//
// Зачем. Пакет едет чужим людям, и адреса НАШЕГО реестра в нём быть не должно: у них нет к нему доступа, а
// сторож noBakedHosts такие адреса в deploy/install/** запрещает (поймал меня 22.11.2026, когда я вписала
// git.seidrstudio.pro, чтобы образ качался на прогоне). Поэтому в пакете — локальное имя minilore-srv:<версия>,
// а сам образ кладётся архивом images/minilore-srv-<версия>.tar с подписью sha256. install.sh грузит архив
// docker load только при совпадении подписи. Это ровно та же схема, что у forgejo-mcp (forgejo-mcp-image.mjs),
// но без сборки из исходников: сервер miniLORE — чужой проект, у нас есть только его образ.
//
// Запуск: node minilore-image.mjs --out build [--image <откуда тянуть>] [--dry]
// Тянуть по умолчанию неоткуда намеренно: адрес реестра задаёт наш шаг сборки (MINILORE_SOURCE_IMAGE или --image),
// и живёт он в ЭТОМ файле трубы, а не в пакете. Нет адреса и нет образа на машине — громкий BLOCKED, не тихий пропуск.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MINILORE_VERSION = '0.4.19';
export const MINILORE_IMAGE = 'minilore-srv:' + MINILORE_VERSION;              // имя в пакете — без реестра
export const MINILORE_ARCHIVE = 'images/minilore-srv-' + MINILORE_VERSION + '.tar';

/** Шаги: притянуть образ из указанного реестра, переименовать в локальное имя, сохранить архивом, подписать. */
export function imagePlan({ out, source }) {
  const p = [];
  if (source) {
    p.push({ id: 'pull', cmd: 'docker', args: ['pull', source] });
    p.push({ id: 'tag', cmd: 'docker', args: ['tag', source, MINILORE_IMAGE] });
  }
  p.push({ id: 'save', cmd: 'docker', args: ['save', '-o', out + '/' + MINILORE_ARCHIVE, MINILORE_IMAGE] });
  p.push({ id: 'sha256', cmd: 'sha256', args: [out + '/' + MINILORE_ARCHIVE] });
  return p;
}

function sha256File(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** Есть ли образ на машине (в сухом прогоне не спрашиваем docker). */
function imageHere(name) {
  try { execFileSync('docker', ['image', 'inspect', name], { stdio: 'ignore' }); return true; } catch { return false; }
}

async function main() {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
  const out = path.resolve(arg('--out') || 'build');
  const dry = process.argv.includes('--dry');
  const source = arg('--image') || process.env.MINILORE_SOURCE_IMAGE || '';
  if (!source && !dry && !imageHere(MINILORE_IMAGE)) {
    console.error(`BLOCKED: образ сервера miniLORE не положен в пакет — нет ни --image <адрес образа>, ни MINILORE_SOURCE_IMAGE, и образа ${MINILORE_IMAGE} нет на машине сборки. Разблокировать: переменная MINILORE_SOURCE_IMAGE в шаге сборки пакета (адрес образа в нашем реестре) или свой образ под именем ${MINILORE_IMAGE}.`);
    process.exit(3);
  }
  if (!dry) fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  for (const s of imagePlan({ out, source })) {
    console.log((dry ? 'план: ' : '── ') + [s.cmd, ...s.args].join(' '));
    if (dry) continue;
    if (s.id === 'sha256') {
      const file = s.args[0], line = sha256File(file) + '  ' + path.basename(file) + '\n';
      fs.writeFileSync(file + '.sha256', line);
      console.log(`архив: ${file} · ${Math.round(fs.statSync(file).size / 1048576)} МБ · sha256 ${line.slice(0, 16)}…`);
      continue;
    }
    execFileSync(s.cmd, s.args, { stdio: 'inherit' });
  }
}

if (process.argv[1] && process.argv[1].endsWith('minilore-image.mjs')) main().catch(e => { console.error(e.message); process.exit(1); });
