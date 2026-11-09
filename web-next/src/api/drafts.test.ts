// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-09 — клиент черновиков и переходник к MD-полю.
//
// Контракт сервера (PR #940, передан серверной сессией): GET /lore/me/drafts,
// POST /lore/me/drafts (UPSERT, один на поле), POST /lore/me/drafts/delete
// (без field — все черновики записи).
//
// Что закрепляется:
//   • пустой список значит «черновиков нет» — и только это;
//   • 401 NO_IDENTITY не превращается в «черновиков нет»: ошибка доходит до
//     поля, и оно пишет «черновик не прочитан» вместо тишины;
//   • base_version разошёлся с версией записи — черновик помечен stale:
//     слияние по блокам это S5-08, молча накладывать старый текст нельзя;
//   • версия неизвестна (адаптер пока отдаёт null) — расхождение НЕ
//     выдумывается: нет данных, нет пометки.
import { describe, expect, it, vi } from 'vitest';
import { createDraftsApi, draftSlot } from './drafts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (over: Record<string, unknown> = {}) => ({
  ref_type: 'adr', ref_id: 'ADR-1', field: 'decision_md',
  body_md: 'Недописанное', base_version: '2026-11-08T10:00:00Z', saved_at: '2026-11-09T07:05:00Z', ...over,
});

const call = (f: ReturnType<typeof vi.fn>, i = 0) => ({
  url: String(f.mock.calls[i][0]),
  init: (f.mock.calls[i][1] ?? {}) as RequestInit,
  body: f.mock.calls[i][1]?.body ? JSON.parse(String(f.mock.calls[i][1].body)) : undefined,
});

describe('клиент черновиков', () => {
  it('положительный контроль: список читается по типу и коду записи', async () => {
    const f = vi.fn(async () => json({ drafts: [row()] }));
    const rows = await createDraftsApi(f as unknown as typeof fetch).list({ type: 'adr', id: 'ADR-1' });
    expect(call(f).url).toBe('/lore/me/drafts?ref_type=adr&ref_id=ADR-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].body_md).toBe('Недописанное');
  });

  it('пустой список — «черновиков нет», без выдумок', async () => {
    const f = vi.fn(async () => json({ drafts: [] }));
    expect(await createDraftsApi(f as unknown as typeof fetch).list({ type: 'adr', id: 'ADR-1' })).toEqual([]);
  });

  it('сохранение — POST с полем и базовой версией', async () => {
    const f = vi.fn(async () => json({ ok: true, saved_at: '2026-11-09T07:06:00Z' }));
    await createDraftsApi(f as unknown as typeof fetch)
      .save({ type: 'adr', id: 'ADR-1', field: 'decision_md', bodyMd: 'Текст', baseVersion: '2026-11-08T10:00:00Z' });
    const { url, init, body } = call(f);
    expect(url).toBe('/lore/me/drafts');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ ref_type: 'adr', ref_id: 'ADR-1', field: 'decision_md', body_md: 'Текст', base_version: '2026-11-08T10:00:00Z' });
  });

  it('версии нет — ключ base_version не посылается, а не уходит нулём', async () => {
    const f = vi.fn(async () => json({ ok: true }));
    await createDraftsApi(f as unknown as typeof fetch)
      .save({ type: 'adr', id: 'ADR-1', field: 'decision_md', bodyMd: 'Текст', baseVersion: null });
    expect(call(f).body).not.toHaveProperty('base_version');
  });

  it('снятие — POST на /delete; без поля удаляются все черновики записи', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'DELETED' }));
    const api = createDraftsApi(f as unknown as typeof fetch);
    await api.remove({ type: 'adr', id: 'ADR-1', field: 'decision_md' });
    expect(call(f).url).toBe('/lore/me/drafts/delete');
    expect(call(f).body).toEqual({ ref_type: 'adr', ref_id: 'ADR-1', field: 'decision_md' });
    await api.remove({ type: 'adr', id: 'ADR-1' });
    expect(call(f, 1).body).toEqual({ ref_type: 'adr', ref_id: 'ADR-1' });
  });

  it('«не опознан» не становится «черновиков нет»', async () => {
    const f = vi.fn(async () => json({ error: 'NO_IDENTITY', detail: 'нужен токен' }, 401));
    await expect(createDraftsApi(f as unknown as typeof fetch).list({ type: 'adr', id: 'ADR-1' }))
      .rejects.toThrow(/NO_IDENTITY/);
  });
});

describe('переходник к MD-полю', () => {
  const slot = (rows: unknown[], version: string | null) => {
    const f = vi.fn(async () => json({ drafts: rows }));
    const api = createDraftsApi(f as unknown as typeof fetch);
    return { f, slot: draftSlot({ api, type: 'adr', id: 'ADR-1', field: 'decision_md', version }) };
  };

  it('черновик своего поля находится; чужие поля не подставляются', async () => {
    const { slot: s } = slot([row({ field: 'context_md', body_md: 'Чужое' }), row()], '2026-11-08T10:00:00Z');
    expect((await s.load())?.text).toBe('Недописанное');
  });

  it('черновика поля нет — null, а не пустая строка', async () => {
    const { slot: s } = slot([row({ field: 'context_md' })], '2026-11-08T10:00:00Z');
    expect(await s.load()).toBeNull();
  });

  it('базовая версия совпала — пометки расхождения нет', async () => {
    const { slot: s } = slot([row({ base_version: '2026-11-08T10:00:00Z' })], '2026-11-08T10:00:00Z');
    expect((await s.load())?.stale).toBe(false);
  });

  it('базовая версия разошлась — stale: запись правили после черновика', async () => {
    const { slot: s } = slot([row({ base_version: '2026-11-07T10:00:00Z' })], '2026-11-09T10:00:00Z');
    expect((await s.load())?.stale).toBe(true);
  });

  it('версия записи неизвестна — расхождение не выдумывается', async () => {
    const { slot: s } = slot([row({ base_version: '2026-11-07T10:00:00Z' })], null);
    expect((await s.load())?.stale).toBe(false);
  });

  it('время сохранения доходит как есть — подпись «от ЧЧ:ММ» делает kit', async () => {
    const { slot: s } = slot([row()], '2026-11-08T10:00:00Z');
    expect((await s.load())?.savedAt).toBe('2026-11-09T07:05:00Z');
  });
});
