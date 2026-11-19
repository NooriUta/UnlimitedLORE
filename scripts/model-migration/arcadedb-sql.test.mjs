// Сторож грамматики ArcadeDB по всему установщику: «DELETE EDGE» и «DELETE VERTEX» в ней нет (проверено 2026-07-21,
// память feedback_arcadedb_edge_delete). Репетиция 19.11.2026 упала на этапе связей: «no viable alternative at input
// 'DELETE EDGE'». Удаление ребра и вершины — «DELETE FROM #rid».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
test('в коде установщика нет DELETE EDGE / DELETE VERTEX', () => {
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.mjs') && !n.endsWith('.test.mjs'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).forEach((l, i) => { if (/DELETE\s+(EDGE|VERTEX)\b/.test(l)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});
