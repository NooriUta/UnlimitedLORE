// @vitest-environment jsdom
// Peek из списка LORE (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD): пробел на строке
// раздела — панель справа с карточкой записи из фасада lore.record; тип записи — вид строки.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sprints = [
  { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 ACTIVE', git_projects: ['p1'], priority: 1 },
  { sprint_id: 'S_B', name: 'Бета', status_raw: '📋 PLANNED', git_projects: ['p2'], priority: 2 },
];
const facade = (id: string, title: string) => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id, title, status: 'ACTIVE', version: null, updated_at: null, updated_by: null },
  schema: { type: 'sprint', label: 'Спринт', icon: 'x', fields: [], tabs: [], relations: [] },
  values: {}, links: [], facts: null,
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: 'x', facade: 'server', sources: [] },
});

describe('ListScreen — Peek', () => {
  it('пробел на строке спринта — панель с карточкой из фасада; J — карточка следующей строки', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/lore/record/sprint/S_A')) return json(200, facade('S_A', 'Альфа из фасада'));
      if (u.includes('/lore/record/sprint/S_B')) return json(200, facade('S_B', 'Бета из фасада'));
      return json(200, { rows: sprints });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fetchImpl as unknown as typeof fetch} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="S_A"]')).toBeTruthy());
    const rowA = container.querySelector<HTMLElement>('[data-record-id="S_A"]')!;
    rowA.focus();
    fireEvent.keyDown(rowA, { code: 'Space', key: ' ' });
    expect(await screen.findByText('Альфа из фасада')).toBeTruthy();
    fireEvent.keyDown(rowA, { code: 'KeyJ', key: 'о' });
    expect(await screen.findByText('Бета из фасада')).toBeTruthy();
    vi.unstubAllGlobals();
  }, 20000);
});
