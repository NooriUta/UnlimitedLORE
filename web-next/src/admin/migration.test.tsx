// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — «Перенос на новую модель»: полоса этапов, группы расхождений,
// правило у строки (человек super-admin, подтверждение логином), счётчик «ждут решения» убывает,
// отмена последнего правила, честные состояния и честное «запуск с сервера пока не подключён».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { MigrationScreen } from './MigrationScreen';
import { parseMigration } from './migration';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/?mod=admin&sec=adm-migration'); });

const row = (value: string, n: number, decision: unknown = null, refs: unknown[] = []) =>
  ({ type: 'KnowSprint', field: 'priority', value, n, refs, decision });

const READY = {
  state: 'ready', login: 'omiloreadmin', at: '2026-11-19T10:00:00Z', source: 'migration_src_2026_11_15',
  stages: [
    { key: 'read', state: 'done', n: 632 }, { key: 'calc', state: 'attention', n: 6 },
    { key: 'merge', state: 'not_run', n: null }, { key: 'write', state: 'not_run', n: null }, { key: 'verify', state: 'not_run', n: null },
  ],
  groups: [
    { kind: 'reject', why: 'приоритет вне шкалы', n: 5, rest: 0, rows: [row('medium', 3, null, [{ type: 'sprint', id: 'SPRINT_A' }]), row('🟡 MEDIUM (позже)', 2)] },
    { kind: 'reject', why: 'статус вне справочника', n: 1, rest: 0, rows: [{ type: 'KnowPhaseHist', field: 'status_raw', value: '🚫 CANCELLED', n: 1, refs: [], decision: null }] },
    { kind: 'held', why: 'нет решения по полю', n: 408, rest: 0, rows: [{ type: 'KnowSprint', field: 'pr_refs', value: null, n: 408, refs: [], decision: null }] },
  ],
  waiting: 3, held_waiting: 1, decisions: [], journal: [], last: null,
};

const AFTER = {
  ...READY, waiting: 2, accepted: 'ST-01', undo_until: '2099-01-01T00:00:00Z',
  groups: [{ ...READY.groups[0], rows: [row('medium', 3, { id: 'ST-01', action: 'map_to', to: 'normal' }), row('🟡 MEDIUM (позже)', 2)] }, READY.groups[1], READY.groups[2]],
  last: { at: '2026-11-19T10:05:00Z', by: 'omiloreadmin', op: 'add', decision: { id: 'ST-01', action: 'map_to', to: 'normal' } },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fake(o: { get?: unknown; getStatus?: number; decide?: unknown; undo?: unknown; run?: { status: number; body: unknown } } = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === '/lore/admin/migration') {
      if (o.getStatus === 403) return json({ error: 'FORBIDDEN', detail: 'super-admin role required' }, 403);
      if (o.getStatus) return json({ error: 'REPORT_UNREADABLE', detail: 'отчёт прогона не прочитан' }, o.getStatus);
      return json(o.get ?? READY);
    }
    if (url === '/lore/admin/migration/decisions') return json(o.decide ?? AFTER);
    if (url === '/lore/admin/migration/decisions/undo') return json(o.undo ?? { ...READY, undone: 'ST-01' });
    if (url === '/lore/admin/migration/run') return json(o.run?.body ?? { error: 'RUN_NOT_CONNECTED', detail: 'запуск конвейера с сервера пока не подключён' }, o.run?.status ?? 501);
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><MigrationScreen fetchImpl={f} /></KitLangProvider>);

describe('модель', () => {
  it('разбор: состояние, этапы, группы, счётчики; мусор — пустые значения, а не падение', () => {
    const m = parseMigration(READY);
    expect(m.state).toBe('ready');
    expect(m.stages.map(s => s.key)).toEqual(['read', 'calc', 'merge', 'write', 'verify']);
    expect(m.groups[0].rows[0].refs).toEqual([{ type: 'sprint', id: 'SPRINT_A' }]);
    expect(m.waiting).toBe(3);
    expect(m.heldWaiting).toBe(1);
    const junk = parseMigration({ state: 'что-то' });
    expect(junk.state).toBe('unknown');
    expect(junk.groups).toEqual([]);
  });
});

describe('экран', () => {
  it('полоса этапов, счётчик «ждут решения», группы и строки со ссылкой на запись', async () => {
    mount(fake().f);
    expect((await screen.findByTestId('adm-mig-waiting')).textContent).toContain('3');
    const stages = screen.getAllByTestId('adm-mig-stage');
    expect(stages).toHaveLength(5);
    expect(stages[0].textContent).toContain('632');
    expect(screen.getByTestId('adm-mig-group-0').textContent).toContain('5');
    const rows = screen.getAllByTestId('adm-mig-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('medium')).toBeTruthy();
    expect(within(rows[0]).getByTestId('adm-mig-ref').getAttribute('href')).toContain('SPRINT_A');
  });

  it('правило у строки: выбор, окно с подтверждением своим логином, счётчик убывает, отмена последнего', async () => {
    const { f, calls } = fake();
    mount(f);
    const rows = await screen.findAllByTestId('adm-mig-row');
    fireEvent.change(within(rows[0]).getByTestId('adm-mig-action'), { target: { value: 'map_to' } });
    fireEvent.change(within(rows[0]).getByTestId('adm-mig-to'), { target: { value: 'normal' } });
    fireEvent.click(within(rows[0]).getByTestId('adm-mig-accept'));
    const btn = await screen.findByTestId('kit-diff-apply');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(calls.some(c => c.url === '/lore/admin/migration/decisions')).toBe(false);
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'omiloreadmin' } });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('adm-mig-waiting').textContent).toContain('2'));
    const sent = calls.find(c => c.url === '/lore/admin/migration/decisions')!;
    expect(sent.body).toEqual({ scope: { type: 'KnowSprint', field: 'priority', value: 'medium' }, action: 'map_to', to: 'normal', confirm_login: 'omiloreadmin' });
    expect(within(screen.getAllByTestId('adm-mig-row')[0]).getByText(/ST-01/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('kit-batch-undo'));
    await waitFor(() => expect(calls.some(c => c.url === '/lore/admin/migration/decisions/undo')).toBe(true));
    expect(calls.find(c => c.url === '/lore/admin/migration/decisions/undo')!.body).toEqual({ confirm_login: 'omiloreadmin' });
    await waitFor(() => expect(screen.getByTestId('adm-mig-waiting').textContent).toContain('3'));
  });

  it('свести к значению без значения — «Принять» заперта', async () => {
    mount(fake().f);
    const rows = await screen.findAllByTestId('adm-mig-row');
    fireEvent.change(within(rows[0]).getByTestId('adm-mig-action'), { target: { value: 'map_to' } });
    expect((within(rows[0]).getByTestId('adm-mig-accept') as HTMLButtonElement).disabled).toBe(true);
  });

  it('удержанные поля — счётом и подсказкой, без выбора правила', async () => {
    mount(fake().f);
    fireEvent.click(await screen.findByTestId('adm-mig-group-2'));
    const held = await screen.findByTestId('adm-mig-held');
    expect(held.textContent).toContain('pr_refs');
    expect(held.textContent).toContain('408');
    expect(screen.queryByTestId('adm-mig-action')).toBeNull();
  });

  it('человека нет (агент) — сказано словами, выбора правила нет', async () => {
    mount(fake({ get: { ...READY, login: null } }).f);
    expect((await screen.findByTestId('adm-mig-human')).textContent).toContain('только человек');
    expect(screen.queryByTestId('adm-mig-action')).toBeNull();
  });

  it('«Перепроверить» и «Пробный перенос» — честное «запуск с сервера пока не подключён»', async () => {
    const { f, calls } = fake();
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-mig-run-recheck'));
    expect((await screen.findByTestId('adm-mig-run-note')).textContent).toContain('пока не подключён');
    fireEvent.click(screen.getByTestId('adm-mig-run-trial'));
    await waitFor(() => expect(calls.filter(c => c.url === '/lore/admin/migration/run').map(c => c.body?.what)).toEqual(['recheck', 'trial']));
  });

  it('три состояния разные: прогона не было, источник недоступен, сверка не сошлась', async () => {
    const a = mount(fake({ get: { state: 'no_run', reason: 'no_report', login: 'omiloreadmin' } }).f);
    expect(await screen.findByTestId('adm-mig-norun')).toBeTruthy();
    expect(screen.queryByTestId('adm-mig-source')).toBeNull();
    a.unmount();
    const b = mount(fake({ get: { ...READY, state: 'source_unavailable', unread: ['KnowTask'] } }).f);
    expect((await screen.findByTestId('adm-mig-source')).textContent).toContain('KnowTask');
    expect(screen.queryByTestId('adm-mig-norun')).toBeNull();
    b.unmount();
    mount(fake({ get: { ...READY, state: 'verify_failed', stages: [...READY.stages.slice(0, 4), { key: 'verify', state: 'failed', n: null }] } }).f);
    expect(await screen.findByTestId('adm-mig-verify-failed')).toBeTruthy();
    expect(screen.getAllByTestId('adm-mig-row')).toHaveLength(2);
  });

  it('не super-admin — запрет; сбой сервера — ошибка с повтором, не «пусто»', async () => {
    const a = mount(fake({ getStatus: 403 }).f);
    expect(await screen.findByText(/super-admin/)).toBeTruthy();
    a.unmount();
    mount(fake({ getStatus: 502 }).f);
    expect(await screen.findByRole('button', { name: /Повторить|Retry/ })).toBeTruthy();
    expect(screen.queryByTestId('adm-mig-norun')).toBeNull();
  });
});
