// Compose пакета установки: формы, на которых docker отказывается поднимать стек.
// Обе находки — живого прогона пакета на чужой машине 22.11.2026, обе ловились только docker'ом,
// а самопроверка install.sh его не зовёт и compose не разбирает.
//
// 1. Переменные службы — список СТРОК. Было:
//      - MINILORE_ARCADE_PASSWORD=${ARCADEDB_ROOT_PASSWORD:?пароль ArcadeDB нужен miniLORE: он заводит свои базы}
//    YAML увидел в тексте отказа «: » и разобрал элемент как пару ключ-значение:
//      services.minilore-srv.environment.[6]: unexpected type map[string]interface {}
//
// 2. «Ждать здоровья» — только у службы, где healthcheck объявлен. Было `condition: service_healthy` на arcadedb,
//    у которой в этом пакете healthcheck нет:
//      dependency failed to start: container lore-arcadedb-1 has no healthcheck configured
//
// Обе падали ПОСЛЕ сборки образов — через двадцать минут, на чужой машине. Поэтому сторож, а не правка строки:
// такую строку напишет каждый, кто добавит службу.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = new URL('../../deploy/install/docker-compose.install.yml', import.meta.url);
const SERVICE = /^ {2}([a-z0-9][a-z0-9_-]*):\s*$/;

/** Элементы environment каждой службы: [{ service, index, raw, looksLikeMap }]. Разбор строковый — без зависимостей. */
export function envItems(yaml) {
  const lines = String(yaml).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let service = null, inEnv = false, idx = 0;
  for (const line of lines) {
    const svc = SERVICE.exec(line);
    if (svc) { service = svc[1]; inEnv = false; continue; }
    if (/^ {4}environment:\s*$/.test(line)) { inEnv = true; idx = 0; continue; }
    if (inEnv) {
      if (/^ {4}\S/.test(line) || /^\S/.test(line)) { inEnv = false; continue; }
      const item = /^ {6}- (.*)$/.exec(line);
      if (!item) continue;
      const raw = item[1];
      const quoted = /^".*"$/.test(raw) || /^'.*'$/.test(raw);
      out.push({ service, index: idx++, raw, looksLikeMap: !quoted && /:\s/.test(raw) });
    }
  }
  return out;
}

/** Службы с объявленным healthcheck и пары «кто ждёт здоровья кого». */
export function healthDeps(yaml) {
  const lines = String(yaml).replace(/\r\n/g, '\n').split('\n');
  const withHealth = new Set();
  const waits = [];
  let service = null, dep = null;
  for (const line of lines) {
    const svc = SERVICE.exec(line);
    if (svc) { service = svc[1]; dep = null; continue; }
    if (/^ {4}healthcheck:\s*$/.test(line)) { withHealth.add(service); continue; }
    if (/^ {4}depends_on:\s*$/.test(line)) { dep = 'start'; continue; }
    if (dep && /^ {4}\S/.test(line)) { dep = null; continue; }
    const named = dep ? /^ {6}([a-z0-9][a-z0-9_-]*):\s*$/.exec(line) : null;
    if (named) { dep = named[1]; continue; }
    if (dep && dep !== 'start' && /condition:\s*service_healthy/.test(line)) waits.push({ service, on: dep });
  }
  return { withHealth, waits };
}

test('environment каждой службы — список строк: «: » в незакавыченном элементе делает из него пару', () => {
  const items = envItems(fs.readFileSync(FILE, 'utf8'));
  assert.ok(items.length > 10, 'разбор не нашёл переменных — сторож бесполезен, если ничего не читает');
  const bad = items.filter(i => i.looksLikeMap).map(i => `${i.service}.environment[${i.index}]: ${i.raw}`);
  assert.deepEqual(bad, [],
    'в элементе списка есть «: » без кавычек — docker compose разберёт его как пару и откажется поднимать стек');
});

test('разбор переменных ловит именно ту форму, на которой упала установка (положительный контроль)', () => {
  const broken = [
    'services:',
    '  minilore-srv:',
    '    environment:',
    '      - A=1',
    '      - B=${X:?текст с двоеточием: и продолжением}',
    '      - "C=${Y:?текст с двоеточием: но в кавычках}"',
  ].join('\n');
  const items = envItems(broken);
  assert.equal(items.length, 3);
  assert.deepEqual(items.filter(i => i.looksLikeMap).map(i => i.index), [1], 'ловится только незакавыченный');
});

test('ждать здоровья можно только у службы, у которой healthcheck объявлен', () => {
  const { withHealth, waits } = healthDeps(fs.readFileSync(FILE, 'utf8'));
  assert.ok(waits.length > 0, 'разбор не нашёл ни одного ожидания — сторож бесполезен');
  const bad = waits.filter(w => !withHealth.has(w.on)).map(w => `${w.service} ждёт здоровья ${w.on}, а healthcheck у ${w.on} нет`);
  assert.deepEqual(bad, [], 'compose откажется поднимать ВЕСЬ стек: «has no healthcheck configured»');
});

test('разбор ожиданий ловит именно ту форму, на которой упал запуск (положительный контроль)', () => {
  const broken = [
    'services:',
    '  arcadedb:',
    '    image: x',
    '  minilore-srv:',
    '    depends_on:',
    '      arcadedb:',
    '        condition: service_healthy',
  ].join('\n');
  const r = healthDeps(broken);
  assert.deepEqual(r.waits, [{ service: 'minilore-srv', on: 'arcadedb' }]);
  assert.equal(r.withHealth.has('arcadedb'), false, 'здоровья у arcadedb в этом примере нет — значит ожидание незаконно');
});
