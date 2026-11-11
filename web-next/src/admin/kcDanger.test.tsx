// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-03 — опасные действия Keycloak тем же путём, что «Роли»:
// дифф (dry_run) → ввод подтверждения → применение → «Отменить» в окне → журнал AO-01.
//
// Сервер (LoreKcResource + KcDanger):
//   POST /lore/kc/user/{id}/role {role, action add|remove, dry_run?, undo_of?}
//     • dry_run → {user_id, dry_run:true, plan:[{role, before, after, kind grant|remove|unchanged,
//       sign, check{state checked|unavailable, source}}]};
//     • применение → {user_id, op_id kr-…, action added|removed, undo{role, action}|null, undo_until};
//     • отмена — тот же вызов с undo и undo_of=op_id; вне окна — 400.
//   POST /lore/kc/agent/{id}/rotate {dry_run?}
//     • dry_run → {client_id, id, plan:[{… kind rotate, sign ~}], undoable:false, undo_reason};
//     • применение → {client_id, secret, undoable:false, undo_reason}.
//
// Правила:
//   • ничего не применяется без ввода подтверждения (логин человека / clientId агента);
//   • выдача realm-роли отменяется в окне; ротация НЕ отменяется — это сказано ДО
//     применения и после, словами «отменить нельзя, можно только выпустить новый»;
//   • секрет — kit SecretOnce: за предупреждением, не в адресе и не в хранилище;
//   • 403 / 503 (KC не подключён) / сбой — разными словами;
//   • выбор роли — в адресе (adm-realm).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { RealmRoleDanger, RealmRolePanel, RotateDanger } from './KcDanger';
import { parseRealmApply, parseRealmPlan, parseRotation, parseRotationPlan } from './kc';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* нет хранилища */ }
});

const OP = 'kr-1762855200000-ab12cd34';
const SECRET = 's3cr3t-XYZ-0001';
const NOT_UNDOABLE = 'Keycloak делает старый секрет недействительным сразу; LORE его не хранит — отменить ротацию нельзя, можно только выпустить новый секрет.';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts { held?: string[]; dryStatus?: number; dryBody?: unknown; undoStatus?: number; rotateStatus?: number }

function fake(opts: FakeOpts = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const held = new Set(opts.held ?? ['viewer']);
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url === '/lore/kc/realm-roles') {
      return json([{ name: 'admin', grantable: true }, { name: 'viewer', grantable: true }, { name: 'super-admin', grantable: false }]);
    }
    const m = /^\/lore\/kc\/user\/([^/]+)\/role$/.exec(url);
    if (m && body) {
      const role = String(body.role);
      const remove = body.action === 'remove';
      const before = held.has(role);
      const kind = remove ? (before ? 'remove' : 'unchanged') : (before ? 'unchanged' : 'grant');
      const plan = [{ role, before, after: !remove, kind, sign: kind === 'grant' ? '+' : kind === 'remove' ? '−' : '=',
        check: { state: 'checked', source: 'keycloak' } }];
      if (body.dry_run) {
        if (opts.dryStatus) return json(opts.dryBody ?? { error: 'FORBIDDEN', detail: 'нужна роль admin' }, opts.dryStatus);
        return json({ user_id: m[1], ok: true, dry_run: true, plan });
      }
      if (body.undo_of && opts.undoStatus) return json({ error: 'BAD_PARAMS', detail: 'undo_of: окно отмены закрыто' }, opts.undoStatus);
      return json({
        user_id: m[1], op_id: body.undo_of ? 'kr-1762855299000-00000001' : OP, ok: true, role,
        action: remove ? 'removed' : 'added',
        undo: kind === 'unchanged' ? null : { role, action: remove ? 'add' : 'remove' },
        undo_until: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(body.undo_of ? { undo_of: body.undo_of } : {}),
      });
    }
    const r = /^\/lore\/kc\/agent\/([^/]+)\/rotate$/.exec(url);
    if (r) {
      if (opts.rotateStatus) return json({ error: 'KC_NOT_CONFIGURED', detail: 'kc integration not configured' }, opts.rotateStatus);
      if (body?.dry_run) {
        return json({ client_id: 'lore-mcp-full_pc1', id: 'c-uuid', ok: true, dry_run: true, undoable: false, undo_reason: NOT_UNDOABLE,
          plan: [{ client_id: 'lore-mcp-full_pc1', kind: 'rotate', sign: '~', check: { state: 'checked', source: 'keycloak' } }] });
      }
      return json({ client_id: 'lore-mcp-full_pc1', ok: true, rotated: true, secret: SECRET, undoable: false, undo_reason: NOT_UNDOABLE });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }) as unknown as typeof fetch;
  const writes = (re: RegExp) => calls.filter(c => re.test(c.url) && !c.body?.dry_run);
  return { f, calls, writes };
}

const wrap = (ui: React.ReactElement) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);

// ── модель ────────────────────────────────────────────────────────────────

describe('модель · realm-роль', () => {
  it('план → строки диффа: grant → add, remove → remove, unchanged → same; проверка — у сервера', () => {
    const rows = parseRealmPlan({ plan: [
      { role: 'admin', before: false, after: true, kind: 'grant', check: { state: 'checked', source: 'keycloak' } },
      { role: 'viewer', before: true, after: false, kind: 'remove', check: { state: 'checked', source: 'keycloak' } },
      { role: 'x', before: true, after: true, kind: 'unchanged', check: { state: 'checked', source: 'keycloak' } },
      { role: 'y', before: null, after: true, kind: 'grant', check: { state: 'unavailable', source: 'роли не прочитались' } },
    ] });
    expect(rows.map(r => [r.id, r.kind, r.check.state])).toEqual([
      ['admin', 'add', 'checked'], ['viewer', 'remove', 'checked'], ['x', 'same', 'checked'], ['y', 'add', 'unverified'],
    ]);
  });

  it('применение → пачка из одного действия с окном отмены и обратным вызовом', () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    const a = parseRealmApply({ user_id: 'u', op_id: OP, action: 'added', undo: { role: 'admin', action: 'remove' }, undo_until: until });
    expect(a.batch).toEqual({ id: OP, applied: 1, total: 1, failed: [], undoUntil: until });
    expect(a.undo).toEqual({ role: 'admin', action: 'remove' });
    expect(parseRealmApply({ op_id: OP, undo: null, undo_until: until }).batch.undoUntil).toBeNull();
  });
});

describe('модель · ротация секрета', () => {
  it('дифф ротации: «сменится», отменить нельзя — со словами сервера', () => {
    const p = parseRotationPlan({ client_id: 'c', id: 'uuid', undoable: false, undo_reason: NOT_UNDOABLE,
      plan: [{ client_id: 'c', kind: 'rotate', sign: '~', check: { state: 'checked', source: 'keycloak' } }] });
    expect(p.clientId).toBe('c');
    expect(p.undoable).toBe(false);
    expect(p.undoReason).toBe(NOT_UNDOABLE);
    expect(p.rows.map(r => [r.id, r.kind, r.check.state])).toEqual([['c', 'add', 'checked']]);
  });

  it('сервер не сказал undoable — всё равно «нельзя»: обратимость не выдумываем', () => {
    expect(parseRotationPlan({ client_id: 'c', plan: [] }).undoable).toBe(false);
  });

  it('ответ ротации: секрет или null; пустой секрет — не «успех»', () => {
    expect(parseRotation({ client_id: 'c', secret: SECRET }).secret).toBe(SECRET);
    expect(parseRotation({ client_id: 'c', secret: '' }).secret).toBeNull();
    expect(parseRotation({}).secret).toBeNull();
  });
});

// ── выдача realm admin ────────────────────────────────────────────────────

describe('экран · выдача realm-роли', () => {
  const person = { kc_sub: 'u-fro', name: 'frolova' };

  it('дифф с сервера, без ввода логина ничего не применяется', async () => {
    const { f, calls, writes } = fake();
    wrap(<RealmRoleDanger person={person} role="admin" action="add" fetchImpl={f} onClose={() => {}} />);
    await screen.findByTestId('kit-diff-row-admin');
    expect(calls[0]).toEqual({ url: '/lore/kc/user/u-fro/role', body: { role: 'admin', action: 'add', dry_run: true } });
    expect(screen.getByTestId('kit-diff-row-admin').getAttribute('data-kind')).toBe('add');
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'fro' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    expect(writes(/\/role$/)).toHaveLength(0);
  });

  it('логин введён → применение → «Отменить» обратным вызовом с undo_of → ссылка в журнал', async () => {
    const { f, writes } = fake();
    const changed = vi.fn();
    wrap(<RealmRoleDanger person={person} role="admin" action="add" fetchImpl={f} onClose={() => {}} onChanged={changed} />);
    await screen.findByTestId('kit-diff-row-admin');
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'frolova' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('kit-batch');
    expect(writes(/\/role$/)[0].body).toEqual({ role: 'admin', action: 'add' });
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('kit-batch-undo'));
    await screen.findByTestId('kit-batch-undone');
    expect(writes(/\/role$/)[1].body).toEqual({ role: 'admin', action: 'remove', undo_of: OP });
    fireEvent.click(screen.getByTestId('adm-kc-journal'));
    await waitFor(() => {
      const q = new URLSearchParams(window.location.search);
      expect(q.get('adm')).toBe('log');
      expect(q.get('adm-family')).toBe('kc');
    });
  });

  it('отмена вне окна — словами сервера', async () => {
    const { f } = fake({ undoStatus: 400 });
    wrap(<RealmRoleDanger person={person} role="admin" action="add" fetchImpl={f} onClose={() => {}} />);
    await screen.findByTestId('kit-diff-row-admin');
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'frolova' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    fireEvent.click(await screen.findByTestId('kit-batch-undo'));
    expect((await screen.findByTestId('kit-batch-undofail')).textContent).toContain('окно отмены закрыто');
  });

  it('403 на диффе — «нет права», 503 — «Keycloak не подключён»: разные слова', async () => {
    const a = fake({ dryStatus: 403 });
    const v1 = wrap(<RealmRoleDanger person={person} role="admin" action="add" fetchImpl={a.f} onClose={() => {}} />);
    await screen.findByTestId('adm-kc-forbidden');
    v1.unmount();
    const b = fake({ dryStatus: 503, dryBody: { error: 'KC_NOT_CONFIGURED', detail: 'kc integration not configured' } });
    wrap(<RealmRoleDanger person={person} role="admin" action="add" fetchImpl={b.f} onClose={() => {}} />);
    expect((await screen.findByTestId('adm-kc-unavailable')).textContent).toContain('kc integration not configured');
  });

  it('панель: роли из Keycloak, выбор — в адресе, super-admin не выдаётся, «Выдать» открывает дифф', async () => {
    const { f } = fake();
    wrap(<RealmRolePanel person={person} fetchImpl={f} />);
    const pick = await screen.findByTestId('adm-realm-pick') as HTMLSelectElement;
    expect([...pick.options].map(o => o.value)).toEqual(['', 'admin', 'viewer']);
    fireEvent.change(pick, { target: { value: 'admin' } });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('adm-realm')).toBe('admin'));
    fireEvent.click(screen.getByTestId('adm-realm-grant'));
    await screen.findByTestId('kit-diff-row-admin');
  });
});

// ── ротация секрета агента ────────────────────────────────────────────────

describe('экран · ротация секрета', () => {
  it('до применения: дифф и «отменить нельзя, можно только выпустить новый»; подтверждение — clientId', async () => {
    const { f, calls, writes } = fake();
    wrap(<RotateDanger clientId="lore-mcp-full_pc1" fetchImpl={f} onClose={() => {}} />);
    await screen.findByTestId('kit-diff-row-lore-mcp-full_pc1');
    expect(calls[0]).toEqual({ url: '/lore/kc/agent/lore-mcp-full_pc1/rotate', body: { dry_run: true } });
    expect(screen.getByTestId('adm-rotate-noundo').textContent).toContain('отменить ротацию нельзя');
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'lore-mcp' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    expect(writes(/rotate$/)).toHaveLength(0);
  });

  it('после применения: секрет — за предупреждением SecretOnce, «Отменить» нет, секрет не в адресе и не в хранилище', async () => {
    const { f, writes } = fake();
    wrap(<RotateDanger clientId="lore-mcp-full_pc1" fetchImpl={f} onClose={() => {}} />);
    await screen.findByTestId('kit-diff-row-lore-mcp-full_pc1');
    fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: 'lore-mcp-full_pc1' } });
    fireEvent.click(screen.getByTestId('kit-diff-apply'));
    await screen.findByTestId('kit-secret-warn');
    expect(writes(/rotate$/)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
    expect(screen.getByTestId('adm-rotate-done-noundo').textContent).toContain('можно только выпустить новый');
    fireEvent.click(screen.getByTestId('kit-secret-reveal'));
    expect(screen.getByTestId('kit-secret-value').textContent).toBe(SECRET);
    expect(window.location.href).not.toContain(SECRET);
    const stored = [window.localStorage, window.sessionStorage]
      .flatMap(s => Array.from({ length: s.length }, (_, i) => s.getItem(s.key(i) ?? '') ?? ''));
    expect(stored.join('|')).not.toContain(SECRET);
  });

  it('Keycloak не подключён — названо словами, а не пустой экран', async () => {
    const { f } = fake({ rotateStatus: 503 });
    wrap(<RotateDanger clientId="lore-mcp-full_pc1" fetchImpl={f} onClose={() => {}} />);
    expect((await screen.findByTestId('adm-kc-unavailable')).textContent).toContain('kc integration not configured');
  });
});
