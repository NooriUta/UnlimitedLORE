// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04 — экраны списков спринтов и ADR v2 на
// движке списка kit и реальном API (здесь — подменённый fetch): строка
// [Фильтр][Группировка][Порядок], описание чипами, честные состояния.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from './ListScreen';
import { routeOf } from '../App';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sprints = [
  { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 ACTIVE', git_projects: ['p1'], priority: 1 },
  { sprint_id: 'S_B', name: 'Бета', status_raw: '📋 PLANNED', git_projects: ['p2'], priority: 2 },
  { sprint_id: 'S_C', name: 'Гамма', status_raw: '✅ DONE', git_projects: ['p1'], priority: 3 },
];
const rowIds = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));

/** Адреса, которые экран запросил: срез и модель идут независимо. */
const urls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map(c => String(c[0]));
const asked = (f: { mock: { calls: unknown[][] } }, part: string) => urls(f).some(u => u.includes(part));

describe('маршруты v2', () => {
  it('/sprints и /adrs — экраны списков; хвостовой «/» не мешает', () => {
    expect(routeOf('/sprints')).toBe('sprints');
    expect(routeOf('/adrs/')).toBe('adrs');
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/')).toBe('home');
  });
});

describe('ListScreen — спринты', () => {
  it('грузит слайс sprints, рисует строки и строку управления; фильтр и порядок работают', async () => {
    const fetchImpl = vi.fn(async () => json(200, { rows: sprints }));
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fetchImpl} urlState={false} />);
    // S4-27: спринты — «закрытые внизу, свёрнуты»: S_C (готово) в группе «Закрытые 1».
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
    expect(asked(fetchImpl, '/lore/slice/sprints'), 'срез спринтов запрошен').toBe(true);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Спринты');
    expect(screen.getByRole('group', { name: 'Фильтр' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Группировка' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Порядок' })).toBeTruthy();

    // Фильтр поля — фасет kit (S4-05): кнопка «Статус…» и флажок значения.
    const statusBtn = within(screen.getByTestId('kit-list-controls')).getByRole('button', { name: /^Статус/ });
    fireEvent.click(statusBtn);
    fireEvent.click(within(document.getElementById(statusBtn.getAttribute('aria-controls')!)!).getByRole('checkbox', { name: /В работе/ }));
    fireEvent.click(statusBtn);
    expect(rowIds(container)).toEqual(['S_A']);
    expect(screen.getByRole('button', { name: 'Убрать: Статус: В работе' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать: Статус: В работе' }));

    fireEvent.click(screen.getByRole('button', { name: /^Порядок:/ })); // 08.11: меню kit вместо системного списка
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Порядок' })).getByRole('radio', { name: 'Приоритет' }));
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    // Порядок — внутри открытых; закрытые — своей группой в конце (S4-27).
    fireEvent.click(screen.getByRole('button', { name: /Закрытые\s*1/ }));
    expect(rowIds(container)).toEqual(['S_B', 'S_A', 'S_C']);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 3 из 3');
  });

  it('«Быстро» с иконкой статуса', async () => {
    const { container } = render(<ListScreen screen="sprints" fetchImpl={async () => json(200, { rows: sprints })} urlState={false} />);
    // S4-27: спринты — «закрытые внизу, свёрнуты»: S_C (готово) в группе «Закрытые 1».
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
    expect(container.querySelector('.sk-list__quick [data-quick-icon="progression"]')).toBeTruthy();
  });

  it('обрезано сервером — плашка «Показано N · всего неизвестно», а не «из N»', async () => {
    const { container } = render(
      <ListScreen screen="sprints" fetchImpl={async () => json(200, { rows: sprints, truncated: true, limit: 3 })} urlState={false} />,
    );
    // S4-27: спринты — «закрытые внизу, свёрнуты»: S_C (готово) в группе «Закрытые 1».
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
    expect(screen.getByTestId('kit-list-shown').getAttribute('data-kind')).toBe('unknown_total');
  });

  it('предупреждения сервера (hint/scope) видны над списком', async () => {
    render(<ListScreen screen="sprints" fetchImpl={async () => json(200, { rows: sprints, scope: { applied: true, projects: 1, note: 'показан 1 проект' } })} urlState={false} />);
    await waitFor(() => expect(screen.getByText('показан 1 проект')).toBeTruthy());
  });
});

describe('ListScreen — ADR и честные состояния', () => {
  it('ADR: слайс adrs, статусы словаря ADR', async () => {
    const fetchImpl = vi.fn(async () => json(200, { rows: [
      { adr_id: 'ADR-1', name: 'Один', status: 'ACCEPTED' },
      { adr_id: 'ADR-2', name: 'Два', status: 'PROPOSED' },
    ] }));
    const { container } = render(<ListScreen screen="adrs" fetchImpl={fetchImpl} urlState={false} />);
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
    expect(asked(fetchImpl, '/lore/slice/adrs'), 'срез ADR запрошен').toBe(true);
    expect(container.querySelector('[data-record-id="ADR-1"] [data-status="accepted"]')?.textContent).toContain('Действует');
  });

  it('403 — «нет прав», не пустой список', async () => {
    const { container } = render(<ListScreen screen="adrs" fetchImpl={async () => json(403, { error: 'FORBIDDEN', detail: 'x' })} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-state="forbidden"]')).toBeTruthy());
    expect(container.querySelector('[data-state="empty"]')).toBeNull();
  });

  it('500 — ошибка с причиной и «Повторить»; повтор перезапрашивает', async () => {
    // Отвечаем ПО АДРЕСУ: модель и срез грузятся независимо, и «первый ответ»
    // больше не означает «ответ срезу».
    let sliceTries = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/lore/model')) return json(200, { format: 'model/0', version: 'v1' });
      sliceTries += 1;
      return sliceTries === 1
        ? json(500, { error: 'LORE_UPSTREAM_X', detail: 'boom' })
        : json(200, { rows: sprints });
    });
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fetchImpl} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).toBeTruthy());
    expect(container.querySelector('[data-state="error"]')?.textContent).toContain('boom');
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    // S4-27: спринты — «закрытые внизу, свёрнуты»: S_C (готово) в группе «Закрытые 1».
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
  });

  it('проверенный ноль — «пусто»', async () => {
    const { container } = render(<ListScreen screen="adrs" fetchImpl={async () => json(200, { rows: [] })} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-state="empty"]')).toBeTruthy());
  });
});

describe('код и название — разными колонками, как в v4 (владелица 08.11)', () => {
  it('спринты: первая колонка — ID, вторая — Название; ячейки раздельные', async () => {
    const fetchImpl = vi.fn(async () => json(200, { rows: sprints }));
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fetchImpl} urlState={false} />);
    await waitFor(() => expect(rowIds(container).length).toBeGreaterThan(0));
    const heads = [...container.querySelectorAll('th.sk-list__th')].map(th => th.className.match(/sk-list__c-(\S+)/)?.[1]).filter(Boolean); // без колонки раскрытия ▸
    expect(heads.slice(0, 2)).toEqual(['id', 'title']);
    const row = container.querySelector('[data-record-id="S_A"]')!;
    expect(row.querySelector('td.sk-list__c-id')!.textContent).toBe('S_A');
    expect(row.querySelector('td.sk-list__c-title')!.textContent).toBe('Альфа');
  });
});
