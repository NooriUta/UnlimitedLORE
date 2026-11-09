// Версия записи у черновика — строка, та же, что `record.version`
// (SPRINT_UXR_S5_RECORD_TASKS/S5-09, разбор и правка 09.11).
//
// **Этот файл переписан в тот же день, и причина важнее самих проверок.**
//
// Утром две серверные поверхности расходились типом: `GET /lore/record` отдавал
// `record.version` строкой (`valid_from` открытого состояния), а
// `/lore/me/drafts` объявлял `base_version` целым (`INTEGER`, проверка «>= 0»),
// при том что S5-09 говорит «второе берётся из первого». Одновременно
// невыполнимо: ISO-время не целое ≥ 0.
//
// Тогда тут стояли проверки на то, что клиент НИЧЕГО не выдумывает: строковая
// версия не отправляется и не сравнивается, пометка «запись изменили после
// черновика» не ставится. Это было правильно ровно до тех пор, пока контракт
// не выбран: из времени целое получается только придумкой, и пометка
// срабатывала бы по придуманному числу.
//
// Серверная сессия выбрала строку (PR #964, в develop): `base_version` — это
// ровно `record.version`, сравнение на равенство, предел длины 64, старые
// числовые черновики отдаются строкой цифр. Проверки заменены на проверки
// выбранного контракта — не удалены «потому что покраснели».
import { describe, expect, it, vi } from 'vitest';
import { comparableVersion, draftSlot, type DraftRow, type DraftsApi } from './drafts';

const V_NOW = '2026-11-08T10:00:00Z';
const V_OLD = '2026-11-07T09:00:00Z';

const api = (rows: DraftRow[]) => {
  const save = vi.fn(async () => {});
  const impl: DraftsApi = { list: async () => rows, save, remove: async () => {} };
  return { impl, save };
};

const row = (base: string | null): DraftRow => ({
  ref_type: 'sprint', ref_id: 'SPRINT_A',
  field: 'context_md', body_md: 'черновик', saved_at: '2026-11-09T03:00:00Z',
  base_version: base,
});

const slotOf = (rows: DraftRow[], version: string | null) => {
  const { impl, save } = api(rows);
  return { slot: draftSlot({ api: impl, type: 'sprint', id: 'SPRINT_A', field: 'context_md', version }), save };
};

describe('S5-09 · версия черновика — строка record.version', () => {
  it('положительный контроль: черновик доходит до поля', async () => {
    const { slot } = slotOf([row(V_NOW)], V_NOW);
    expect((await slot.load())?.text).toBe('черновик');
  });

  it('версии совпали — пометки нет: запись с тех пор не меняли', async () => {
    const { slot } = slotOf([row(V_NOW)], V_NOW);
    expect((await slot.load())?.stale).toBe(false);
  });

  it('версии разошлись — пометка есть: запись изменили после черновика', async () => {
    const { slot } = slotOf([row(V_OLD)], V_NOW);
    expect((await slot.load())?.stale).toBe(true);
  });

  it('версия записи неизвестна — расхождение НЕ выдумывается', async () => {
    const { slot } = slotOf([row(V_OLD)], null);
    expect((await slot.load())?.stale).toBe(false);
  });

  it('у черновика версии нет — тоже без пометки: сравнивать не с чем', async () => {
    const { slot } = slotOf([row(null)], V_NOW);
    expect((await slot.load())?.stale).toBe(false);
  });

  it('версия уходит на сервер строкой, как он её и отдал', async () => {
    const { slot, save } = slotOf([], V_NOW);
    await slot.save('новый текст');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: V_NOW }));
  });

  it('старый числовой черновик («7») помечается изменённым — поверх чего его писали, мы не знаем', async () => {
    // До #964 в базе лежали числа, сервер отдаёт их строкой цифр. Равенства с
    // меткой версии такая строка не даст — и утверждать «писали поверх
    // текущей версии» нельзя, поэтому пометка честная, а не ложная.
    const { slot } = slotOf([row('7')], V_NOW);
    expect((await slot.load())?.stale).toBe(true);
  });

  it('comparableVersion: пустая строка — это «неизвестно», а не версия', () => {
    expect(comparableVersion('')).toBeNull();
    expect(comparableVersion(null)).toBeNull();
    expect(comparableVersion(V_NOW)).toBe(V_NOW);
  });
});
