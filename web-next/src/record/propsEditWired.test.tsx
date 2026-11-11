// @vitest-environment jsdom
// Правка характеристики в паспорте — сквозь всю цепочку
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, «правка характеристик»).
//
// Урок «разбор написан ≠ данные доходят» (kit/src/wired.test.ts): проверяем от
// ответа фасада до POST записи. Схема называет поле правимым и даёт путь
// `write`, справочник `dictionary` даёт варианты — человек видит ✎, выбирает и
// сохраняет, а запрос уходит по пути из схемы, а не по своей таблице клиента.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FACADE = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SP', title: 'Спринт', status: 'active', version: 'V1' },
  values: { title: 'Спринт', priority: 'P1', created: '2026-11-01' },
  parts: [], links: [],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'calendar', layout: {}, relations: [],
    fields: [
      { key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: true, write: null },
      { key: 'priority', label: 'Приоритет', label_key: 'f.p', kind: 'enum', group: 'props', required: false, editable: true, dict: 'priority', write: { endpoint: '/lore/sprint/plan', field: 'priority' } },
      { key: 'created', label: 'Создан', label_key: 'f.c', kind: 'date', group: 'props', required: false, editable: false, write: null },
    ],
  },
  meta: { facade: 'server', sources: { block: [] }, data_state: [] },
};

function net() {
  const posts: { path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://lore.test');
    if (init?.method === 'POST') { posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) }); return json({ ok: true }); }
    if (url.pathname.startsWith('/lore/record/')) return json(FACADE);
    if (url.pathname === '/lore/history') return json({ type: 'sprint', id: 'SP', rows: [], attribution: { ok: true } });
    if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
    if (url.pathname.endsWith('/dictionary')) {
      return json({ rows: [
        { dict_type: 'priority', code: 'P1', label_ru: 'Высокий', sort_order: 1 },
        { dict_type: 'priority', code: 'P2', label_ru: 'Средний', sort_order: 2 },
      ] });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { fn, posts };
}

describe('S4-24 · характеристика правится в паспорте и пишется по пути схемы', () => {
  it('✎ у «Приоритет» → выбор → «Сохранить» → POST /lore/sprint/plan {sprint_id, priority}', async () => {
    const { fn, posts } = net();
    render(<ListPassport type="sprint" id="SP" placement="full" fetchImpl={fn} backLabel="Спринты" onBack={() => {}} />);
    const pen = await screen.findByRole('button', { name: 'Править «Приоритет»' }, { timeout: 8000 });
    expect(screen.queryByRole('button', { name: 'Править «Создан»' })).toBeNull();
    fireEvent.click(pen);
    const sel = screen.getByLabelText('Приоритет') as HTMLSelectElement;
    expect([...sel.options].map(o => o.textContent)).toEqual(['— не задано —', 'Высокий', 'Средний']);
    fireEvent.change(sel, { target: { value: 'P2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(posts).toEqual([{ path: '/lore/sprint/plan', body: expect.objectContaining({ sprint_id: 'SP', priority: 'P2' }) }]);
  }, 15000);
});
