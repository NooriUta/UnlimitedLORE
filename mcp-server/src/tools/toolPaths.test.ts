import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collect, variantsOf } from './writeToolHarness.js';

// Реестр «инструмент записи → пути бэкенда», который читает сторож прав
// AgentProfilesMatchMatrixTest (backend). Пути не угадываются по имени
// инструмента — они СНЯТЫ с вызова: инструмент зовётся во всех ветках, а
// подменённый lorePost записывает, куда ушёл запрос. Угадывание по префиксу
// ошибалось на insight_*/metric_* (пишут в /lore/bragi) и rec_* (в /lore/qg).
//
// Файл лежит в репозитории, чтобы бэкенд читал его без сборки MCP. Этот тест
// следит, чтобы он не протух: расхождение — красный. Обновить:
//   UPDATE_TOOL_PATHS=1 npx vitest run src/tools/toolPaths.test.ts
// Только записи (POST/загрузка): GET агентный фильтр не проверяет.

const posted: string[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string) => { posted.push(path); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async (path: string) => { posted.push(String(path)); return { ok: true }; }),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

const FILE = fileURLToPath(new URL('../../agent-profiles/tool-paths.json', import.meta.url));

async function snapshot(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const tool of collect(registerLoreWrite)) {
    const paths = new Set<string>();
    for (const args of variantsOf(tool)) {
      posted.length = 0;
      try { await tool.handler(args); } catch { /* отказ валидации в ветке — путей нет */ }
      for (const p of posted) paths.add(p.split('?')[0]);
    }
    out[tool.name] = [...paths].sort();
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

describe('реестр путей инструментов записи', () => {
  it('совпадает с agent-profiles/tool-paths.json', async () => {
    const now = await snapshot();
    // Положительный контроль: заведомо известные пути на месте.
    expect(now.status_set).toEqual(['/lore/status']);
    expect(now.project_new).toEqual(['/lore/project']);
    const text = JSON.stringify(now, null, 2) + '\n';
    if (process.env.UPDATE_TOOL_PATHS === '1') writeFileSync(FILE, text, 'utf8');
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toEqual(text);
  });

  it('у каждого инструмента записи есть хоть один путь записи', async () => {
    const empty = Object.entries(await snapshot()).filter(([, p]) => p.length === 0).map(([n]) => n);
    // Инструмент без единого POST — либо читает, либо ни одна ветка не дошла до
    // запроса и реестр о нём ничего не знает. Читающие, которые живут в loreWrite
    // по соседству со своими пишущими собратьями, перечислены явно.
    const READS_IN_WRITE = ['bragi_search', 'metric_get'];
    expect(empty.filter(n => !READS_IN_WRITE.includes(n))).toEqual([]);
    expect(READS_IN_WRITE.filter(n => !empty.includes(n))).toEqual([]);
  });
});
