// @vitest-environment jsdom
// Вид «Лента» в разделах LORE (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW).
//
// kit сделал ленту для любого списка, но предлагает её только там, где
// ПРИЛОЖЕНИЕ назвало поле времени (K-14): без `list.feed.timeField` вид молча
// пропадает из переключателя. В LORE его не называл ни один раздел — ленты не
// было нигде, хотя `feed` стоял в `views` у пяти разделов.
//
// Правило проверяется на ВСЕХ разделах сразу: раздел, чей маппер даёт записи
// время, обязан предлагать ленту; раздел без времени — не предлагать и поля не
// выдумывать. Новый раздел с временем и без ленты тест уронит.
//
// Тело — слово владелицы 10.11.2026: «грузить первые 3 абзаца, остальное при
// раскрытии». Где тело уже приходит строкой среза — три абзаца сразу и
// раскрытие на месте; где нет — тело тянется паспортом записи ТОЛЬКО по
// раскрытию, одной записи, а не всей ленты.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { validateKitConfig } from '@seidr/kit/core';
import { LIST_SCREENS, type ListScreenId } from './screens';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

/** Строка «всё сразу»: все ключи и все столбцы времени, какие отдают срезы. */
const SINK: Record<string, unknown> = {
  sprint_id: 'X', adr_id: 'X', task_uid: 'X', decision_id: 'X', spec_id: 'X', question_id: 'X',
  milestone_id: 'X', release_uid: 'X', release_id: 'X', component_id: 'X', tech_id: 'X', uc_id: 'X',
  valid_from: '2026-11-01', created_date: '2026-11-01', date_created: '2026-11-01', opened_date: '2026-11-01',
  release_date: '2026-11-01', checked_at: '2026-11-01', shipped_at: '2026-11-01',
  changed_at: '2026-11-01T10:00:00.000Z',
};

const ids = Object.keys(LIST_SCREENS) as ListScreenId[];

describe('K2-FEED-VIEW · лента — у каждого раздела, где у записи есть время', () => {
  it.each(ids)('%s: время есть → feed в видах и list.feed с полем свежести; нет — ни вида, ни полей', id => {
    const def = LIST_SCREENS[id];
    const cfg = def.config('ru');
    const hasTime = def.map(SINK).updated_at !== undefined;
    if (hasTime) {
      expect(cfg.list?.views, `${id}: время есть, ленты нет`).toContain('feed');
      expect(cfg.list?.feed?.timeField, `${id}: поле времени ленты`).toBe('updated_at');
      expect(cfg.list?.feed?.lead?.length, `${id}: поле сути не названо`).toBeGreaterThan(0);
    } else {
      expect(cfg.list?.views ?? [], `${id}: времени нет — лента выдумана`).not.toContain('feed');
      expect(cfg.list?.feed, `${id}: времени нет — поле выдумано`).toBeUndefined();
    }
    // Ни одного предупреждения про ленту: «feed без полей» и «поля без feed» — оба промах.
    const r = validateKitConfig(cfg);
    // Конфиг раздела — частичный (модули и меню задаёт оболочка): смотрим только ленту.
    expect(r.errors.filter(e => e.path.startsWith('list.feed') || e.code.startsWith('feed'))).toEqual([]);
    expect(r.warnings.filter(w => w.code.startsWith('feed'))).toEqual([]);
  });

  it('у спринта лента двухуровневая: нижний уровень подписан «Задачи»', () => {
    expect(LIST_SCREENS.sprints.config('ru').list?.feed?.under?.title).toBe('Задачи');
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function win(search: string): UrlWindow {
  return { location: { pathname: '/', search, hash: '' }, history: { pushState: () => {}, replaceState: () => {} } } as unknown as UrlWindow;
}

const paras = (n: number, who: string) => Array.from({ length: n }, (_, i) => `${who}: абзац ${i + 1}`).join('\n\n');

const SPRINTS = {
  rows: [{
    sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS', git_projects: [], components: [],
    release_ids: [], milestone_ids: [], changed_at: '2026-11-10T09:00:00.000Z', context_md: paras(5, 'контекст'),
  }],
  truncated: false,
};
const TASKS = {
  rows: [
    { task_uid: 'S1/T-1', task_id: 'T-1', title: 'Задача один', status_raw: '🔄 IN PROGRESS', sprint_id: 'S1', changed_at: '2026-11-10T08:00:00.000Z' },
    { task_uid: 'S1/T-2', task_id: 'T-2', title: 'Задача два', status_raw: '📋 PLANNED', sprint_id: 'S1', changed_at: '2026-11-09T08:00:00.000Z' },
  ],
  truncated: false,
};
const TASK_RECORD = {
  contract: 'lore.record/1',
  record: { id: 'S1/T-1', type: 'task', title: 'Задача один', status: 'active' },
  schema: { type: 'task', fields: [{ key: 'note_md', group: 'body', kind: 'md', editable: true }], relations: [] },
  values: { note_md: paras(5, 'заметка') },
  links: [{ rel: 'JUSTIFIED_BY', dir: 'out', id: 'ADR-X', type: 'adr', title: 'ADR икс' }],
  perms: {}, facts: {}, meta: { facade: 'server', data_state: [] },
};
const SPRINT_TASKS = {
  rows: [{ task_uid: 'SPRINT_A/T-9', task_id: 'T-9', title: 'Задача спринта', status_raw: '📋 PLANNED' }],
  truncated: false,
};

function net(rows: Record<string, unknown>) {
  const paths: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    paths.push(url.pathname);
    if (url.pathname.startsWith('/lore/record/')) return json(TASK_RECORD);
    if (url.pathname.endsWith('/tasks_of_sprint')) return json(SPRINT_TASKS);
    if (url.pathname.startsWith('/lore/slice/') && !url.pathname.endsWith('/facets') && !url.pathname.endsWith('/sprint_totals')) return json(rows);
    return json({ rows: [] });
  });
  return { fn: fn as unknown as typeof fetch, paths };
}

const item = (c: HTMLElement, id: string) => c.querySelector(`.sk-feed [data-record-id="${id}"]`) as HTMLElement;
const shown = (c: HTMLElement, id: string) => [...item(c, id).querySelectorAll('.sk-feed__para')].map(e => e.textContent);

describe('K2-FEED-VIEW · лента открывается в разделе', () => {
  it('у раздела со временем лента стоит в переключателе видов', async () => {
    const { fn } = net(SPRINTS);
    render(<ListScreen screen="sprints" fetchImpl={fn} urlState={win('')} />);
    const group = await screen.findByRole('radiogroup', { name: /Вид/ });
    expect(within(group).getByRole('radio', { name: 'Лента' })).toBeTruthy();
  });

  it('?lv=feed открывает ленту по ссылке', async () => {
    const { fn } = net(SPRINTS);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fn} urlState={win('?lv=feed')} />);
    await waitFor(() => expect(container.querySelector('.sk-list[data-view="feed"]')).not.toBeNull());
    expect(item(container, 'SPRINT_A')).toBeTruthy();
  });
});

describe('K2-FEED-BODY-MORE · тело: первые 3 абзаца, остальное при раскрытии', () => {
  it('тело в строке среза (спринт): три абзаца сразу, «Ещё 2» раскрывает на месте без сети', async () => {
    const { fn, paths } = net(SPRINTS);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fn} urlState={win('?lv=feed')} />);
    await waitFor(() => expect(shown(container, 'SPRINT_A')).toHaveLength(3));
    expect(shown(container, 'SPRINT_A')[0]).toBe('контекст: абзац 1');
    const more = item(container, 'SPRINT_A').querySelector('.sk-feed__bodymore') as HTMLElement;
    expect(more.textContent).toMatch(/2/);
    fireEvent.click(more);
    await waitFor(() => expect(shown(container, 'SPRINT_A')).toHaveLength(5));
    expect(paths.some(p => p.startsWith('/lore/record/'))).toBe(false);
  });

  it('тела в строке нет (задача): до раскрытия паспорт не грузится ни у одной записи; раскрытие грузит ОДНУ', async () => {
    const { fn, paths } = net(TASKS);
    const { container } = render(<ListScreen screen="tasks" fetchImpl={fn} urlState={win('?lv=feed')} />);
    await waitFor(() => expect(item(container, 'S1/T-1')).toBeTruthy());
    expect(paths.filter(p => p.startsWith('/lore/record/'))).toEqual([]);
    const more = item(container, 'S1/T-1').querySelector('.sk-feed__bodymore') as HTMLElement;
    expect(more).toBeTruthy();
    fireEvent.click(more);
    await waitFor(() => expect(shown(container, 'S1/T-1')).toHaveLength(5));
    expect(shown(container, 'S1/T-1')[0]).toBe('заметка: абзац 1');
    expect(paths.filter(p => p.startsWith('/lore/record/'))).toEqual(['/lore/record/task/S1/T-1']);
    // Повод из связей паспорта: «обоснована ADR» встаёт у записи.
    await waitFor(() => expect(item(container, 'S1/T-1').querySelector('.sk-feed__ref')?.textContent).toBe('ADR-X'));
  });

  it('отказ паспорта — причина у записи и повтор, а не пустое тело', async () => {
    const paths: string[] = [];
    const fn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      paths.push(url.pathname);
      if (url.pathname.startsWith('/lore/record/')) return json({ error: 'LORE_UPSTREAM', detail: 'база недоступна' }, 502);
      if (url.pathname === '/lore/slice/open_tasks') return json(TASKS);
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    const { container } = render(<ListScreen screen="tasks" fetchImpl={fn} urlState={win('?lv=feed')} />);
    await waitFor(() => expect(item(container, 'S1/T-1')).toBeTruthy());
    fireEvent.click(item(container, 'S1/T-1').querySelector('.sk-feed__bodymore') as HTMLElement);
    await waitFor(() => expect(item(container, 'S1/T-1').querySelector('.sk-feed__bodyfail')?.textContent).toMatch(/база недоступна/));
  });
});

describe('K2-FEED-TWO-LEVEL · у спринта нижний уровень — его задачи, по раскрытию', () => {
  it('задачи спринта не грузятся до раскрытия; раскрытие приносит их под полосу', async () => {
    const { fn, paths } = net(SPRINTS);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fn} urlState={win('?lv=feed')} />);
    await waitFor(() => expect(item(container, 'SPRINT_A')).toBeTruthy());
    expect(paths.some(p => p.endsWith('/tasks_of_sprint'))).toBe(false);
    const more = item(container, 'SPRINT_A').querySelector('.sk-feed__undermore') as HTMLElement;
    expect(more).toBeTruthy();
    fireEvent.click(more);
    await waitFor(() => expect(container.querySelector('.sk-feed__under [data-record-id="SPRINT_A/T-9"]')).not.toBeNull());
    expect(paths.filter(p => p.endsWith('/tasks_of_sprint'))).toHaveLength(1);
  });
});
