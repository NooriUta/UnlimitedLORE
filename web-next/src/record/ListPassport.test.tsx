// @vitest-environment jsdom
// Правка на месте в паспорте из списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): ✎ у текста записи,
// сохранение существующим путём записи, после записи — перечитать; ADR — без ✎.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const SPRINT = { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 IN PROGRESS', planned_end_date: '2026-11-12', valid_from: '2026-11-08T00:00:00Z', context_md: 'старый текст' };
const ADR = { adr_id: 'ADR-1', name: 'Решение', status: 'PROPOSED', context_md: 'к', decision_md: 'р', consequences_md: 'с', components: [], git_projects: [], depends_on_ids: [], supersedes_ids: [], superseded_by_ids: [], justified_task_uids: [], tags: [] };

function fake() {
  let context = SPRINT.context_md;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') { context = JSON.parse(String(init.body)).context_md; return json({ ok: true }); }
    const name = new URL(url, 'http://x').pathname.split('/').pop();
    if (name === 'sprints') return json({ rows: [{ ...SPRINT, context_md: context }] });
    if (name === 'tasks_of_sprint') return json({ rows: [] });
    if (name === 'adr') return json({ rows: [ADR] });
    if (name === 'decisions_of_adr') return json({ rows: [] });
    return json({ rows: [] });
  });
}

describe('правка на месте в паспорте', () => {
  it('спринт: ✎ у текста → правка → сохранение в /lore/sprint/update → паспорт перечитан', async () => {
    const f = fake();
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={f as unknown as typeof fetch} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Править «Текст»' }, { timeout: 8000 }));
    fireEvent.click(screen.getByRole('radio', { name: 'Код' }));
    fireEvent.change(screen.getByLabelText('Текст · исходник markdown'), { target: { value: 'новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = f.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(String(post[0])).toBe('/lore/sprint/update');
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ sprint_id: 'S_A', context_md: 'новый текст' });
    // после записи паспорт перечитан с сервера
    await waitFor(() => expect(f.mock.calls.filter(c => String(c[0]).includes('/lore/slice/sprints')).length).toBeGreaterThan(1));
  }, 15000);

  it('ADR: кнопки ✎ нет — тело склеено из разделов', async () => {
    render(<ListPassport type="adr" id="ADR-1" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} />);
    await screen.findByRole('heading', { level: 1, name: 'Решение' }, { timeout: 8000 });
    expect(screen.queryByRole('button', { name: /^Править/ })).toBeNull();
  }, 15000);
});
