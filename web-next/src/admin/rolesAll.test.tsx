// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-11 — общая матрица «все проекты × все люди».
// SPRINT_UXR_S7B_ADMIN/S7B-04 — карточки человека и роли с «почему видит».
//
// S7B-11, «Готово, когда»: в «Ролях и правах» есть матрица проект × люди с 47
// назначениями (23 проекта; omiloreadmin — owner во всех 23, vasilisk — в 17,
// ivanovalex32 — в 4, frolova — reader в 3), и роль в ячейке меняется кликом.
// До этого PR матрица строилась только по ОДНОМУ выбранному человеку.
// Правка ячейки идёт тем же путём, что везде: дифф dry_run → ввод логина →
// пачка (DangerBatch); у пачки один человек, поэтому правка по проекту сразу
// у нескольких людей идёт очередью — по человеку на пачку.
//
// S7B-04: у человека в «Ролях» — блок «почему видит / не видит» (сервер
// GET /lore/admin/access, PR #952); у роли — карточка: что роль даёт (видит,
// пишет ли) и у кого она есть.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { RolesScreen } from './RolesScreen';
import { countAssignments, parseRoleMatrix, projectPersonCell, roleCanWrite, roleHolders, roleSummary, splitByPerson } from './roles';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const P = Array.from({ length: 23 }, (_, i) => `AIDA/p${String(i + 1).padStart(2, '0')}`);
const row = (kc: string, name: string, projects: string[], role: string) => ({
  kc_sub: kc, display_name: name, projects, roles: projects.map(() => role),
  cells: projects.map(p => ({ project: p, role, state: 'checked', source: 'graph' })), state: 'checked',
});
const FJ = { project: '*', role: null, state: 'unavailable', source: 'forgejo', reason: 'нет связи с пользователем Forgejo' };
const KC = { project: '*', role: 'admin', roles: ['admin'], state: 'checked', source: 'kc' };
// Реальная форма прода по замеру раунда 3: 23 + 17 + 4 + 3 = 47.
const MATRIX = {
  rows: [
    { ...row('u-omi', 'omiloreadmin', P, 'owner'), cells: [...row('u-omi', 'omiloreadmin', P, 'owner').cells, KC, FJ] },
    row('u-vas', 'vasilisk', P.slice(0, 17), 'owner'),
    row('u-iva', 'ivanovalex32', P.slice(0, 4), 'developer'),
    row('u-fro', 'frolova', P.slice(0, 3), 'reader'),
  ],
  sources_asked: ['graph', 'kc'],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fake() {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.startsWith('/lore/slice/role_matrix')) return json(MATRIX);
    if (url === '/lore/user/role/batch' && body?.dry_run) {
      const plan = (body.changes as Array<{ project: string; role?: string; action?: string }>).map(c => ({
        project: c.project, before: null, after: c.role ?? null, kind: c.action === 'remove' ? 'remove' : 'grant',
        sign: '+', check: { state: 'checked', source: 'graph' },
      }));
      return json({ ok: true, plan, undo: [], dry_run: true, applied: 0 });
    }
    if (url.startsWith('/lore/admin/access/agents')) return json({ agents: [], visible_projects: 0 });
    if (url.startsWith('/lore/admin/access')) {
      return json({ project: 'AIDA/p01', realm_role: null, project_role: 'reader', scope_enforced: true, sees: true, can_write: false, agent_profiles: [], chain: ['роль в проекте AIDA/p01 — «reader»: проект виден'] });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  const dry = () => calls.filter(c => c.url === '/lore/user/role/batch' && c.body?.dry_run === true);
  return { f, calls, dry };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><RolesScreen fetchImpl={f} /></KitLangProvider>);
const at = (qs: string) => window.history.replaceState(null, '', `/?${qs}`);

describe('S7B-11 · модель общей матрицы', () => {
  const data = parseRoleMatrix(MATRIX);

  it('назначений 47 — ячейки на человека («*», KC/Forgejo) не считаются', () => {
    expect(countAssignments(data)).toBe(47);
    expect(data.projects).toHaveLength(23);
  });

  it('ячейка «проект × человек»: роль — значение; нет роли в проверенной строке — «значения нет»', () => {
    expect(projectPersonCell(data, 'AIDA/p01', 'u-fro')).toEqual({ state: 'value', value: 'reader' });
    expect(projectPersonCell(data, 'AIDA/p23', 'u-fro')).toEqual({ state: 'none' });
  });

  it('строка не проверена или источник не назван — «не смогли проверить», не «роли нет»', () => {
    const old = parseRoleMatrix({ rows: MATRIX.rows.map(r => ({ kc_sub: r.kc_sub, display_name: r.display_name, projects: r.projects, roles: r.roles })) });
    expect(projectPersonCell(old, 'AIDA/p23', 'u-fro').state).toBe('unverified');
    expect(projectPersonCell(old, 'AIDA/p01', 'u-fro').state).toBe('unverified');
  });

  it('правка по проекту сразу у нескольких — по пачке на человека', () => {
    const groups = splitByPerson([
      { row: 'AIDA/p23', col: 'u-fro', value: 'reader', from: { state: 'none' } },
      { row: 'AIDA/p22', col: 'u-fro', value: null, from: { state: 'value', value: 'reader' } },
      { row: 'AIDA/p23', col: 'u-iva', value: 'developer', from: { state: 'none' } },
    ]);
    expect(groups).toEqual([
      { kc_sub: 'u-fro', changes: [{ project: 'AIDA/p23', role: 'reader' }, { project: 'AIDA/p22', action: 'remove' }] },
      { kc_sub: 'u-iva', changes: [{ project: 'AIDA/p23', role: 'developer' }] },
    ]);
  });
});

describe('S7B-11 · экран общей матрицы', () => {
  it('вид «все проекты × все люди» — в адресе; 23 строки × 4 колонки, итог 47 назначений', async () => {
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-roles-by-all'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-roles-by')).toBe('all'));
    const box = await screen.findByTestId('adm-roles-all');
    expect(within(box).getByTestId('adm-roles-all-total').textContent).toContain('47');
    expect(within(box).getByTestId('kit-matrix-cell-AIDA/p01-u-omi').getAttribute('data-state')).toBe('value');
    expect(within(box).getByTestId('kit-matrix-cell-AIDA/p23-u-fro').getAttribute('data-state')).toBe('none');
    const valued = box.querySelectorAll('[data-testid^="kit-matrix-cell-"][data-state="value"]');
    // Матрица назначений + блок источников (KC у omiloreadmin) — источники отдельно.
    const main = within(box).getByTestId('adm-roles-all-matrix');
    expect(main.querySelectorAll('[data-testid^="kit-matrix-cell-"][data-state="value"]')).toHaveLength(47);
    expect(valued.length).toBeGreaterThanOrEqual(47);
  });

  it('у людей видны Keycloak и Forgejo — Forgejo «не спрашивали», правки у них нет', async () => {
    at('adm-roles-by=all');
    mount(fake().f);
    const src = await screen.findByTestId('adm-roles-all-sources');
    expect(within(src).getByTestId('kit-matrix-cell-kc-u-omi').getAttribute('data-state')).toBe('value');
    expect(within(src).getByTestId('kit-matrix-cell-forgejo-u-omi').getAttribute('data-state')).toBe('unasked');
    expect(within(src).queryByTestId('kit-matrix-rowset-kc')).toBeNull();
  });

  it('клик по ячейке → роль из палитры → дифф пачкой у этого человека, ничего не записано без логина', async () => {
    at('adm-roles-by=all');
    const fk = fake();
    mount(fk.f);
    fireEvent.click(await screen.findByTestId('kit-matrix-cell-AIDA/p23-u-fro'));
    fireEvent.click(await screen.findByTestId('kit-matrix-opt-reader'));
    await screen.findByTestId('kit-diff-apply');
    expect(fk.dry()).toHaveLength(1);
    expect(fk.dry()[0].body!.kc_sub).toBe('u-fro');
    expect(fk.dry()[0].body!.changes).toEqual([{ project: 'AIDA/p23', role: 'reader' }]);
    expect(screen.getByTestId('adm-danger-confirm')).toBeTruthy();
  });

  it('правка проекта всем людям — очередь: сначала первый человек, остальные названы числом', async () => {
    at('adm-roles-by=all');
    const fk = fake();
    mount(fk.f);
    fireEvent.click(await screen.findByTestId('kit-matrix-rowset-AIDA/p23'));
    fireEvent.click(await screen.findByTestId('kit-matrix-opt-reader'));
    await screen.findByTestId('kit-diff-apply');
    expect(fk.dry()).toHaveLength(1);
    expect(screen.getByTestId('adm-roles-queue').textContent).toMatch(/\d/);
    fireEvent.click(screen.getByTestId('adm-danger-cancel'));
    await waitFor(() => expect(fk.dry()).toHaveLength(2));
    expect(fk.dry()[1].body!.kc_sub).not.toBe(fk.dry()[0].body!.kc_sub);
  });
});

describe('S7B-04 · карточка роли', () => {
  const data = parseRoleMatrix(MATRIX);

  it('модель: reader только читает, остальные роли пишут; держатели роли и сводка по ролям', () => {
    expect(roleCanWrite('reader')).toBe(false);
    expect(roleCanWrite('owner')).toBe(true);
    expect(roleHolders(data, 'reader')).toEqual([{ kc_sub: 'u-fro', name: 'frolova', projects: ['AIDA/p01', 'AIDA/p02', 'AIDA/p03'] }]);
    expect(roleSummary(data)).toEqual([
      { role: 'owner', people: 2, assignments: 40 },
      { role: 'developer', people: 1, assignments: 4 },
      { role: 'reader', people: 1, assignments: 3 },
    ]);
  });

  it('вид «по ролям» — роль в адресе; карточка: что даёт и у кого есть', async () => {
    at('adm-roles-by=role');
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-role-reader'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-role')).toBe('reader'));
    const card = await screen.findByTestId('adm-role-card');
    expect(within(card).getByTestId('adm-role-grants').getAttribute('data-write')).toBe('false');
    expect(within(card).getByTestId('adm-role-holder-u-fro').textContent).toContain('3');
    expect(within(card).queryByTestId('adm-role-holder-u-omi')).toBeNull();
  });

  it('роль, которой ни у кого нет, — «ни у кого нет» словами, а не пустая карточка', async () => {
    at('adm-roles-by=role&adm-role=marketer');
    mount(fake().f);
    const card = await screen.findByTestId('adm-role-card');
    expect(within(card).getByTestId('adm-role-nobody')).toBeTruthy();
  });

  it('держатель роли ведёт в карточку человека', async () => {
    at('adm-roles-by=role&adm-role=reader');
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-role-open-u-fro'));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-person')).toBe('u-fro'));
    expect(new URLSearchParams(window.location.search).get('adm-roles-by')).toBeNull();
    expect(await screen.findByTestId('adm-roles-card')).toBeTruthy();
  });
});

describe('S7B-04 · карточка человека: почему видит', () => {
  it('в карточке человека — блок «почему видит / не видит» с итогом сервера', async () => {
    at('adm-person=u-fro');
    const fk = fake();
    mount(fk.f);
    const card = await screen.findByTestId('adm-roles-card');
    const acc = within(card).getByTestId('adm-access');
    fireEvent.change(within(acc).getByTestId('adm-acc-project'), { target: { value: 'AIDA/p01' } });
    const verdict = await within(card).findByTestId('adm-acc-verdict');
    expect(verdict.getAttribute('data-sees')).toBe('true');
    expect(verdict.getAttribute('data-write')).toBe('false');
    expect(fk.calls.some(c => c.url.startsWith('/lore/admin/access?') && c.url.includes('kc_sub=u-fro'))).toBe(true);
    expect(within(card).getByTestId('adm-agents-see')).toBeTruthy();
  });
});
