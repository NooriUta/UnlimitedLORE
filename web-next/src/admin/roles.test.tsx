// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-03 · S7B-05 · S7B-09 — роли человека в админке v2.
//
// Сервер (LoreUserResource.setUserRoleBatch, LoreRoleBatch, PR #953/#1043):
//   POST /lore/user/role/batch {kc_sub, display_name, changes, dry_run?, undo_of?}
//   • dry_run → plan[{project, before, after, kind grant|update|remove|unchanged,
//     sign, check{state checked|unavailable|forbidden, source}}] + undo;
//   • применение → batch_id, applied, failed, atomic:false, items[{project, kind,
//     status, result applied|failed|unchanged, error?}], undo, undo_until;
//   • отмена — тот же вызов с changes=undo и undo_of=batch_id; вне окна — 400.
// Матрица — срез role_matrix (cells со state, sources_asked).
//
// Проверяем ПРАВИЛА:
//   • S7B-09: 23 роли — не 23 строки с красной кнопкой, а группы по роли,
//     свёрнутые; поиск; мультивыбор; одно подтверждение с диффом на N;
//   • S7B-03: опасное — только через дифф и ввод логина; «Отменить» пачкой;
//     ссылка на запись в журнале; отказ/403/частичный отказ названы словами;
//   • S7B-05: матрица ролей человека по проектам, «задать всей строке» —
//     массовая правка тем же путём (дифф → подтверждение → пачка);
//   • выбор (человек, вид, поиск, отмеченные проекты) — в адресе.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { RolesScreen } from './RolesScreen';
import {
  buildChanges, filterProjects, groupByRole, isConfirmed, parseApply, parsePlan, parseRoleMatrix, planToDiff,
  PROJECT_ROLES,
} from './roles';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const BATCH = 'rb-1762767074000-ab12cd34';
const P23 = Array.from({ length: 23 }, (_, i) => `AIDA/p${String(i + 1).padStart(2, '0')}`);
const R23 = P23.map((_, i) => (i < 20 ? 'owner' : 'reader'));

const cells = (projects: string[], roles: string[]) =>
  projects.map((p, i) => ({ project: p, role: roles[i], state: 'checked', source: 'graph' }));

const MATRIX = {
  rows: [
    { kc_sub: 'u-owner', display_name: 'omiloreadmin', projects: P23, roles: R23, cells: cells(P23, R23), state: 'checked' },
    { kc_sub: 'u-fro', display_name: 'frolova', projects: ['AIDA/p01'], roles: ['reader'], cells: cells(['AIDA/p01'], ['reader']), state: 'checked' },
  ],
  sources_asked: ['graph'],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Change = { project: string; role?: string; action?: string };

/** Сервер в миниатюре: план «было → станет» по текущим ролям, как LoreRoleBatch.plan. */
function planOf(current: Record<string, string>, changes: Change[]) {
  return changes.map(c => {
    const before = current[c.project] ?? null;
    const remove = c.action === 'remove';
    const after = remove ? null : c.role!;
    const kind = remove ? (before === null ? 'unchanged' : 'remove')
      : before === null ? 'grant' : before === after ? 'unchanged' : 'update';
    const sign = kind === 'grant' ? '+' : kind === 'remove' ? '−' : kind === 'update' ? '~' : '=';
    return { project: c.project, before, after, kind, sign, check: { state: 'checked', source: 'graph' } };
  });
}

interface FakeOpts {
  matrix?: unknown;
  matrixStatus?: number;
  dryStatus?: number;
  dryBody?: unknown;
  /** Проекты, по которым применение отказывает (частичный отказ). */
  failOn?: string[];
  undoStatus?: number;
  undoBody?: unknown;
}

function fake(opts: FakeOpts = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.startsWith('/lore/slice/role_matrix')) return json(opts.matrix ?? MATRIX, opts.matrixStatus ?? 200);
    if (url === '/lore/user/role/batch' && body) {
      const row = (MATRIX.rows.find(r => r.kc_sub === body.kc_sub) ?? { projects: [], roles: [] });
      const current: Record<string, string> = {};
      row.projects.forEach((p, i) => { current[p] = row.roles[i]; });
      const changes = body.changes as Change[];
      const plan = planOf(current, changes);
      const undo = plan.filter(p => p.kind !== 'unchanged')
        .map(p => (p.before === null ? { project: p.project, action: 'remove' } : { project: p.project, role: p.before }));
      if (body.dry_run) {
        if (opts.dryStatus) return json(opts.dryBody ?? { error: 'FORBIDDEN', detail: 'нужна роль admin' }, opts.dryStatus);
        return json({ ok: true, kc_sub: body.kc_sub, plan, undo, dry_run: true, applied: 0 });
      }
      if (body.undo_of && opts.undoStatus) {
        return json(opts.undoBody ?? { error: 'BAD_PARAMS', detail: 'undo_of: окно отмены пачки закрыто' }, opts.undoStatus);
      }
      const fail = new Set(opts.failOn ?? []);
      const items = plan.map(p => (p.kind === 'unchanged'
        ? { project: p.project, kind: 'unchanged', result: 'unchanged' }
        : fail.has(p.project)
          ? { project: p.project, kind: p.kind, status: 409, result: 'failed', error: { error: 'ROLE_REMOVAL_BLOCKED', detail: 'последний owner проекта' } }
          : { project: p.project, kind: p.kind, status: 200, outcome: 'updated', result: 'applied' }));
      const applied = items.filter(i => i.result === 'applied').length;
      return json({
        ok: true, batch_id: body.undo_of ? 'rb-1762767999000-00000001' : BATCH, kc_sub: body.kc_sub, plan, undo,
        applied, failed: items.filter(i => i.result === 'failed').length, atomic: false, items,
        undo_until: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(body.undo_of ? { undo_of: body.undo_of } : {}),
      });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  const writes = () => calls.filter(c => c.url === '/lore/user/role/batch' && c.body && !c.body.dry_run);
  const dry = () => calls.filter(c => c.url === '/lore/user/role/batch' && c.body?.dry_run === true);
  return { f, calls, writes, dry };
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><RolesScreen fetchImpl={f} /></KitLangProvider>);
const at = (qs: string) => window.history.replaceState(null, '', `/?${qs}`);

// ── модель ────────────────────────────────────────────────────────────────

describe('модель · матрица ролей (role_matrix)', () => {
  it('ячейки — из cells со состоянием; проекты — объединение по всем людям', () => {
    const d = parseRoleMatrix(MATRIX);
    expect(d.people.map(p => p.name)).toEqual(['omiloreadmin', 'frolova']);
    expect(d.people[0].cells).toHaveLength(23);
    expect(d.people[0].cells[0]).toEqual({ project: 'AIDA/p01', role: 'owner', state: 'checked', source: 'graph' });
    expect(d.projects).toEqual(P23);
    expect(d.sourcesAsked).toEqual(['graph']);
  });

  it('нет cells (сборка сервера старше K2-MATRIX) — роли по позиции, но «проверено» не выдумываем', () => {
    const d = parseRoleMatrix({ rows: [{ kc_sub: 'u', display_name: 'u', projects: ['a'], roles: ['owner'] }] });
    expect(d.people[0].cells).toEqual([{ project: 'a', role: 'owner', state: 'unavailable', source: null }]);
    expect(d.people[0].state).toBe('unknown');
    expect(d.sourcesAsked).toEqual([]);
  });

  it('ячейки на человека (project «*», Keycloak/Forgejo — S7B-11) — не проект и не правятся как роль проекта', () => {
    const d = parseRoleMatrix({
      sources_asked: ['graph', 'kc'],
      rows: [{ kc_sub: 'u', display_name: 'u', state: 'checked', cells: [
        { project: 'a', role: 'owner', state: 'checked', source: 'graph' },
        { project: '*', role: 'admin, viewer', roles: ['admin', 'viewer'], state: 'checked', source: 'kc' },
        { project: '*', role: null, state: 'unavailable', source: 'forgejo', reason: 'нет связи с пользователем Forgejo' },
      ] }],
    });
    expect(d.projects).toEqual(['a']);
    expect(d.people[0].cells).toEqual([{ project: 'a', role: 'owner', state: 'checked', source: 'graph' }]);
    expect(d.people[0].personCells).toEqual([
      { source: 'kc', role: 'admin, viewer', state: 'checked', reason: null },
      { source: 'forgejo', role: null, state: 'unavailable', reason: 'нет связи с пользователем Forgejo' },
    ]);
  });

  it('роли — закрытый список проекта (v1 adminHelpers.PROJECT_ROLES)', () => {
    expect(PROJECT_ROLES).toContain('owner');
    expect(PROJECT_ROLES).toContain('reader');
  });
});

describe('модель · карточка на объёме (S7B-09)', () => {
  it('23 роли → группы по роли, больше — выше: owner · 20, reader · 3', () => {
    const p = parseRoleMatrix(MATRIX).people[0];
    expect(groupByRole(p.cells).map(g => [g.role, g.projects.length])).toEqual([['owner', 20], ['reader', 3]]);
  });

  it('поиск по проекту — без учёта регистра, по подстроке', () => {
    const p = parseRoleMatrix(MATRIX).people[0];
    expect(filterProjects(p.cells, 'P2').map(c => c.project)).toEqual(['AIDA/p20', 'AIDA/p21', 'AIDA/p22', 'AIDA/p23']);
    expect(filterProjects(p.cells, '  ')).toHaveLength(23);
  });

  it('пачка: «сменить роль» и «снять» по отмеченным проектам', () => {
    expect(buildChanges(['a', 'b'], { kind: 'set', role: 'reader' })).toEqual([{ project: 'a', role: 'reader' }, { project: 'b', role: 'reader' }]);
    expect(buildChanges(['a'], { kind: 'remove' })).toEqual([{ project: 'a', action: 'remove' }]);
  });
});

describe('модель · опасное действие (S7B-03)', () => {
  it('план → строки диффа: grant/remove/unchanged/update; update — «было → станет»', () => {
    const plan = parsePlan({ plan: [
      { project: 'a', before: null, after: 'owner', kind: 'grant', sign: '+', check: { state: 'checked', source: 'graph' } },
      { project: 'b', before: 'reader', after: null, kind: 'remove', sign: '−', check: { state: 'checked', source: 'graph' } },
      { project: 'c', before: 'owner', after: 'owner', kind: 'unchanged', sign: '=', check: { state: 'checked', source: 'graph' } },
      { project: 'd', before: 'reader', after: 'owner', kind: 'update', sign: '~', check: { state: 'checked', source: 'graph' } },
    ] });
    const rows = planToDiff(plan, { before: 'было', none: 'нет роли' });
    expect(rows.map(r => [r.id, r.kind, r.check.state])).toEqual([
      ['a', 'add', 'checked'], ['b', 'remove', 'checked'], ['c', 'same', 'checked'], ['d', 'add', 'checked'],
    ]);
    expect(rows[3].text).toContain('owner');
    expect(rows[3].detail).toContain('reader');
  });

  it('проверка строки: unavailable/forbidden — не «проверено»; нет check — тоже не проверено', () => {
    const plan = parsePlan({ plan: [
      { project: 'a', before: null, after: 'owner', kind: 'grant', check: { state: 'unavailable', source: 'kc' } },
      { project: 'b', before: null, after: 'owner', kind: 'grant', check: { state: 'forbidden', source: 'forgejo' } },
      { project: 'c', before: null, after: 'owner', kind: 'grant' },
    ] });
    expect(planToDiff(plan, { before: 'было', none: 'нет роли' }).map(r => r.check.state)).toEqual(['unverified', 'forbidden', 'unverified']);
  });

  it('ответ применения: id пачки, сколько применилось из скольких, отказы с причиной, срок отмены', () => {
    const r = parseApply({
      batch_id: BATCH, applied: 1, failed: 1, atomic: false, undo: [{ project: 'a', action: 'remove' }],
      undo_until: '2026-11-10T09:46:14Z',
      items: [
        { project: 'a', kind: 'grant', status: 200, result: 'applied' },
        { project: 'b', kind: 'remove', status: 409, result: 'failed', error: { error: 'ROLE_REMOVAL_BLOCKED', detail: 'последний owner' } },
        { project: 'c', kind: 'unchanged', result: 'unchanged' },
      ],
    });
    expect(r.batch.id).toBe(BATCH);
    expect([r.batch.applied, r.batch.total]).toEqual([1, 2]);
    expect(r.batch.failed).toEqual([{ id: 'b', text: 'b', reason: 'ROLE_REMOVAL_BLOCKED: последний owner' }]);
    expect(r.batch.undoUntil).toBe('2026-11-10T09:46:14Z');
    expect(r.undo).toEqual([{ project: 'a', action: 'remove' }]);
  });

  it('undo_until "null" (литерал сервера) — отмену не обещаем', () => {
    expect(parseApply({ batch_id: BATCH, applied: 0, items: [], undo_until: 'null' }).batch.undoUntil).toBeNull();
  });

  it('подтверждение — точный логин человека, не «ОК» и не пустая строка', () => {
    expect(isConfirmed('omiloreadmin', 'omiloreadmin')).toBe(true);
    expect(isConfirmed(' omiloreadmin ', 'omiloreadmin')).toBe(true);
    expect(isConfirmed('ok', 'omiloreadmin')).toBe(false);
    expect(isConfirmed('', '')).toBe(false);
  });
});

// ── экран ─────────────────────────────────────────────────────────────────

describe('экран · честные состояния', () => {
  it('человек не выбран — список людей с числом проектов, выбор уходит в адрес', async () => {
    const { f } = fake();
    mount(f);
    const btn = await screen.findByTestId('adm-roles-person-u-owner');
    expect(btn.textContent).toContain('23');
    fireEvent.click(btn);
    expect(new URLSearchParams(window.location.search).get('adm-person')).toBe('u-owner');
  });

  it('403 на матрице — «нет прав», не «людей нет»', async () => {
    mount(fake({ matrix: { error: 'FORBIDDEN' }, matrixStatus: 403 }).f);
    expect(await screen.findByText(/нет прав/i)).toBeTruthy();
    expect(screen.queryByTestId('adm-roles-empty')).toBeNull();
  });

  it('человек из адреса не найден в матрице — сказано словами', async () => {
    at('adm-person=u-gone');
    mount(fake().f);
    expect(await screen.findByTestId('adm-roles-notfound')).toBeTruthy();
  });
});

describe('экран · карточка на 23 ролях (S7B-09)', () => {
  it('группы по роли, свёрнуты, ни одной кнопки «Снять» в строке', async () => {
    at('adm-person=u-owner');
    mount(fake().f);
    const owner = await screen.findByTestId('adm-roles-group-owner');
    const reader = screen.getByTestId('adm-roles-group-reader');
    expect(owner.textContent).toContain('20');
    expect(reader.textContent).toContain('3');
    expect((owner as HTMLDetailsElement).open).toBe(false);
    expect((reader as HTMLDetailsElement).open).toBe(false);
    const card = screen.getByTestId('adm-roles-card');
    expect(within(card).queryAllByRole('button', { name: /^Снять/ })).toHaveLength(1); // одна — на панели
    expect(screen.getAllByTestId(/^adm-roles-row-/)).toHaveLength(23);
  });

  it('поиск сужает строки и живёт в адресе', async () => {
    at('adm-person=u-owner');
    mount(fake().f);
    const input = await screen.findByTestId('adm-roles-search');
    fireEvent.change(input, { target: { value: 'p2' } });
    // Поиск живёт в адресе (useUrlParam): строки сужаются после обновления состояния, не синхронно.
    await waitFor(() => expect(screen.getAllByTestId(/^adm-roles-row-/)).toHaveLength(4));
    expect(new URLSearchParams(window.location.search).get('adm-q')).toBe('p2');
  });

  it('мультивыбор в адресе; «выбрать все» → «Сменить роль» → ОДИН дифф на 23, без записи', async () => {
    at('adm-person=u-owner');
    const fk = fake();
    mount(fk.f);
    fireEvent.click(await screen.findByTestId('adm-roles-selectall'));
    // Выбор живёт в адресе (useUrlParam) и применяется после обновления состояния, не синхронно (та же гонка, что #1127).
    await waitFor(() => expect(screen.getByTestId('adm-roles-selected').textContent).toContain('23'));
    expect(new URLSearchParams(window.location.search).get('adm-sel')?.split(',')).toHaveLength(23);
    fireEvent.change(screen.getByTestId('adm-roles-setrole'), { target: { value: 'reader' } });
    fireEvent.click(screen.getByTestId('adm-roles-apply-set'));
    await screen.findByTestId('kit-diff-row-AIDA/p01');
    expect(fk.dry()).toHaveLength(1);
    expect((fk.dry()[0].body!.changes as Change[])).toHaveLength(23);
    expect(fk.writes()).toHaveLength(0);
    // 20 owner → reader меняются, 3 reader уже такие
    expect(screen.getByTestId('kit-diff-row-AIDA/p01').getAttribute('data-kind')).toBe('add');
    expect(screen.getByTestId('kit-diff-row-AIDA/p23').getAttribute('data-kind')).toBe('same');
  });
});

describe('экран · опасное действие (S7B-03)', () => {
  async function toDiff(fk: ReturnType<typeof fake>, op: 'set' | 'remove' = 'remove') {
    at('adm-person=u-owner&adm-sel=AIDA/p01,AIDA/p02');
    mount(fk.f);
    if (op === 'set') {
      fireEvent.change(await screen.findByTestId('adm-roles-setrole'), { target: { value: 'reader' } });
      fireEvent.click(screen.getByTestId('adm-roles-apply-set'));
    } else {
      fireEvent.click(await screen.findByTestId('adm-roles-apply-remove'));
    }
    await screen.findByTestId('kit-diff-apply');
  }

  it('без ввода логина применить нельзя: кнопка занята, записи нет', async () => {
    const fk = fake();
    await toDiff(fk);
    const apply = screen.getByTestId('kit-diff-apply');
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(apply);
    expect(fk.writes()).toHaveLength(0);
    fireEvent.change(screen.getByTestId('adm-danger-confirm'), { target: { value: 'ok' } });
    fireEvent.click(apply);
    expect(fk.writes()).toHaveLength(0);
  });

  it('логин введён → одна пачка; «Отменить» и ссылка на запись в журнале', async () => {
    const fk = fake();
    await toDiff(fk);
    fireEvent.change(screen.getByTestId('adm-danger-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    expect(await screen.findByTestId('kit-batch-summary')).toBeTruthy();
    expect(fk.writes()).toHaveLength(1);
    expect(fk.writes()[0].body!.changes).toEqual([{ project: 'AIDA/p01', action: 'remove' }, { project: 'AIDA/p02', action: 'remove' }]);
    expect(screen.getByTestId('kit-batch').getAttribute('data-outcome')).toBe('applied');
    expect(screen.getByTestId('kit-batch-undo')).toBeTruthy();
    const link = screen.getByTestId('adm-danger-journal');
    fireEvent.click(link);
    const qs = new URLSearchParams(window.location.search);
    expect(qs.get('adm')).toBe('log');
    expect(qs.get('adm-batch')).toBe(BATCH);
  });

  it('«Отменить» — вся пачка одним вызовом: changes=undo, undo_of=batch_id', async () => {
    const fk = fake();
    await toDiff(fk);
    fireEvent.change(screen.getByTestId('adm-danger-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    fireEvent.click(await screen.findByTestId('kit-batch-undo'));
    expect(await screen.findByTestId('kit-batch-undone')).toBeTruthy();
    const undo = fk.writes()[1].body!;
    expect(undo.undo_of).toBe(BATCH);
    expect(undo.changes).toEqual([{ project: 'AIDA/p01', role: 'owner' }, { project: 'AIDA/p02', role: 'owner' }]);
  });

  it('отмена вне окна — слова сервера, а не «отменено»', async () => {
    const fk = fake({ undoStatus: 400 });
    await toDiff(fk);
    fireEvent.change(screen.getByTestId('adm-danger-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    fireEvent.click(await screen.findByTestId('kit-batch-undo'));
    expect((await screen.findByTestId('kit-batch-undofail')).textContent).toContain('окно отмены');
    expect(screen.queryByTestId('kit-batch-undone')).toBeNull();
  });

  it('частичный отказ — «применилось 1 из 2» и причина у отказавшего проекта', async () => {
    const fk = fake({ failOn: ['AIDA/p02'] });
    await toDiff(fk);
    fireEvent.change(screen.getByTestId('adm-danger-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('kit-batch-summary');
    expect(screen.getByTestId('kit-batch').getAttribute('data-outcome')).toBe('partial');
    expect(screen.getByTestId('kit-batch-failed').textContent).toContain('последний owner');
  });

  it('403 на предпросмотре — «нет прав», а не пустой дифф', async () => {
    at('adm-person=u-owner&adm-sel=AIDA/p01');
    mount(fake({ dryStatus: 403 }).f);
    fireEvent.click(await screen.findByTestId('adm-roles-apply-remove'));
    expect(await screen.findByTestId('adm-danger-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('kit-diff-nothing')).toBeNull();
  });

  it('«Отказаться» закрывает дифф, ничего не записав', async () => {
    const fk = fake();
    await toDiff(fk, 'set');
    fireEvent.click(screen.getByTestId('adm-danger-cancel'));
    await waitFor(() => expect(screen.queryByTestId('kit-diff-apply')).toBeNull());
    expect(fk.writes()).toHaveLength(0);
  });
});

describe('экран · матрица ролей человека (S7B-05)', () => {
  it('вид «матрица» — в адресе; ячейка у проекта без роли — «значения нет», а не пусто', async () => {
    at('adm-person=u-fro&adm-view=matrix');
    mount(fake().f);
    const has = await screen.findByTestId('kit-matrix-cell-u-fro-AIDA/p01');
    expect(has.getAttribute('data-state')).toBe('value');
    expect(screen.getByTestId('kit-matrix-cell-u-fro-AIDA/p02').getAttribute('data-state')).toBe('none');
  });

  it('«задать всей строке» → дифф на все проекты матрицы тем же путём подтверждения', async () => {
    at('adm-person=u-fro&adm-view=matrix');
    const fk = fake();
    mount(fk.f);
    fireEvent.click(await screen.findByTestId('kit-matrix-rowset-u-fro'));
    fireEvent.click(screen.getByTestId('kit-matrix-opt-owner'));
    await screen.findByTestId('kit-diff-apply');
    expect((fk.dry()[0].body!.changes as Change[])).toHaveLength(23);
    expect(screen.getByTestId('adm-danger-confirm')).toBeTruthy();
    expect(fk.writes()).toHaveLength(0);
  });

  it('источник не назван (нет sources_asked) — ячейки «не смогли проверить», правка их пропускает', async () => {
    at('adm-person=u-fro&adm-view=matrix');
    const old = { rows: MATRIX.rows.map(r => ({ kc_sub: r.kc_sub, display_name: r.display_name, projects: r.projects, roles: r.roles })) };
    mount(fake({ matrix: old }).f);
    expect((await screen.findByTestId('kit-matrix-cell-u-fro-AIDA/p01')).getAttribute('data-state')).toBe('unverified');
  });
});
