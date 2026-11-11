// @vitest-environment jsdom
// Фильтр «Изменены с … по …» в разделах LORE (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE).
//
// Kit даёт абстрактный диапазон; здесь — то, что знает только LORE (K-14):
// ключ адреса `changed`, поле времени записи (changed_at → updated_at),
// параметры среза `changed_from` / `changed_to`
// (SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE) и какие разделы время не отдают.
//
// Честность: сервер параметры принял — отобрал он, и чип без оговорок; сервер
// их не знает (400 «unknown param») — запрос повторяется без них, отбор идёт по
// загруженному, и чип так и говорит: «по загруженному».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';
import { forgetRangeSupport } from './dateRange';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200, date?: string) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...(date ? { date } : {}) },
  });

const ROWS = [
  { sprint_id: 'SP-IN', name: 'Спринт внутри', status_raw: '🔄 IN PROGRESS', changed_at: '2026-11-10T12:00:00Z' },
  { sprint_id: 'SP-OUT', name: 'Спринт снаружи', status_raw: '🔄 IN PROGRESS', changed_at: '2026-10-01T12:00:00Z' },
];
const SERVER_DATE = 'Wed, 11 Nov 2026 09:00:00 GMT';

/** Сеть: срез отвечает строками; `rejectRange` — сервер ещё не знает changed_from. */
function net({ rejectRange = false } = {}) {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    if (u.includes('/slice/sprints')) {
      if (rejectRange && u.includes('changed_from')) return json({ error: 'BAD_PARAMS', detail: 'unknown param: changed_from' }, 400);
      return json({ rows: ROWS }, 200, SERVER_DATE);
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const url = (search: string) => { window.history.replaceState(null, '', '/' + search); };
const desc = () => screen.findByTestId('kit-list-desc', {}, { timeout: 8000 });

beforeEach(() => { forgetRangeSupport(); url(''); });

describe('K2-DATE-RANGE · диапазон уходит в срез', () => {
  it('положительный контроль: без диапазона параметров нет, видны обе записи', async () => {
    const { impl, urls } = net();
    render(<ListScreen screen="sprints" fetchImpl={impl} />);
    await screen.findByText('Спринт снаружи', {}, { timeout: 8000 });
    expect(urls.some(u => u.includes('changed_from'))).toBe(false);
  }, 15000);

  it('?changed=2026-11-10..2026-11-11 (UTC) → changed_from/changed_to мгновениями, отобрал сервер', async () => {
    url('?changed=2026-11-10..2026-11-11&changed_tz=utc');
    const { impl, urls } = net();
    render(<ListScreen screen="sprints" fetchImpl={impl} />);
    const d = await desc();
    const u = decodeURIComponent(urls.find(x => x.includes('/slice/sprints'))!);
    expect(u).toContain('changed_from=2026-11-10T00:00:00.000Z');
    expect(u).toContain('changed_to=2026-11-11T23:59:59.999Z');
    expect(d.textContent).toContain('Изменены: 10–11 ноября (UTC)');
    expect(d.textContent).not.toContain('по загруженному');
  }, 15000);

  it('сервер параметров не знает (400) — повтор без них, отбор по загруженному, сказано словами', async () => {
    url('?changed=2026-11-10..&changed_tz=utc');
    const { impl, urls } = net({ rejectRange: true });
    render(<ListScreen screen="sprints" fetchImpl={impl} />);
    await screen.findByText('Спринт внутри', {}, { timeout: 8000 });
    expect(screen.queryByText('Спринт снаружи')).toBeNull();
    expect((await desc()).textContent).toContain('по загруженному');
    const sliceCalls = urls.filter(x => x.includes('/slice/sprints'));
    expect(sliceCalls.some(x => x.includes('changed_from'))).toBe(true);
    expect(sliceCalls.some(x => !x.includes('changed_from'))).toBe(true);
  }, 15000);

  it('быстрый период пишется в адрес именем', async () => {
    const { impl } = net();
    render(<ListScreen screen="sprints" fetchImpl={impl} />);
    await screen.findByText('Спринт снаружи', {}, { timeout: 8000 });
    fireEvent.click(within(screen.getByTestId('kit-daterange')).getByRole('button'));
    fireEvent.click(screen.getByRole('radio', { name: '7 дней' }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('changed')).toBe('7d'));
  }, 15000);
});

describe('K2-DATE-RANGE · раздел без времени — фильтр недоступен с причиной', () => {
  it('вехи: срез времени не отдаёт — кнопка выключена, причина словами', async () => {
    const impl = vi.fn(async () => json({ rows: [{ milestone_id: 'M1', title: 'Веха', status_raw: 'planned' }] })) as unknown as typeof fetch;
    render(<ListScreen screen="milestones" fetchImpl={impl} />);
    const box = await screen.findByTestId('kit-daterange', {}, { timeout: 8000 });
    const btn = within(box).getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toMatch(/недоступен/);
  }, 15000);
});
