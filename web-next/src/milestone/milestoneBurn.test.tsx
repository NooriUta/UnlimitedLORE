// @vitest-environment jsdom
// Сгорание вехи — как у спринта (SPRINT_UXR_POLISH_UAT_1113/PU-27).
//
// Слово владелицы 13.11 со скрина списка вех: «у вех как у спринтов нет
// сгорания — добавить». Сгорание вехи — по задачам ЕЁ спринтов (ребро
// TARGETS_MILESTONE): та же строка BURN-DOWN и тот же «Цель к сроку»
// (K2-VIEW-TARGET), что у спринта, — одним кодом, а не параллельной копией.
//
// Главное, что закрепляем: числа вехи = сумма по её спринтам (и только по ним);
// срок берётся из «Когда» вехи; замороженная историческая веха — без прогноза.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MilestoneBurnLine } from './MilestoneBurnLine';
import { milestoneDue } from './milestoneDue';
import { SprintBurnLine } from '../sprint/SprintBurnLine';

const created = [
  { task_uid: 'S1/A', valid_from: '2026-11-01T00:00:00Z' },
  { task_uid: 'S1/B', valid_from: '2026-11-01T00:00:00Z' },
  { task_uid: 'S2/C', valid_from: '2026-11-02T00:00:00Z' },
  { task_uid: 'S2/D', valid_from: '2026-11-02T00:00:00Z' },
  { task_uid: 'S2/E', valid_from: '2026-11-03T00:00:00Z' },
  // Чужой спринт и спринт с похожим именем — не в вехе.
  { task_uid: 'S3/F', valid_from: '2026-11-01T00:00:00Z' },
  { task_uid: 'S10/G', valid_from: '2026-11-01T00:00:00Z' },
];
const done = [
  { task_uid: 'S1/A', valid_from: '2026-11-03T00:00:00Z' },
  { task_uid: 'S2/C', valid_from: '2026-11-04T00:00:00Z' },
  { task_uid: 'S3/F', valid_from: '2026-11-04T00:00:00Z' },
];

type Bodies = Record<string, unknown>;
function loader(bodies: Bodies) {
  return async (slice: string) => {
    const b = bodies[slice];
    if (b instanceof Error) throw b;
    return b;
  };
}
const HISTORY = { task_created_dates: { rows: created }, task_done_dates: { rows: done } };
const milestone = (sprints: (string | null)[], when = 'прогноз Q4 2026') => ({
  milestone_by_id: { rows: [{ milestone_id: 'M-X', date_display: when, direct_sprint_ids: sprints }] },
});

const num = (text: string, key: RegExp) => Number(text.match(new RegExp(`${key.source}\\s*(\\d+)`, 'i'))?.[1]);

describe('PU-27 · срок вехи из «Когда»', () => {
  it('квартал — конец квартала; диапазон — конец последнего', () => {
    expect(milestoneDue('прогноз Q4 2026')).toEqual({ due: '2026-12-31', frozen: false });
    expect(milestoneDue('прогноз Q1–Q2 2027')).toEqual({ due: '2027-06-30', frozen: false });
    expect(milestoneDue('прогноз Q4 2026 – Q1 2027')).toEqual({ due: '2027-03-31', frozen: false });
  });
  it('дата ISO и «день месяц год» — как есть; месяц с годом — конец месяца', () => {
    expect(milestoneDue('2026-12-15').due).toBe('2026-12-15');
    expect(milestoneDue('15 дек 2026').due).toBe('2026-12-15');
    expect(milestoneDue('авг 2026').due).toBe('2026-08-31');
  });
  it('без года срок не выдумывается — null', () => {
    expect(milestoneDue('18 апр').due).toBeNull();
    expect(milestoneDue('Ноя+').due).toBeNull();
    expect(milestoneDue('').due).toBeNull();
  });
  it('заморожена / закрыта — признак frozen', () => {
    expect(milestoneDue('июл–ноя 2026 (заморожена)').frozen).toBe(true);
    expect(milestoneDue('июль 2026 (закрыта)').frozen).toBe(true);
    expect(milestoneDue('прогноз Q4 2026').frozen).toBe(false);
  });
});

describe('PU-27 · строка BURN-DOWN вехи — по задачам её спринтов', () => {
  it('числа вехи = сумма по спринтам S1+S2, без чужих S3 и S10', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone(['S1', 'S2', null]) })} />);
    const line = (await screen.findByTestId('sprint-burn')).textContent ?? '';
    expect(num(line, /объём/)).toBe(5);
    expect(num(line, /закрыто/)).toBe(2);
    expect(num(line, /остаток/)).toBe(3);
  });

  it('сверка с паспортами спринтов: объём и закрыто вехи = сумма строк спринтов', async () => {
    const l = loader(HISTORY);
    const s1 = render(<SprintBurnLine sprintId="S1" load={l} />);
    const t1 = (await s1.findByTestId('sprint-burn')).textContent ?? '';
    s1.unmount();
    const s2 = render(<SprintBurnLine sprintId="S2" load={l} />);
    const t2 = (await s2.findByTestId('sprint-burn')).textContent ?? '';
    s2.unmount();
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone(['S1', 'S2']) })} />);
    const m = (await screen.findByTestId('sprint-burn')).textContent ?? '';
    expect(num(m, /объём/)).toBe(num(t1, /объём/) + num(t2, /объём/));
    expect(num(m, /закрыто/)).toBe(num(t1, /закрыто/) + num(t2, /закрыто/));
    expect(num(m, /остаток/)).toBe(num(t1, /остаток/) + num(t2, /остаток/));
  });

  it('«Цель к сроку» — срок из «Когда», вердикт словами и график по кнопке', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone(['S1', 'S2']) })} />);
    expect(await screen.findByTestId('sprint-burn-verdict')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Цель к сроку/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('замороженная историческая веха — без прогноза и вердикта, словами', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone(['S1'], 'июл–ноя 2026 (заморожена)') })} />);
    expect(await screen.findByTestId('sprint-burn')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn-verdict')).toBeNull();
    expect(screen.getByTestId('milestone-burn-frozen')).toBeTruthy();
  });

  it('срок не распознан — так и сказано, прогноза нет', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone(['S1'], '18 апр') })} />);
    expect(await screen.findByTestId('sprint-burn-no-deadline')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn-verdict')).toBeNull();
  });

  it('у вехи нет спринтов — честное «сгорать нечему», а не нули', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, ...milestone([null]) })} />);
    expect(await screen.findByTestId('milestone-burn-nosprints')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn')).toBeNull();
  });

  it('спринты вехи не прочитались — ошибка, а не «пусто»', async () => {
    render(<MilestoneBurnLine milestoneId="M-X" today="2026-11-05" load={loader({ ...HISTORY, milestone_by_id: new Error('сеть') })} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('sprint-burn')).toBeNull();
  });
});

describe('PU-27 · строка сгорания дошла до паспорта вехи', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const FACADE = {
    contract: 'lore.record/1',
    record: { type: 'milestone', id: 'M-X', title: 'Веха Икс', status: '', version: '2026-11-13T10:00:00Z' },
    values: { title: 'Веха Икс', date: 'прогноз Q4 2026' },
    parts: [], links: [],
    perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
    facts: {},
    schema: {
      type: 'milestone', label: 'Веха', label_key: 'rec.milestone', icon: 'crossed-axes',
      fields: [
        { key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: false },
        { key: 'date', label: 'Срок', label_key: 'pp.field.date', kind: 'text', group: 'props', required: false, editable: false },
      ],
      layout: {}, relations: [],
    },
    meta: { facade: 'server', sources: {}, data_state: [] },
  };
  it('паспорт вехи показывает BURN-DOWN по задачам её спринтов', async () => {
    const { default: ListPassport } = await import('../record/ListPassport');
    const f = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname.startsWith('/lore/record/')) return json(FACADE);
      if (url.pathname === '/lore/history') return json({ type: 'milestone', id: 'M-X', rows: [], attribution: { ok: true } });
      if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
      const slice = url.pathname.split('/').pop();
      if (slice === 'milestone_by_id') return json(milestone(['S1', 'S2']).milestone_by_id);
      if (slice === 'task_created_dates') return json({ rows: created });
      if (slice === 'task_done_dates') return json({ rows: done });
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    render(<ListPassport type="milestone" id="M-X" placement="bottom" fetchImpl={f} backLabel="Вехи" onBack={() => {}} />);
    const line = (await screen.findByTestId('sprint-burn', {}, { timeout: 8000 })).textContent ?? '';
    expect(num(line, /объём/)).toBe(5);
    expect(screen.getByRole('button', { name: /Цель к сроку/ })).toBeTruthy();
  }, 15000);
});
