import { describe, expect, it } from 'vitest';
import { driftVerdict } from './drift.js';

// SE-10: вердикт «MCP отстаёт от бэкенда» — чистая функция, без сети.
// Сравниваются ВРЕМЕНА сборки, не коммиты: по двум хэшам порядок не
// определить без истории, а её у MCP нет. Время сборки монотонно: бэкенд,
// собранный позже MCP, почти наверняка несёт схемы, которых у MCP нет.

describe('driftVerdict', () => {
  it('MCP собран позже бэкенда — ok', () => {
    expect(driftVerdict('2026-09-10T08:00:00Z', '2026-09-10T06:54:00Z').verdict).toBe('ok');
  });

  it('MCP собран раньше бэкенда — mcp_older, и причина называет обе даты', () => {
    const v = driftVerdict('2026-08-23T21:11:00Z', '2026-09-10T06:54:00Z');
    expect(v.verdict).toBe('mcp_older');
    expect(v.reason).toContain('2026-08-23');
    expect(v.reason).toContain('2026-09-10');
  });

  it('одна из сторон без отметки — unknown, не ok', () => {
    // Молчаливое «ok» при неизвестной сборке — та же пустышка, что зелёный
    // сторож, который ничего не сторожит.
    expect(driftVerdict('', '2026-09-10T06:54:00Z').verdict).toBe('unknown');
    expect(driftVerdict('2026-09-10T06:54:00Z', undefined).verdict).toBe('unknown');
  });

  it('нечитаемая дата — unknown с причиной', () => {
    const v = driftVerdict('вчера', '2026-09-10T06:54:00Z');
    expect(v.verdict).toBe('unknown');
    expect(v.reason).not.toBe('');
  });
});
