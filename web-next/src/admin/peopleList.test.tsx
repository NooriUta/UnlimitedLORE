// @vitest-environment jsdom
// «Люди и их проекты» на объёме (SPRINT_UXR_S7B_ADMIN/S7B-28). Владелица 11.11.2026:
// «и Люди должны быть табличным стандартным значением, а тот экран, который собран
// сейчас, должен стать паспортом»; ответы на прототип: 1а «+ Человек» — мастер
// боковым листом на месте; 2а первые 50 + «ещё»; 3а по имени + стандартные виды
// (таблица / плашки), сортировка и фильтры; 4а роль и проект + «без проектов» и поиск;
// 5а разрез по роли выкл по умолчанию.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { WhoWhereScreen } from './WhoWhereScreen';
import { peopleRecords } from './peopleList';
import { buildParticipation } from './participation';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const matrix = (n: number) => Array.from({ length: n }, (_, i) => ({
  kc_sub: `u-${String(i).padStart(2, '0')}`,
  display_name: `Человек ${String(i).padStart(2, '0')}`,
  projects: i === 7 ? [] : ['NooriUta/UnlimitedLORE', ...(i % 2 ? ['AIDA/miniLORE'] : [])],
  roles: i === 7 ? [] : [i < 2 ? 'owner' : 'reader', ...(i % 2 ? ['reader'] : [])],
}));

function fake(n: number) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/lore/slice/role_matrix')) return json({ rows: matrix(n) });
    if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: [] });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('модель: человек → запись списка', () => {
  it('роли без повторов, проекты, их число; без проектов — поля проектов нет (быстрый фильтр «без проектов»)', () => {
    const p = buildParticipation(matrix(8), { rows: [] } as never);
    const recs = peopleRecords(p, 'u-00');
    const one = recs.find(r => r.id === 'u-01')!;
    expect(one.fields.roles).toEqual(['owner', 'reader']);
    expect(one.fields.n_projects).toBe(2);
    const none = recs.find(r => r.id === 'u-07')!;
    expect(none.fields.projects).toBeUndefined();
    expect(none.fields.n_projects).toBe(0);
    expect(recs.find(r => r.id === 'u-00')!.title).toMatch(/это вы/);
  });
});

describe('экран «Люди и их проекты»', () => {
  it('стандартный список kit: таблица и плашки, первые 50 из 55 и «ещё»', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake(55)} /></KitLangProvider>);
    await settle();
    await screen.findAllByRole('row');
    expect(document.querySelectorAll('[data-record-id]').length).toBe(50);
    expect(screen.getByRole('radio', { name: 'Карточки' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ещё/ })).toBeTruthy();
  });

  it('строка открывает паспорт человека справа: его проекты и роли (нынешний экран)', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake(3)} /></KitLangProvider>);
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: 'Человек 01' }));
    const dlg = await screen.findByRole('dialog', { name: 'Человек 01' });
    expect(within(dlg).getAllByText('AIDA/miniLORE').length).toBeGreaterThan(0);
    expect(new URL(window.location.href).searchParams.get('adm-open')).toBe('u-01');
  });

  it('«+ Человек» открывает мастер подключения боковым листом на месте', async () => {
    render(<KitLangProvider lang="ru"><WhoWhereScreen fetchImpl={fake(3)} /></KitLangProvider>);
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: '+ Человек' }));
    expect(await screen.findByRole('dialog', { name: 'Подключить человека' })).toBeTruthy();
  });
});
