// @vitest-environment jsdom
// Паспорт записи: правка MD-поля открывает мини-окно ссылки по «[[» (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW,
// ADR-LORE-050). Без этого подключения окно жило бы только в kit, и на стенде его не было бы видно.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import type { Editor } from '@tiptap/react';

// jsdom не меряет раскладку (тот же приём, что в kit/src/content/tiptapMath.test.tsx).
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
for (const proto of [Range.prototype, Element.prototype, Text.prototype as unknown as Element]) {
  const p = proto as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  if (typeof p.getClientRects !== 'function') p.getClientRects = noRects;
  if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = zeroRect;
}

import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const SPRINT = { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 IN PROGRESS', planned_end_date: '2026-11-12', valid_from: '2026-11-08T00:00:00Z', context_md: 'текст' };

describe('паспорт: окно ссылки в правке MD', () => {
  it('«[[Ал» в тексте спринта открывает окно ссылки', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const name = new URL(String(input), 'http://x').pathname.split('/').pop();
      if (name === 'sprints') return json({ rows: [SPRINT] });
      return json({ rows: [] });
    });
    const { container } = render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={f as unknown as typeof fetch} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Править «Текст»' }, { timeout: 8000 }));
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    const editor = (container.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
    await act(() => { editor.view.dom.focus(); editor.chain().focus('end').insertContent(' [[Ал').run(); });
    await waitFor(() => expect(container.querySelector('.sk-ref')).toBeTruthy());
  }, 15000);
});

describe('паспорт: ссылка в чтении ведёт в паспорт записи', () => {
  it('[[adr:ADR-1]] в тексте спринта — <a href> на паспорт ADR', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const name = new URL(String(input), 'http://x').pathname.split('/').pop();
      if (name === 'sprints') return json({ rows: [{ ...SPRINT, context_md: 'см. [[adr:ADR-1]]' }] });
      return json({ rows: [] });
    });
    const { container } = render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={f as unknown as typeof fetch} />);
    await waitFor(() => expect(container.querySelector('a.sk-wref')).toBeTruthy(), { timeout: 8000 });
    expect(container.querySelector('a.sk-wref')?.getAttribute('href')).toContain('open=ADR-1');
  }, 15000);
});

describe('паспорт: Peek по ссылке в чтении', () => {
  it('наведение на [[adr:ADR-1]] — карточка с названием записи из фасада', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const adr = {
      contract: 'lore.record/1',
      record: { type: 'adr', id: 'ADR-1', title: 'Решение про ссылки', status: 'ACCEPTED', version: null, updated_at: null, updated_by: null },
      schema: { type: 'adr', label: 'ADR', icon: 'x', fields: [], tabs: [], relations: [] },
      values: {}, links: [], facts: null,
      perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
      meta: { loaded_at: 'x', facade: 'server', sources: [] },
    };
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/lore/record/adr/')) return json(adr);
      const name = new URL(u, 'http://x').pathname.split('/').pop();
      if (name === 'sprints') return json({ rows: [{ ...SPRINT, context_md: 'см. [[adr:ADR-1]]' }] });
      return json({ rows: [] });
    });
    vi.stubGlobal('fetch', f);
    const { container } = render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={f as unknown as typeof fetch} />);
    await waitFor(() => expect(container.querySelector('a.sk-wref')).toBeTruthy(), { timeout: 8000 });
    fireEvent.mouseOver(container.querySelector('a.sk-wref')!);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(await screen.findByText('Решение про ссылки', {}, { timeout: 5000 })).toBeTruthy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }, 20000);
});

// SPRINT_UXR_POLISH_UAT_1113/PU-09: на стенде щелчок по ссылке в тексте уводил в раздел записи
// с полным паспортом — спринт терялся. Щелчок открывает карточку только для чтения; паспорт на месте.
describe('паспорт: щелчок по ссылке в чтении — карточка, не переход (PU-09)', () => {
  it('щелчок по [[adr:ADR-1]] — карточка с «Открыть паспорт», переход не случился', async () => {
    const adr = {
      contract: 'lore.record/1',
      record: { type: 'adr', id: 'ADR-1', title: 'Решение про ссылки', status: 'ACCEPTED', version: null, updated_at: null, updated_by: null },
      schema: { type: 'adr', label: 'ADR', icon: 'x', fields: [], tabs: [], relations: [] },
      values: {}, links: [], facts: null,
      perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
      meta: { loaded_at: 'x', facade: 'server', sources: [] },
    };
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/lore/record/adr/')) return json(adr);
      const name = new URL(u, 'http://x').pathname.split('/').pop();
      if (name === 'sprints') return json({ rows: [{ ...SPRINT, context_md: 'см. [[adr:ADR-1]]' }] });
      return json({ rows: [] });
    });
    vi.stubGlobal('fetch', f);
    const { container } = render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={f as unknown as typeof fetch} />);
    await waitFor(() => expect(container.querySelector('a.sk-wref')).toBeTruthy(), { timeout: 8000 });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { container.querySelector('a.sk-wref')!.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(await screen.findByText('Решение про ссылки', {}, { timeout: 5000 })).toBeTruthy();
    expect(container.querySelector('a.sk-wref')).toBeTruthy(); // текст спринта на месте
    vi.unstubAllGlobals();
  }, 20000);
});
