import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collect, isEnum, MARK, NUM, variantsOf } from './writeToolHarness.js';

// Сторож «параметр принят схемой, но до бэкенда не дошёл».
//
// 20.10.2026: decision_new объявлял `project` в схеме («creates BELONGS_TO_PROJECT»),
// а функция body его не передавала. Бэкенд параметр поддерживает и рёбра
// создал бы — но не получал его. Ответ ok:true, ребра нет; так легли без
// проекта три решения за день, и заметно это стало только по quality_check.
//
// Проверка: каждый инструмент записи вызывается со ВСЕМИ параметрами схемы,
// заполненными узнаваемыми метками, lorePost подменён и пишет, что ушло.
// Каждая метка обязана встретиться в отправленном (путь или тело). Ветвящиеся
// инструменты (rel/action) зовутся по разу на каждое значение перечисления,
// и параметр считается дошедшим, если дошёл хоть в одной ветке.

const sent: { path: string; body: unknown }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async (path: string, params?: unknown) => { sent.push({ path, body: params }); return { ok: true, rows: [] }; }),
  loreUpload: vi.fn(async (...a: unknown[]) => { sent.push({ path: String(a[0]), body: a.slice(1) }); return { ok: true }; }),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

describe('каждый параметр схемы записи доходит до бэкенда', () => {
  beforeEach(() => { sent.length = 0; });

  it('ни один инструмент записи не теряет параметр', async () => {
    const tools = collect(registerLoreWrite);
    expect(tools.length).toBeGreaterThan(30);   // положительный контроль: инструменты собраны
    const lost: string[] = [];
    let checked = 0;

    for (const tool of tools) {
      const keys = Object.keys(tool.schema);
      if (keys.length === 0) continue;
      const reached = new Set<string>();
      for (const args of variantsOf(tool)) {
        sent.length = 0;
        try { await tool.handler(args); } catch { /* ветка с отказом валидации — не потеря */ }
        const wire = JSON.stringify(sent);
        for (const k of keys) {
          const v = args[k];
          if (v === undefined) continue;
          if (isEnum(tool.schema[k]) || typeof v === 'boolean') {
            // Перечисления и флаги нередко превращаются в путь или выбор ветки — дошедшими
            // считаем, если что-то ушло вообще; иначе ложные срабатывания на rel/action.
            if (sent.length > 0) reached.add(k);
          } else if (typeof v === 'number' || (Array.isArray(v) && typeof v[0] === 'number')) {
            if (wire.includes(String(NUM))) reached.add(k);
          } else if (wire.includes(MARK(k))) {
            reached.add(k);
          }
        }
      }
      checked++;
      for (const k of keys) if (!reached.has(k)) lost.push(`${tool.name}.${k}`);
    }

    expect(checked).toBeGreaterThan(30);
    expect(lost).toEqual([]);
  });
});
