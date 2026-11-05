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

// 05.11.2026: lore_version читал build-info.json с ДИСКА при каждом вызове и
// показывал свежую сборку, когда работающий процесс исполнял старый код (сессия
// не перезапускалась). Völva получила «drift: ok» при отсутствующем _page и
// искала причину в бэкенде. Загруженная сборка и сборка на диске — разные факты.
import { processStale } from './drift.js';

describe('processStale: процесс MCP исполняет не ту сборку, что лежит на диске', () => {
  it('на диске новее загруженной — restart_needed с обеими отметками', () => {
    const d = processStale(
      { commit: '58aa2588f817', built_at: '2026-11-05T05:52:47Z' },
      { commit: 'c1422502bfc2', built_at: '2026-11-05T07:02:35Z' });
    expect(d?.verdict).toBe('restart_needed');
    expect(d?.reason).toContain('58aa2588f817');
    expect(d?.reason).toContain('c1422502bfc2');
  });

  it('совпадают — null (решает обычный вердикт)', () => {
    const b = { commit: 'c1422502bfc2', built_at: '2026-11-05T07:02:35Z' };
    expect(processStale(b, { ...b })).toBeNull();
  });

  it('файла на диске не прочитать — не повод кричать о рестарте', () => {
    expect(processStale({ commit: 'c1422502bfc2', built_at: 'x' }, { commit: 'unknown', built_at: '' })).toBeNull();
  });
});
