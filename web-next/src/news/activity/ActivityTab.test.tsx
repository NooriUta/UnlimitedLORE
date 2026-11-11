// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-06 · вкладка «Активность» на паспортах проекта, вехи,
// спринта и релиза. Паспорта делает S5: он вставляет готовую вкладку kit через
// KindConfig.tabs (activityKindTab) — без своей логики ленты.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { KitLangProvider } from '@seidr/kit';
import type { KitCtx, KitRecord } from '@seidr/kit';
import { axeViolations } from '../../test/axe';
import {
  ActivityTab, activityKindTab, NewsV2HttpError,
  type ActivitySource, type NewsV2Response, type NewsV2Row,
} from './index';

beforeAll(() => registerGameIcons(gameIcons));

const ROWS: NewsV2Row[] = [
  {
    key: 'task:SPRINT_A/T-1|changed|2026-11-06', type: 'task', el: 'SPRINT_A/T-1', el_key: 'task:SPRINT_A/T-1',
    kind: 'changed', title: 'Починить ленту', day_local: '2026-11-06', time_local: '14:30',
    at_utc: '2026-11-06T11:30:00Z', time_known: true, mult: 3, author: 'agent', who: 'claude',
    from: 'in_progress', to: 'ready', sprint: 'SPRINT_A', projects: ['lore'], unread: true,
  },
  {
    key: 'spec:SPEC-X|version|2026-11-06', type: 'spec', el: 'SPEC-X', el_key: 'spec:SPEC-X', kind: 'version',
    title: 'Алгоритмы новостей', day_local: '2026-11-06', time_local: '09:05', at_utc: '2026-11-06T06:05:00Z',
    time_known: true, mult: 1, author: 'human', sprint: 'SPRINT_A',
  },
  {
    key: 'release:v1|released|2026-11-05', type: 'release', el: 'v1', el_key: 'release:v1', kind: 'released',
    title: 'v1', day_local: '2026-11-05', time_local: null, at_utc: null, time_known: false, mult: 1, author: 'unknown',
  },
];

function resp(over: Partial<NewsV2Response> = {}): NewsV2Response {
  return {
    events: ROWS,
    metrics: {
      counts: { total: { events: 5, elements: 3 } },
      tasks: {
        available: true,
        all: { burn: 4, ship_correction: 1, waiting_t1: 2, react: { events: 1, elements: 1 } },
        by_axis: {
          sprint: {
            groups: [{
              key: 'SPRINT_A',
              total: { burn: 4, ship_correction: 1, waiting_t1: 2, react: { events: 1, elements: 1 } },
              own: { burn: 3, ship_correction: 0, waiting_t1: 1, react: { events: 0, elements: 0 } },
              shared: { burn: 1, ship_correction: 1, waiting_t1: 1, react: { events: 1, elements: 1 } },
            }],
          },
        },
      },
    },
    meta: { state: 'ok', errors: [], validation: { ok: true }, truncated: false, period: { from: '', to: '', tz: 'Europe/Moscow' } },
    ...over,
  };
}

const ok = (r: NewsV2Response = resp()): ActivitySource => vi.fn(async () => r);
const href = (row: NewsV2Row) => `/lore?passport=${encodeURIComponent(row.el)}`;

describe('S7A-06 · лента записи', () => {
  it('запрашивает новости по своей записи', async () => {
    const src = ok();
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={src} hrefFor={href} />);
    await screen.findAllByTestId('kit-activity-row');
    expect(src).toHaveBeenCalledWith(expect.stringContaining('sprint=SPRINT_A'), expect.anything());
  });

  it('строки по дням; время местное и машинное рядом; без времени — честно «время неизвестно»', async () => {
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} />);
    const rows = await screen.findAllByTestId('kit-activity-row');
    expect(rows).toHaveLength(3);
    expect(screen.getAllByTestId('kit-activity-day').map(d => d.getAttribute('data-day'))).toEqual(['2026-11-06', '2026-11-05']);
    const t = within(rows[0]);
    expect(t.getByText('14:30')).toBeTruthy();
    expect(t.getByText('11:30 UTC')).toBeTruthy();
    expect(rows[0].querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-06T11:30:00Z');
    expect(within(rows[2]).getByText('время неизвестно')).toBeTruthy();
  });

  it('задача и спека — ссылки на свои паспорта', async () => {
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} />);
    const task = await screen.findByRole('link', { name: /Починить ленту/ });
    expect(task.getAttribute('href')).toBe('/lore?passport=SPRINT_A%2FT-1');
    expect(screen.getByRole('link', { name: /Алгоритмы новостей/ }).getAttribute('href')).toBe('/lore?passport=SPEC-X');
  });

  it('×N (серия событий элемента за день), переход статусов, агент и непрочитанное видны', async () => {
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} />);
    const r = within((await screen.findAllByTestId('kit-activity-row'))[0]);
    expect(r.getByText('×3')).toBeTruthy();
    expect(r.getByText('in_progress')).toBeTruthy();
    expect(r.getByText('ready')).toBeTruthy();
    expect(r.getByText('агент')).toBeTruthy();
    expect(r.getByText('новое')).toBeTruthy();
  });

  it('сводка рисует числа сервера: события·элементы, сгорание своё/общее, ждёт выкатки (жёлтым), поправка выкатки, реактивация', async () => {
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} />);
    const s = within(await screen.findByTestId('kit-activity-summary'));
    expect(s.getByTestId('kit-activity-m-total').textContent).toContain('5');
    expect(s.getByTestId('kit-activity-m-total').textContent).toContain('3');
    expect(s.getByTestId('kit-activity-m-burn-own').textContent).toContain('3');
    expect(s.getByTestId('kit-activity-m-burn-shared').textContent).toContain('1');
    const wait = s.getByTestId('kit-activity-m-waiting');
    expect(wait.textContent).toContain('2');
    expect(wait.getAttribute('data-tone')).toBe('wrn');
    expect(s.getByTestId('kit-activity-m-ship').textContent).toContain('1');
    expect(s.getByTestId('kit-activity-m-react').textContent).toContain('1');
  });

  it('история задач недоступна — «не смогли посчитать», а не нули', async () => {
    const r = resp({ metrics: { counts: { total: { events: 5, elements: 3 } }, tasks: { available: false, reason: 'история задач недоступна' } } });
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok(r)} hrefFor={href} />);
    const s = within(await screen.findByTestId('kit-activity-summary'));
    expect(s.queryByTestId('kit-activity-m-burn-own')).toBeNull();
    expect(s.getByTestId('kit-activity-m-unavailable').textContent).toContain('история задач недоступна');
  });

  it('axe: без нарушений', async () => {
    const { container } = render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} />);
    await screen.findAllByTestId('kit-activity-row');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('en: подписи из локали вкладки', async () => {
    render(<KitLangProvider lang="en"><ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok()} hrefFor={href} /></KitLangProvider>);
    const rows = await screen.findAllByTestId('kit-activity-row');
    expect(within(rows[2]).getByText('time unknown')).toBeTruthy();
    expect(within(rows[0]).getByText('agent')).toBeTruthy();
  });
});

describe('S7A-06 · честные состояния (S7A-07)', () => {
  it('empty — проверенный ноль', async () => {
    render(<ActivityTab target={{ kind: 'project', id: 'p' }} source={ok(resp({ events: [], meta: { state: 'empty', errors: [] } }))} />);
    const e = await screen.findByTestId('kit-activity-empty');
    expect(e.querySelector('[data-state="empty"]')).toBeTruthy();
  });

  it('partial — лента есть, недоступный источник назван громко (role=alert)', async () => {
    const r = resp({ meta: { state: 'partial', errors: [{ source: 'tasks', error: 'timeout', critical: true }] } });
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok(r)} hrefFor={href} />);
    const alert = await screen.findByTestId('kit-activity-partial');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('tasks');
    expect(alert.textContent).toContain('timeout');
    expect(screen.getAllByTestId('kit-activity-row')).toHaveLength(3);
  });

  it('partial и ноль строк — не «пусто»', async () => {
    const r = resp({ events: [], meta: { state: 'partial', errors: [{ source: 'tasks', error: 'down', critical: true }] } });
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok(r)} />);
    await screen.findByTestId('kit-activity-partial');
    expect(screen.queryByTestId('kit-activity-empty')).toBeNull();
  });

  it('нет meta.state — плашка «полноту проверить нечем»', async () => {
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok(resp({ meta: {} }))} hrefFor={href} />);
    expect((await screen.findByTestId('kit-activity-unverified')).textContent).toMatch(/провер/);
  });

  it('проваленная сверка и обрезка выдачи — видны', async () => {
    const r = resp({ meta: { state: 'ok', truncated: true, validation: { ok: false } } });
    render(<ActivityTab target={{ kind: 'sprint', id: 'SPRINT_A' }} source={ok(r)} hrefFor={href} />);
    await screen.findByTestId('kit-activity-validation');
    expect(screen.getByTestId('kit-activity-truncated')).toBeTruthy();
  });

  it('403 — «нет прав», а не пусто', async () => {
    const src: ActivitySource = vi.fn(async () => { throw new NewsV2HttpError(403, 'SCOPE_EMPTY'); });
    const { container } = render(<ActivityTab target={{ kind: 'project', id: 'p' }} source={src} />);
    await waitFor(() => expect(container.querySelector('[data-state="forbidden"]')).toBeTruthy());
  });

  it('сбой сети — ошибка с «Повторить», а не пусто', async () => {
    const src: ActivitySource = vi.fn(async () => { throw new NewsV2HttpError(502, 'bad gateway'); });
    render(<ActivityTab target={{ kind: 'project', id: 'p' }} source={src} />);
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('error');
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('релиз без спринтов — объяснение, запроса нет', async () => {
    const src = ok();
    render(<ActivityTab target={{ kind: 'release', id: 'v1' }} source={src} />);
    expect((await screen.findByTestId('kit-activity-unsupported')).textContent).toMatch(/спринт/);
    expect(src).not.toHaveBeenCalled();
  });
});

describe('S7A-06 · вставка в паспорт S5 через KindConfig.tabs', () => {
  it('activityKindTab — вкладка «activity», ссылки через ctx.href, спринты релиза из записи', async () => {
    const src = ok();
    const tab = activityKindTab({ kind: 'release', source: src, sprintsOf: r => r.fields.sprints as string[] });
    expect(tab.key).toBe('activity');
    expect(tab.title).toBe('Активность');
    const rec: KitRecord = { id: 'v1', kind: 'release', title: 'v1', status: 'done', fields: { sprints: ['SPRINT_A'] } };
    const ctx = { href: (id: string) => `#/r/${id}` } as unknown as KitCtx;
    render(<>{tab.render(rec, ctx)}</>);
    const link = await screen.findByRole('link', { name: /Починить ленту/ });
    expect(link.getAttribute('href')).toBe('#/r/SPRINT_A/T-1');
    expect(src).toHaveBeenCalledWith(expect.stringContaining('sprint=SPRINT_A'), expect.anything());
  });

  it('en-заголовок вкладки', () => {
    expect(activityKindTab({ kind: 'project', lang: 'en' }).title).toBe('Activity');
  });
});
