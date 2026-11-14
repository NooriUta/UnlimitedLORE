// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08 — виды LORE v2 на заглушке по контракту S2
// (SPRINT_UXR_S2_GRAPH_MEMORY/S2-04, D-2026-UXR-VIEWS-SERVER): у разделов
// спринтов и ADR есть командные виды по умолчанию, личные виды переживают
// перезагрузку в кэше lore.v2.*, экран собирается из kit (SavedListView).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SavedListView, queryToListState, teamDefault } from '@seidr/kit';
import type { KitConfig, KitData } from '@seidr/kit';
import { LORE_VIEW_SECTIONS, LORE_VIEWS_API, createLoreViewStub, loreTeamViews } from './loreViews';

function memStorage() {
  const m = new Map<string, string>();
  return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); } };
}

describe('контракт S2 — адреса и формы', () => {
  it('CRUD видов — серверный /lore/me/views (MINI-03), раздел — параметром', () => {
    expect(LORE_VIEWS_API).toEqual({
      list: 'GET /lore/me/views?section={section}',
      create: 'POST /lore/me/views',
      update: 'POST /lore/me/views (view_uid + expected_version)',
      remove: 'POST /lore/me/views/delete',
    });
  });

  it('разделы с видами — спринты, ADR и спеки (MINI-03)', () => {
    expect([...LORE_VIEW_SECTIONS]).toEqual(['sprints', 'adrs', 'specs']);
  });
});

describe('командные виды по умолчанию', () => {
  it.each(LORE_VIEW_SECTIONS)('у раздела %s ровно один командный вид по умолчанию', section => {
    const team = loreTeamViews('ru').filter(v => v.section === section);
    expect(team.length).toBeGreaterThan(0);
    expect(team.filter(v => v.team_default)).toHaveLength(1);
    expect(team.every(v => v.owner === null && v.visibility === 'all')).toBe(true);
    expect(teamDefault(team, section)).not.toBeNull();
  });

  it('строки запроса командных видов разбираются без потерь', () => {
    for (const v of loreTeamViews('ru')) {
      const s = queryToListState(v.query);
      expect(v.query === '' || s.group !== null || s.sort !== null || s.quick !== null || Object.keys(s.filters).length > 0, v.id).toBe(true);
    }
  });

  it('имена командных видов — на языке интерфейса', () => {
    const ru = loreTeamViews('ru').map(v => v.name);
    const en = loreTeamViews('en').map(v => v.name);
    expect(ru).toHaveLength(en.length);
    expect(ru).not.toEqual(en);
  });
});

describe('заглушка хранилища', () => {
  it('личный вид пишется в lore.v2.views и читается после «перезагрузки»', async () => {
    const backing = memStorage();
    const a = createLoreViewStub({ user: 'kc-1', lang: 'ru', storage: backing });
    const v = await a.create({ name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me' });
    expect([...backing.m.keys()]).toEqual(['lore.v2.views']);
    const b = createLoreViewStub({ user: 'kc-1', lang: 'ru', storage: backing });
    expect((await b.list('sprints')).map(x => x.id)).toContain(v.id);
  });

  it('чужой личный вид не виден; общий («всем») — виден', async () => {
    const backing = memStorage();
    const a = createLoreViewStub({ user: 'kc-1', lang: 'ru', storage: backing });
    await a.create({ name: 'Личный', section: 'adrs', query: '', visibility: 'me' });
    await a.create({ name: 'Общий', section: 'adrs', query: '', visibility: 'all' });
    const b = createLoreViewStub({ user: 'kc-2', lang: 'ru', storage: backing });
    const names = (await b.list('adrs')).filter(x => x.owner !== null).map(x => x.name);
    expect(names).toEqual(['Общий']);
  });
});

describe('экран: kit SavedListView + заглушка LORE', () => {
  const cfg: KitConfig = {
    modules: [], menu: { groups: [] }, kinds: { sprint: { title: 'Спринты', icon: 'sprint' } },
    statuses: { items: [
      { code: 'planned', title: 'План', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
      { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'var(--acc)' },
      { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
    ] },
    list: {
      views: ['list'], filters: ['status'], groupings: ['status'], columns: ['title+id', 'status'],
      quick: [{ id: 'active', title: 'В работе', filter: { status: 'active' } }],
    },
  };
  const data: KitData = {
    records: [
      { id: 'S1', kind: 'sprint', title: 'Один', status: 'active', fields: {} },
      { id: 'S2', kind: 'sprint', title: 'Два', status: 'done', fields: {} },
      { id: 'S3', kind: 'sprint', title: 'Три', status: 'planned', fields: {} },
    ],
    edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: 3 },
  };

  it('раздел открывается командным видом, «Сохранить как» → свой вид, «Сбросить» → командный', async () => {
    const store = createLoreViewStub({ user: 'kc-1', lang: 'ru', storage: memStorage() });
    const team = teamDefault(loreTeamViews('ru'), 'sprints')!;
    const { container } = render(<SavedListView config={cfg} data={data} store={store} section="sprints" user="kc-1" urlState={false} />);
    const viewSel = () => screen.getByLabelText('Вид') as HTMLSelectElement;
    await waitFor(() => expect(viewSel().value).toBe(team.id));
    // Фильтр поля — фасет kit (S4-05): кнопка «Статус…» и флажок значения.
    const statusBtn = within(screen.getByTestId('kit-list-controls')).getByRole('button', { name: /^Статус/ });
    fireEvent.click(statusBtn);
    fireEvent.click(within(document.getElementById(statusBtn.getAttribute('aria-controls')!)!).getByRole('checkbox', { name: /Готово/ }));
    fireEvent.click(statusBtn);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }));
    fireEvent.change(screen.getByLabelText('Имя вида'), { target: { value: 'Готовые' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Создать вид' })); });
    const mine = (await store.list('sprints')).find(v => v.name === 'Готовые')!;
    await waitFor(() => expect(viewSel().value).toBe(mine.id));
    expect(container.querySelectorAll('[data-record-id]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(viewSel().value).toBe(team.id);
  });
});
