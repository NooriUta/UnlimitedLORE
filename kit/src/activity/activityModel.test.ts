// SPRINT_UXR_S7A_NEWS/S7A-06 · вкладка «Активность» паспорта: модель.
// Запрос к GET /lore/news/v2 строится по оси записи (S7A-02), числа берутся из
// ответа сервера как есть (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0: клиент рисует,
// не считает), состояние — из meta.state (S7A-07), а не из длины массива.
import { describe, expect, it, vi } from 'vitest';
import { classifyError } from '../states/loadState';
import {
  activityParams, activityState, activityBurn, httpActivitySource, fixtureActivitySource,
  NewsV2HttpError, ACTIVITY_LIVE_API, defaultActivitySource, NEWS_V2_FIXTURE,
  type NewsV2Response,
} from './index';
import { ACTIVITY_EN, ACTIVITY_RU, activityT } from './locale';

const base = (over: Partial<NewsV2Response> = {}): NewsV2Response => ({
  events: [],
  meta: { state: 'empty', errors: [], validation: { ok: true }, truncated: false },
  ...over,
});

describe('S7A-06 · запрос по своей записи (оси S7A-02)', () => {
  it('проект, веха, спринт — свой фильтр по оси, разрез по дням', () => {
    for (const [kind, axis] of [['project', 'project'], ['milestone', 'milestone'], ['sprint', 'sprint']] as const) {
      const p = activityParams({ kind, id: 'X-1' });
      expect(p.ok, kind).toBe(true);
      if (!p.ok) continue;
      const q = new URLSearchParams(p.query);
      expect(q.get(axis)).toBe('X-1');
      expect(q.get('group_by')).toBe('day');
    }
  });

  it('период, пояс и потолок передаются серверу, а не режутся на клиенте', () => {
    const p = activityParams({ kind: 'sprint', id: 'S' }, { days: 14, tz: 'Europe/Berlin', limit: 200 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const q = new URLSearchParams(p.query);
    expect(q.get('days')).toBe('14');
    expect(q.get('tz')).toBe('Europe/Berlin');
    expect(q.get('limit')).toBe('200');
  });

  it('релиз — через свои спринты (у сервера нет оси release)', () => {
    const p = activityParams({ kind: 'release', id: 'v1.16.0', sprints: ['S_A', 'S_B'] });
    expect(p.ok).toBe(true);
    if (p.ok) expect(new URLSearchParams(p.query).get('sprint')).toBe('S_A,S_B');
  });

  it('релиз без спринтов — честный отказ, а не «пусто» и не лента всего LORE', () => {
    expect(activityParams({ kind: 'release', id: 'v1' })).toEqual({ ok: false, reason: 'release-no-sprints' });
    expect(activityParams({ kind: 'release', id: 'v1', sprints: [] })).toEqual({ ok: false, reason: 'release-no-sprints' });
  });

  it('пустой id — отказ (запрос без фильтра отдал бы чужую ленту)', () => {
    expect(activityParams({ kind: 'project', id: '  ' })).toEqual({ ok: false, reason: 'no-id' });
  });
});

describe('S7A-06 · честное состояние из meta (S7A-07)', () => {
  it('empty от сервера и ноль строк — проверенный ноль', () => {
    expect(activityState(base()).state).toBe('empty');
  });

  it('partial: источник недоступен — это не «пусто», ошибки видны', () => {
    const s = activityState(base({ meta: { state: 'partial', errors: [{ source: 'tasks', error: 'timeout', critical: true }] } }));
    expect(s.state).toBe('partial');
    expect(s.errors).toEqual([{ source: 'tasks', error: 'timeout', critical: true }]);
  });

  it('ошибки источников при state=ok всё равно делают ответ partial', () => {
    const s = activityState(base({ events: [row()], meta: { state: 'ok', errors: [{ source: 'specs', error: 'x', critical: false }] } }));
    expect(s.state).toBe('partial');
  });

  it('нет meta.state — полноту проверить нечем (unverified), а не ok', () => {
    expect(activityState({ events: [row()], meta: {} }).state).toBe('unverified');
  });

  it('ok при нуле строк — противоречие ответа, unverified', () => {
    expect(activityState(base({ meta: { state: 'ok' } })).state).toBe('unverified');
  });

  it('проваленная валидация и обрезка выдачи поднимаются флагами', () => {
    const s = activityState(base({ events: [row()], meta: { state: 'ok', truncated: true, validation: { ok: false } } }));
    expect(s.state).toBe('ok');
    expect(s.truncated).toBe(true);
    expect(s.validationFailed).toBe(true);
  });
});

describe('S7A-06 · сгорание своё/общее — выбор группы, без счёта', () => {
  const resp = base({
    events: [row()],
    metrics: {
      tasks: {
        available: true,
        all: part({ burn: 9 }),
        by_axis: {
          sprint: { groups: [{ key: 'S_A', total: part({ burn: 5, waiting_t1: 2 }), own: part({ burn: 3 }), shared: part({ burn: 2 }) }] },
        },
      },
    },
  });

  it('спринт: своя группа из by_axis.sprint — числа сервера как есть', () => {
    const b = activityBurn(resp, { kind: 'sprint', id: 'S_A' });
    expect(b.kind).toBe('group');
    if (b.kind !== 'group') return;
    expect(b.total.burn).toBe(5);
    expect(b.own?.burn).toBe(3);
    expect(b.shared?.burn).toBe(2);
    expect(b.total.waiting_t1).toBe(2);
  });

  it('записи нет в разрезе — missing, а не нули', () => {
    expect(activityBurn(resp, { kind: 'sprint', id: 'S_Z' }).kind).toBe('missing');
  });

  it('релиз — итог по выборке (all), своё/общее не делится', () => {
    const b = activityBurn(resp, { kind: 'release', id: 'v1', sprints: ['S_A'] });
    expect(b.kind).toBe('all');
    if (b.kind === 'all') expect(b.total.burn).toBe(9);
  });

  it('история задач недоступна — unavailable с причиной сервера', () => {
    const b = activityBurn(base({ metrics: { tasks: { available: false, reason: 'история задач недоступна' } } }), { kind: 'project', id: 'p' });
    expect(b).toEqual({ kind: 'unavailable', reason: 'история задач недоступна' });
  });

  it('метрик нет вовсе — unavailable, а не ноль', () => {
    expect(activityBurn(base(), { kind: 'project', id: 'p' }).kind).toBe('unavailable');
  });
});

describe('S7A-06 · источник данных', () => {
  it('http: GET /lore/news/v2?<query>, ответ — как есть', async () => {
    const body = base({ events: [row()], meta: { state: 'ok' } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const src = httpActivitySource({ fetchImpl });
    await expect(src('sprint=S&group_by=day')).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith('/lore/news/v2?sprint=S&group_by=day', expect.objectContaining({ method: 'GET' }));
  });

  it('http 403 — ошибка со статусом, которую kit узнаёт как «нет прав»', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'SCOPE_EMPTY', message: 'нет проектов' }), { status: 403 }));
    const err = await httpActivitySource({ fetchImpl })('project=p').catch(e => e);
    expect(err).toBeInstanceOf(NewsV2HttpError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('нет проектов');
    expect(classifyError(err)).toBe('forbidden');
  });

  it('http 502 — ошибка (не пустая лента)', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad gateway', { status: 502 }));
    const err = await httpActivitySource({ fetchImpl })('project=p').catch(e => e);
    expect(classifyError(err)).toBe('error');
    expect(err.status).toBe(502);
  });

  it('фикстура по контракту сужается фильтром записи, ноль строк = empty', async () => {
    const src = fixtureActivitySource(NEWS_V2_FIXTURE);
    const sprint = NEWS_V2_FIXTURE.events.find(e => e.sprint)!.sprint!;
    const got = await src(`sprint=${sprint}&group_by=day`);
    expect(got.events.length).toBeGreaterThan(0);
    expect(got.events.every(e => e.sprint === sprint)).toBe(true);
    const none = await src('sprint=NO_SUCH&group_by=day');
    expect(none.events).toEqual([]);
    expect(none.meta.state).toBe('empty');
  });

  it('переключение на живой API — один флаг; по умолчанию фикстура, пока сервер не на стенде', async () => {
    expect(ACTIVITY_LIVE_API).toBe(false);
    const got = await defaultActivitySource()('group_by=day');
    expect(got.events.length).toBe(NEWS_V2_FIXTURE.events.length);
  });

  it('фикстура покрывает контракт: задача, спека, ×N, без времени, агент, непрочитанное', () => {
    const ev = NEWS_V2_FIXTURE.events;
    expect(ev.some(e => e.type === 'task')).toBe(true);
    expect(ev.some(e => e.type === 'spec')).toBe(true);
    expect(ev.some(e => e.mult > 1)).toBe(true);
    expect(ev.some(e => !e.time_known)).toBe(true);
    expect(ev.some(e => e.author === 'agent')).toBe(true);
    expect(ev.some(e => e.unread)).toBe(true);
  });
});

describe('S7A-06 · локали вкладки', () => {
  it('ru и en совпадают по ключам и плейсхолдерам, без пустых строк', () => {
    expect(Object.keys(ACTIVITY_EN).sort()).toEqual(Object.keys(ACTIVITY_RU).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(ACTIVITY_RU) as (keyof typeof ACTIVITY_RU)[]) {
      expect(ACTIVITY_RU[k].trim(), k).not.toBe('');
      expect(ACTIVITY_EN[k].trim(), k).not.toBe('');
      expect(ph(ACTIVITY_EN[k]), k).toEqual(ph(ACTIVITY_RU[k]));
    }
  });

  it('activityT подставляет {name}; неизвестный язык — русский', () => {
    expect(activityT('en', 'kit.activity.tab')).toBe('Activity');
    expect(activityT('ru', 'kit.activity.tab')).toBe('Активность');
    expect(activityT('de' as 'ru', 'kit.activity.tab')).toBe('Активность');
    expect(activityT('ru', 'kit.activity.mult', { n: 3 })).toContain('3');
  });
});

function row(over: Partial<NewsV2Response['events'][number]> = {}): NewsV2Response['events'][number] {
  return {
    key: 'task:T-1|changed|2026-11-05', type: 'task', el: 'SPRINT_A/T-1', el_key: 'task:SPRINT_A/T-1', kind: 'changed',
    title: 'Задача', day_local: '2026-11-05', time_local: '14:30', at_utc: '2026-11-05T11:30:00Z', time_known: true,
    mult: 1, author: 'human', ...over,
  };
}

function part(over: Record<string, number> = {}) {
  return { burn: 0, ship_correction: 0, waiting_t1: 0, react: { events: 0, elements: 0 }, ...over };
}
