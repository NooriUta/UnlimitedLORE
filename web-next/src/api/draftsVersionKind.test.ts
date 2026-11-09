// Версия записи и версия черновика — РАЗНЫЕ ТИПЫ на двух серверных
// поверхностях (SPRINT_UXR_S5_RECORD_TASKS/S5-09, находка 09.11).
//
// Сверено по коду бэкенда:
//   • GET /lore/record  → record.version — СТРОКА: valid_from открытого
//     состояния (LoreRecordVersion.sql / normalize → String).
//   • /lore/me/drafts   → base_version — ЦЕЛОЕ: свойство
//     KnowUserDraft.base_version INTEGER, DraftRequest.base_version: Integer,
//     проверка «base_version must be >= 0» (LoreMeDrafts).
//
// А задача S5-09 говорит, что второе берётся из первого. Одновременно это
// выполнить нельзя: ISO-время не целое ≥ 0.
//
// Что делает клиент: НЕ выдумывает перевод. Из ISO-времени целое можно только
// придумать (хэш, миллисекунды, порядковый номер) — и тогда пометка «запись
// изменили после черновика» срабатывала бы по придуманному числу. Ложная
// пометка хуже отсутствующей: человек бросит правку, которой ничего не
// угрожало. Поэтому строковая версия не отправляется и не сравнивается, а
// расхождение передано серверной сессии.
import { describe, expect, it, vi } from 'vitest';
import { draftSlot, type DraftsApi } from './drafts';

const api = (rows: Awaited<ReturnType<DraftsApi['list']>>) => {
  const save = vi.fn(async () => {});
  const impl: DraftsApi = {
    list: async () => rows,
    save: save as unknown as DraftsApi['save'],
    remove: async () => {},
  };
  return { impl, save };
};

const row = (base: unknown) => ({
  ref_type: 'sprint', ref_id: 'SPRINT_A',
  field: 'context_md', body_md: 'черновик', saved_at: '2026-11-09T03:00:00Z',
  base_version: base as number | null,
});

describe('S5-09 · версия записи строкой: пометку не выдумываем', () => {
  it('положительный контроль: черновик доходит до поля', async () => {
    const { impl } = api([row(null)]);
    const slot = draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version: null });
    expect((await slot.load())?.text).toBe('черновик');
  });

  it('версия записи — строка: расхождение НЕ помечается, сравнивать нечем', async () => {
    const { impl } = api([row(7)]);
    const slot = draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version: '2026-11-08T10:00:00Z' });
    expect((await slot.load())?.stale).toBe(false);
  });

  it('строковая версия не уходит в base_version — сервер ждёт целое и ответил бы 400', async () => {
    const { impl, save } = api([]);
    const slot = draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version: '2026-11-08T10:00:00Z' });
    await slot.save('новый текст');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: null }));
  });

  it('целая версия работает как прежде: расхождение видно', async () => {
    const { impl } = api([row(7)]);
    const slot = draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version: 9 });
    expect((await slot.load())?.stale).toBe(true);
  });

  it('целая версия совпала — пометки нет', async () => {
    const { impl } = api([row(9)]);
    const slot = draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version: 9 });
    expect((await slot.load())?.stale).toBe(false);
  });
});
