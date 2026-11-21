// Пакет 1.18 — имена людей из KC: клиент сверки и честные слова итога (владелица 21.11.2026:
// «у людей из KC то ФИО достань, а то только логины»).
import { describe, expect, it, vi } from 'vitest';
import { kcNamesLine, syncKcNames } from './kcNames';
import { userRecord } from '../lists/records';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('сверка имён с KC', () => {
  it('кнопка — POST без окна; открытие раздела — с окном в сутки', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok({ ok: true, skipped: false, updated: 3, no_name_in_kc: 2, manual_kept: 1, not_in_kc: 0, unchanged: 4 }));
    await syncKcNames(f as unknown as typeof fetch);
    await syncKcNames(f as unknown as typeof fetch, { ifOlderThanHours: 24 });
    expect(f.mock.calls[0][0]).toBe('/lore/kc/user-names/sync');
    expect((f.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(f.mock.calls[1][0]).toBe('/lore/kc/user-names/sync?if_older_than_hours=24');
  });

  it('итог словами: обновлено N, без имени в KC M, своё имя оставлено K', async () => {
    const r = await syncKcNames((async () => ok({ ok: true, skipped: false, updated: 3, no_name_in_kc: 2, manual_kept: 1, not_in_kc: 1, unchanged: 4 })) as unknown as typeof fetch);
    expect(r.state).toBe('done');
    const line = kcNamesLine(r, 'ru');
    expect(line).toContain('3');
    expect(line).toContain('2');
    expect(line).toContain('1');
  });

  it('KC недоступен — отказ словами, а не тихие логины', async () => {
    const r = await syncKcNames((async () => ok({ error: 'KC_UPSTREAM', detail: 'kc users first=0 503' }, 502)) as unknown as typeof fetch);
    expect(r.state).toBe('error');
    expect(kcNamesLine(r, 'ru')).toMatch(/KC/);
    expect(kcNamesLine(r, 'ru')).toContain('503');
  });

  it('KC не настроен (503) — тоже словами', async () => {
    const r = await syncKcNames((async () => ok({ error: 'KC_NOT_CONFIGURED', detail: 'kc integration not configured' }, 503)) as unknown as typeof fetch);
    expect(r.state).toBe('error');
    expect(kcNamesLine(r, 'ru')).toContain('not configured');
  });

  it('свежая сверка не повторяется — так и сказано', async () => {
    const r = await syncKcNames((async () => ok({ ok: true, skipped: true, synced_at: '2026-11-21T09:00:00Z', last: { updated: 0, no_name_in_kc: 2, manual_kept: 1 } })) as unknown as typeof fetch, { ifOlderThanHours: 24 });
    expect(r.state).toBe('skipped');
  });
});

describe('список «Люди»: имя, логин — рядом', () => {
  it('логин — поле записи и строка поиска', () => {
    const rec = userRecord({ kc_sub: 's1', display_name: 'Иван Иванов', login: 'ivan', projects: ['p'] });
    expect(rec.title).toBe('Иван Иванов');
    expect(rec.fields.login).toBe('ivan');
    expect(rec.search).toContain('ivan');
  });
});
