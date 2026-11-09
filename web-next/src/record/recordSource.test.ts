// Откуда берётся паспорт: боевой фасад или эмуляция
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST).
//
// До сих пор паспорт собирался из срезов на клиенте (`toLoreRecord`), и в нём
// по определению не было того, чего в срезах нет: версии записи, настоящих
// прав, состояния блоков. Теперь источник — `GET /lore/record`.
//
// Главное правило этого файла: **откат на эмуляцию никогда не молчит.**
// Молчаливый откат — худшее из возможных: паспорт выглядит настоящим, а
// версии в нём нет, права зашиты, и человек правит запись, думая, что защита
// от затирания работает. Поэтому откат пишет строку в состояние данных, и её
// видно в блоке «Состояние данных».
//
// И наоборот: «записи нет» и «нет прав» — это ОТВЕТЫ о записи, а не сбой
// источника. Откатываться на эмуляцию по ним нельзя: эмуляция из срезов может
// показать то, что фасад закрыл скоупом.
import { describe, expect, it } from 'vitest';
import type { SliceBody } from '../api/loreSlice';
import { loadRecordContract } from './recordSource';

const NOW = '2026-11-09T04:00:00.000Z';

const SPRINT = { sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: 'IN_PROGRESS', valid_from: NOW, context_md: 'контекст' };

type Rows = Record<string, Record<string, unknown>[] | Error>;
const slices = (rows: Rows) => async <T,>(name: string): Promise<SliceBody<T>> => {
  const r = rows[name];
  if (r instanceof Error) throw r;
  return { rows: (r ?? []) as T[] };
};

const facadeBody = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active', version: '2026-11-08T10:00:00Z' },
  values: { title: 'Спринт А', context_md: 'контекст' },
  parts: [], links: [],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: { type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'i', fields: [], layout: {}, relations: [] },
  meta: { facade: 'server', sources: { block: [] }, data_state: [] },
};

const http = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const load = (opts: { fetchImpl: typeof fetch; rows?: Rows }) =>
  loadRecordContract('sprint', 'SPRINT_A', 'ru', slices(opts.rows ?? { sprints: [SPRINT] }), {
    fetchImpl: opts.fetchImpl, now: () => NOW,
  });

describe('S4-MODEL-PASSPORT-LIST · источник паспорта', () => {
  it('положительный контроль: фасад ответил — паспорт его, с версией', async () => {
    const c = await load({ fetchImpl: http(facadeBody) });
    expect(c.meta.facade).toBe('server');
    expect(c.record.version).toBe('2026-11-08T10:00:00Z');
  });

  it('фасад выключен (501) — откат на эмуляцию, но он НАЗВАН в состоянии данных', async () => {
    const c = await load({ fetchImpl: http({ error: 'DISABLED', detail: 'фасад выключен' }, 501) });
    expect(c.meta.facade).toBe('client-emulated');
    const row = c.meta.sources.find(s => s.block === 'lore.record');
    expect(row?.state).toBe('error');
    expect(row?.reason).toContain('фасад выключен');
    // Версии в эмуляции нет, и выдумывать её нельзя.
    expect(c.record.version).toBeNull();
  });

  it('сервер сломался (502) — тоже откат с названной причиной, а не пустой паспорт', async () => {
    const c = await load({ fetchImpl: http({ error: 'UPSTREAM', detail: 'база молчит' }, 502) });
    expect(c.meta.facade).toBe('client-emulated');
    expect(c.meta.sources.find(s => s.block === 'lore.record')?.reason).toContain('база молчит');
  });

  it('«записи нет» (404) НЕ откатывается на срезы: это ответ о записи, а не сбой источника', async () => {
    await expect(load({ fetchImpl: http({ error: 'NOT_FOUND', detail: 'не найден' }, 404) }))
      .rejects.toThrow(/не найден/);
  });

  it('«нет прав» (403) НЕ откатывается: эмуляция показала бы закрытое скоупом', async () => {
    await expect(load({ fetchImpl: http({ error: 'SCOPE_EMPTY', detail: 'скоуп пуст' }, 403) }))
      .rejects.toThrow(/скоуп пуст/);
  });

  it('фасад упал И срезы упали — наружу идёт ошибка, а не полупустой паспорт', async () => {
    await expect(load({ fetchImpl: http({ error: 'UPSTREAM', detail: 'база молчит' }, 502), rows: { sprints: new Error('срез тоже лёг') } }))
      .rejects.toThrow();
  });

  it('состояния блоков эмуляции сохраняются рядом со строкой про фасад', async () => {
    const c = await load({
      fetchImpl: http({ error: 'DISABLED', detail: 'фасад выключен' }, 501),
      rows: { sprints: [SPRINT], tasks_of_sprint: new Error('срез задач лёг') },
    });
    expect(c.meta.sources.find(s => s.block === 'lore.record')).toBeTruthy();
    expect(c.meta.sources.length).toBeGreaterThan(1);
  });
});
