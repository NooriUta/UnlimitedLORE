// @vitest-environment jsdom
// Паспорт записи в ленте LORE (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Прототип принят владельцем 25.11.2026: в режиме «Полные паспорта» каждая
// запись ленты — паспорт целиком (свойства → тело → связи → история свёрткой),
// и история грузится ТОЛЬКО при раскрытии. Источник — тот же, что у паспорта
// записи (/lore/record, при сбое — срезы), и зоны — те же компоненты kit.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import FeedPassport from './FeedPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HISTORY = {
  type: 'sprint', id: 'SP',
  rows: [{
    entity_type: 'sprint', hist_type: 'KnowSprintHist', ref_id: 'SP', state_uid: 'st-1',
    valid_from: '2026-11-01T10:00:00Z', valid_to: null, status_raw: '📋 PLANNED', content_hash: 'h1',
    author: { kind: 'human', caller: 'sub-owner', source: 'hist' },
  }],
  attribution: { ok: true, source: 'changed_by версии (S2-12)' },
};

function fakeFetch(opts: { broken?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (opts.broken) return json({ error: 'BOOM' }, 500);
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname === '/lore/history') return json(HISTORY);
    const slice = url.pathname.split('/').pop();
    if (slice === 'sprints') {
      return json({ rows: [{ sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS', context_md: 'Первый.\n\nВторой.\n\nТретий.\n\nЧетвёртый абзац контекста.' }] });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}
const historyCalls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls
  .filter(c => new URL(String(c[0]), 'http://lore.test').pathname === '/lore/history').length;

describe('BP-01 · паспорт в ленте', () => {
  it('зоны паспорта по порядку: свойства → тело → связи → история', async () => {
    const f = fakeFetch();
    const { container } = render(<FeedPassport type="sprint" id="SP" fetchImpl={f} />);
    await waitFor(() => expect(container.querySelector('[data-zone="links"]')).toBeTruthy(), { timeout: 8000 });
    const zones = [...container.querySelectorAll('[data-zone]')].map(e => e.getAttribute('data-zone'));
    expect(zones).toEqual(['props', 'body', 'links', 'history']);
  }, 15000);

  it('тело — целиком, четвёртый абзац виден без «Ещё»', async () => {
    render(<FeedPassport type="sprint" id="SP" fetchImpl={fakeFetch()} />);
    expect(await screen.findByText(/Четвёртый абзац контекста/, {}, { timeout: 8000 })).toBeTruthy();
  }, 15000);

  it('история не запрашивается, пока её не раскрыли; раскрыли — пришли версии', async () => {
    const f = fakeFetch();
    const { container } = render(<FeedPassport type="sprint" id="SP" fetchImpl={f} />);
    await waitFor(() => expect(container.querySelector('[data-zone="history"] details')).toBeTruthy(), { timeout: 8000 });
    expect(historyCalls(f)).toBe(0);
    const det = container.querySelector('[data-zone="history"] details') as HTMLDetailsElement;
    det.open = true;
    fireEvent(det, new Event('toggle'));
    await waitFor(() => expect(historyCalls(f)).toBe(1));
    await waitFor(() => expect(container.querySelector('[data-zone="history"]')?.textContent).toMatch(/PLANNED/));
  }, 15000);

  it('паспорт не загрузился — причина словами, а не пустой паспорт', async () => {
    const { container } = render(<FeedPassport type="sprint" id="SP" fetchImpl={fakeFetch({ broken: true })} />);
    expect(await screen.findByText('Не смогли загрузить паспорт', {}, { timeout: 8000 })).toBeTruthy();
    expect(container.querySelector('[data-zone]')).toBeNull();
  }, 15000);
});
