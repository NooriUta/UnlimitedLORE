// Переменные служб в compose пакета — список СТРОК, а не пар (находка прогона на чужой машине 22.11.2026).
//
// Что случилось. В службе miniLORE строка выглядела так:
//   - MINILORE_ARCADE_PASSWORD=${ARCADEDB_ROOT_PASSWORD:?пароль ArcadeDB нужен miniLORE: он заводит свои базы}
// YAML увидел в тексте отказа «: » и разобрал элемент списка как пару ключ-значение. docker compose отказался
// поднимать стек: «services.minilore-srv.environment.[6]: unexpected type map[string]interface {}».
// Установка падала ПОСЛЕ сборки образов — то есть через двадцать минут и на чужой машине.
//
// Почему сторож, а не правка одной строки. Самопроверка install.sh docker не зовёт и compose не разбирает,
// а текст отказа с двоеточием — естественная вещь: такую строку напишет каждый, кто добавит службу.
// Тест разбирает сам файл и требует: у каждой службы environment — список, и каждый элемент строка вида KEY=…
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = new URL('../../deploy/install/docker-compose.install.yml', import.meta.url);

/** Элементы environment каждой службы: [{ service, index, raw, looksLikeMap }]. Разбор строковый — без зависимостей. */
export function envItems(yaml) {
  const lines = String(yaml).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let service = null, inEnv = false, idx = 0;
  for (const line of lines) {
    const svc = /^ {2}([a-z0-9][a-z0-9_-]*):\s*$/.exec(line);
    if (svc) { service = svc[1]; inEnv = false; continue; }
    if (/^ {4}environment:\s*$/.test(line)) { inEnv = true; idx = 0; continue; }
    if (inEnv) {
      if (/^ {4}\S/.test(line) || /^\S/.test(line)) { inEnv = false; continue; }
      const item = /^ {6}- (.*)$/.exec(line);
      if (!item) continue;
      const raw = item[1];
      // Элемент-строка в кавычках — всегда строка, что бы внутри ни было.
      const quoted = /^".*"$/.test(raw) || /^'.*'$/.test(raw);
      // Без кавычек YAML считает парой всё, где есть «: » (двоеточие с пробелом) вне кавычек.
      out.push({ service, index: idx++, raw, looksLikeMap: !quoted && /:\s/.test(raw) });
    }
  }
  return out;
}

test('environment каждой службы — список строк: «: » в незакавыченном элементе делает из него пару', () => {
  const items = envItems(fs.readFileSync(FILE, 'utf8'));
  assert.ok(items.length > 10, 'разбор не нашёл переменных — сторож бесполезен, если ничего не читает');
  const bad = items.filter(i => i.looksLikeMap).map(i => `${i.service}.environment[${i.index}]: ${i.raw}`);
  assert.deepEqual(bad, [],
    'в элементе списка есть «: » без кавычек — docker compose разберёт его как пару и откажется поднимать стек');
});

test('разбор ловит именно ту форму, на которой упала установка (положительный контроль)', () => {
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
