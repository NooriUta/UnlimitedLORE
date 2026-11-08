// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33 — демо паспортов /kit/passport на формах реальных слайсов LORE.
// Ответы слайсов — копии живых строк (sprints, adr, spec_by_id, tasks_by_uids от 08.11),
// урезанные до нужных полей. Проверяем: адаптер даёт запись и связи, раскладка
// меняется местом, упавший вспомогательный слайс — ошибка блока, а не «пусто».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import PassportDemo from './PassportDemo';
import { routeOf } from '../App';
import { loadPassport } from '../record/passportAdapters';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/kit/passport'); });

const SPRINT = { sprint_id: 'PLAN_HOUND_D4_PARITY', name: 'Hound Phase D, step D4-2', priority: 'P0', valid_from: '2026-06-15T00:00:00.000Z', status_raw: '✅ DONE',
  release_ids: ['v1.5.0'], git_projects: ['NooriUta/AIDA'], components: ['HND'], milestone_ids: ['M3'], planned_start_date: '2026-06-08', planned_end_date: '2026-06-15', context_md: 'D4-step-2 byte-parity tooling' };
const ADR = { adr_id: 'ADR-LORE-014', name: null, status: 'ACCEPTED', date_created: '2026-07-12', context_md: 'Контекст', decision_md: 'Решение', consequences_md: 'Следствия',
  components: ['LORE'], depends_on_ids: ['ADR-LORE-010'], supersedes_ids: [], superseded_by_ids: [], tags: ['mcp'], git_projects: ['NooriUta/UnlimitedLORE'], justified_task_uids: ['SPRINT_X/SE-10'] };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
function fakeFetch(fail: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const name = u.pathname.split('/').pop()!;
    if (fail.includes(name)) return json({ error: 'LORE_UPSTREAM', detail: 'boom' }, 502);
    if (name === 'sprints') return json({ rows: [SPRINT] });
    if (name === 'tasks_of_sprint') return json({ rows: [{ task_id: 'T1', title: 'Задача', status_raw: '✅ DONE', order_index: 1 }] });
    if (name === 'adrs') return json({ rows: [{ adr_id: 'ADR-LORE-014', name: 'Имена MCP' }] });
    if (name === 'adr') return json({ rows: [ADR] });
    if (name === 'decisions_of_adr') return json({ rows: [{ decision_id: 'D-1', title: 'Решение 1', status: 'accepted' }] });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}
const slice = (f: typeof fetch) => async <T,>(name: string, params?: Record<string, string>) => {
  const u = new URL(`http://x/lore/slice/${name}`);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const r = await f(u.toString());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as { rows: T[] };
};

describe('маршрут', () => {
  it('/kit/passport — демо паспортов', () => {
    expect(routeOf('/kit/passport')).toBe('passport');
  });
});

describe('адаптер на реальных строках', () => {
  it('спринт: статус из эмодзи-строки, поля, задачи и связи с проектом', async () => {
    const p = await loadPassport('sprint', 'PLAN_HOUND_D4_PARITY', 'ru', slice(fakeFetch()));
    expect(p.record.status).toBe('done');
    expect(p.record.fields.projects).toEqual(['NooriUta/AIDA']);
    expect(p.data.edges.some(e => e.type === 'HAS_TASK')).toBe(true);
    expect(p.data.edges.some(e => e.type === 'BELONGS_TO_PROJECT' && e.to === 'NooriUta/AIDA')).toBe(true);
  });
  it('ADR: тело из трёх секций, заголовок без имени — ID, решения и «обосновывает» — связями', async () => {
    const p = await loadPassport('adr', 'ADR-LORE-014', 'ru', slice(fakeFetch()));
    expect(p.record.title).toBe('ADR-LORE-014');
    expect(p.record.body_md).toMatch(/Контекст[\s\S]*Решение[\s\S]*Следствия/);
    expect(p.data.edges.map(e => e.type).sort()).toEqual(['BELONGS_TO_PROJECT', 'DECIDED_IN', 'DEPENDS_ON', 'JUSTIFIED_BY']);
  });
  it('упал слайс решений — ошибка блока, а не «решений нет»', async () => {
    const p = await loadPassport('adr', 'ADR-LORE-014', 'ru', slice(fakeFetch(['decisions_of_adr'])));
    expect(p.data.meta.errors?.[0].block).toBe('decisions');
  });
});

describe('страница', () => {
  it('снизу: вкладки записи справа, «Вокруг записи» колонкой; панелью справа — всё вкладками', async () => {
    const { container } = render(<PassportDemo fetchImpl={fakeFetch()} />);
    await screen.findByRole('heading', { level: 1, name: /Hound Phase D/ });
    expect(container.querySelector('aside[data-zone="around"]')).not.toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Где открыт' })).getByRole('button', { name: 'панелью справа' }));
    await waitFor(() => expect(container.querySelector('aside[data-zone="around"]')).toBeNull());
    expect(screen.getAllByRole('tab').some(t => t.getAttribute('data-zone') === 'around')).toBe(true);
    expect(new URLSearchParams(window.location.search).get('place')).toBe('right');
  });
});
