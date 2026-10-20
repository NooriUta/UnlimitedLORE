import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { collect, unwrap, values } from './writeToolHarness.js';

// Сторож «необязательный флаг, который не передали, уходит выдуманным значением».
//
// 20.10.2026 (SPRINT_LORE_SLICE_ERGONOMICS/SE-18): release_new объявлял
// is_current необязательным, но `.default(false)` и `?? false` слали бэкенду
// явное «нет». Бэкенд на отсутствие поля сам решает, текущий ли релиз
// (ADR-LORE-025, OP-04), — а явное значение уважает. Авто-переключение для
// релизов, заведённых через MCP, не срабатывало ни разу, и у четырёх проектов
// «текущим» висел старый релиз.
//
// Правило: не переданный необязательный флаг в теле — отсутствует или null.
// Умолчание выбирает бэкенд, а не обёртка.

const sent: { path: string; body: unknown }[] = [];

vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async (path: string, params?: unknown) => { sent.push({ path, body: params }); return { ok: true, rows: [] }; }),
  loreUpload: vi.fn(async (...a: unknown[]) => { sent.push({ path: String(a[0]), body: a.slice(1) }); return { ok: true }; }),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

const isOptional = (t: z.ZodTypeAny) => t.isOptional();
const isBool = (t: z.ZodTypeAny) => unwrap(t) instanceof z.ZodBoolean;

describe('не переданный необязательный флаг не доходит до бэкенда значением', () => {
  beforeEach(() => { sent.length = 0; });

  it('ни один инструмент записи не подставляет свой true/false', async () => {
    const tools = collect(registerLoreWrite);
    const invented: string[] = [];
    let checked = 0;

    for (const tool of tools) {
      const flags = Object.keys(tool.schema).filter(k => isOptional(tool.schema[k]) && isBool(tool.schema[k]));
      if (flags.length === 0) continue;
      const required = Object.fromEntries(Object.keys(tool.schema)
        .filter(k => !isOptional(tool.schema[k]))
        .map(k => [k, values(k, tool.schema[k])[0]]));
      // Как в настоящем MCP: аргументы проходят разбор схемы — `.default()` срабатывает здесь.
      const parsed = z.object(tool.schema).safeParse(required);
      if (!parsed.success) continue;
      sent.length = 0;
      try { await tool.handler(parsed.data); } catch { continue; }
      checked++;
      for (const { body } of sent) {
        if (body === null || typeof body !== 'object') continue;
        for (const k of flags) {
          const v = (body as Record<string, unknown>)[k];
          if (typeof v === 'boolean') invented.push(`${tool.name}.${k}=${v}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(0);   // положительный контроль: флаги нашлись и инструменты вызвались
    expect(invented).toEqual([]);
  });
});
