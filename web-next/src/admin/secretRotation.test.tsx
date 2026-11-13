// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-19 — UC-6 «смена секрета агента без простоя».
//
// Сервер (LoreKcResource + KcSecretRotation):
//   POST /lore/kc/agent/{id}/rotate {dry_run?}
//     • dry_run → … + old_secret: 'kept' (политика ротации у клиента видна) | 'unknown';
//     • применение → {client_id, secret, old_secret_kept: true|false|null, old_secret_expires_at, old_secret_note}.
//   GET  /lore/kc/agent/{id}/secret → {client_id, old_secret_active, rotated_at, old_secret_expires_at,
//        switched:{seen, at?, machine_id?, reason?}} — значений секретов нет.
//   POST /lore/kc/agent/{id}/rotated/revoke {dry_run?} → дифф «отозвать прежний»; до перехода — forbidden и 409.
//
// Правила UC-6:
//   • у клиента два секрета: новый показывается ОДИН раз (kit SecretOnce), прежний действует до срока;
//   • «перешёл?» — начиналась ли сессия агента после ротации;
//   • «Отозвать прежний» доступен только после вызова с новым;
//   • секрет — только через переменную окружения: в адресе, команде и хранилище его нет;
//   • KC без политики ротации — сказано ДО применения, что прежний умрёт сразу (простой).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { OldSecretSwitch, RotateDanger, RotatePanel } from './KcDanger';
import { parseRotation, parseRotationPlan, parseSecretState } from './kc';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* нет хранилища */ }
});

const CID = 'lore-mcp-full_nb';
const SECRET = 'n3w-s3cr3t-0002';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// secretDelayMs: ответ GET …/secret приходит позже — карточка «Прежний секрет» уже нарисована
// со скелетоном. Так гонка «findBy контейнера → getBy содержимого» воспроизводится детерминированно
// (SPRINT_UXR_S11_TEST_OPT/S11-SECRET-ROTATION-RACE: develop eb991e41 падал на CI именно так).
interface FakeOpts { policy?: boolean; switched?: boolean; oldActive?: boolean; secretDelayMs?: number }

function fake(opts: FakeOpts = {}) {
  const policy = opts.policy ?? true;
  let switched = opts.switched ?? false;
  let oldActive = opts.oldActive ?? policy;
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === `/lore/kc/agent/${CID}/rotate`) {
      if (body?.dry_run) {
        return json({ client_id: CID, id: 'c-uuid', ok: true, dry_run: true, undoable: false, undo_reason: 'нельзя',
          old_secret: policy ? 'kept' : 'unknown',
          plan: [{ client_id: CID, kind: 'rotate', sign: '~', check: { state: 'checked', source: 'keycloak' } }] });
      }
      return json({ client_id: CID, ok: true, rotated: true, secret: SECRET, undoable: false, undo_reason: 'нельзя',
        old_secret_kept: policy, rotated_at: '2026-11-11T20:00:00Z',
        old_secret_expires_at: policy ? '2026-11-13T20:00:00Z' : null,
        old_secret_note: policy ? 'прежний секрет действует до 2026-11-13T20:00:00Z' : 'Keycloak не оставил прежний секрет: нет политики secret-rotation' });
    }
    if (url === `/lore/kc/agent/${CID}/secret`) {
      if (opts.secretDelayMs) await new Promise(r => setTimeout(r, opts.secretDelayMs));
      return json({ client_id: CID, id: 'c-uuid', old_secret_active: oldActive, rotated_at: '2026-11-11T20:00:00Z',
        old_secret_expires_at: '2026-11-13T20:00:00Z', rotation_policy: policy,
        switched: switched
          ? { seen: true, at: '2026-11-11T20:05:00Z', machine_id: 'nb', session_id: 's-new', how: 'session' }
          : { seen: false, reason: 'после ротации агент ещё не начинал новой сессии' } });
    }
    if (url === `/lore/kc/agent/${CID}/rotated/revoke`) {
      const plan = [{ client_id: CID, kind: oldActive ? 'revoke-old' : 'unchanged', sign: '−',
        check: switched ? { state: 'checked', source: 'keycloak' } : { state: 'forbidden', source: 'только после вызова с новым' } }];
      if (body?.dry_run) return json({ client_id: CID, ok: true, dry_run: true, undoable: false, plan });
      if (!switched) return json({ error: 'OLD_SECRET_REVOKE_BLOCKED', detail: 'только после вызова с новым' }, 409);
      oldActive = false;
      return json({ client_id: CID, ok: true, revoked: true, undoable: false });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls, setSwitched: (v: boolean) => { switched = v; } };
}

const wrap = (ui: React.ReactElement) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);

async function rotate(f: typeof fetch) {
  wrap(<RotateDanger clientId={CID} fetchImpl={f} onClose={() => {}} />);
  await screen.findByTestId(`kit-diff-row-${CID}`);
  fireEvent.change(screen.getByTestId('kit-diff-confirm'), { target: { value: CID } });
  fireEvent.click(screen.getByTestId('kit-diff-apply'));
  await screen.findByTestId('kit-secret-warn');
}

describe('модель · два секрета', () => {
  it('дифф ротации несёт ожидание: прежний останется (kept) или, скорее всего, умрёт сразу (unknown)', () => {
    expect(parseRotationPlan({ client_id: 'c', old_secret: 'kept', plan: [] }).oldSecret).toBe('kept');
    expect(parseRotationPlan({ client_id: 'c', old_secret: 'unknown', plan: [] }).oldSecret).toBe('unknown');
    expect(parseRotationPlan({ client_id: 'c', plan: [] }).oldSecret).toBeNull();
  });

  it('итог ротации: сохранил ли KC прежний секрет; не сказал — null, а не «да»', () => {
    const r = parseRotation({ client_id: 'c', secret: SECRET, old_secret_kept: true, old_secret_expires_at: '2026-11-13T20:00:00Z' });
    expect(r.oldSecretKept).toBe(true);
    expect(r.oldSecretExpiresAt).toBe('2026-11-13T20:00:00Z');
    expect(parseRotation({ client_id: 'c', secret: SECRET }).oldSecretKept).toBeNull();
  });

  it('состояние секретов: «перешёл?» из ответа сервера, в разборе нет значений секретов', () => {
    const s = parseSecretState({ client_id: 'c', old_secret_active: true, rotated_at: 'a', old_secret_expires_at: 'b',
      switched: { seen: true, at: 'x', machine_id: 'nb' } });
    expect(s).toEqual({ clientId: 'c', oldSecretActive: true, rotatedAt: 'a', oldSecretExpiresAt: 'b',
      switched: { seen: true, at: 'x', machine: 'nb', reason: null } });
    expect(parseSecretState({}).oldSecretActive).toBeNull();
  });
});

describe('экран · ротация без простоя', () => {
  it('до применения: политика видна — сказано, что прежний секрет останется до срока', async () => {
    const { f } = fake({ policy: true });
    wrap(<RotateDanger clientId={CID} fetchImpl={f} onClose={() => {}} />);
    expect((await screen.findByTestId('adm-rotate-expect')).getAttribute('data-expect')).toBe('kept');
  });

  it('до применения: политики не видно — предупреждение о простое ДО ввода подтверждения', async () => {
    const { f } = fake({ policy: false });
    wrap(<RotateDanger clientId={CID} fetchImpl={f} onClose={() => {}} />);
    const note = await screen.findByTestId('adm-rotate-expect');
    expect(note.getAttribute('data-expect')).toBe('unknown');
    expect(note.textContent).toMatch(/сразу/);
  });

  it('после ротации с двумя секретами: новый — один раз, команда — через переменную окружения, блок «перешёл?»', async () => {
    const { f } = fake({ policy: true, secretDelayMs: 30 });
    await rotate(f);
    const env = screen.getByTestId('adm-rotate-env');
    expect(env.textContent).toContain('LORE_MCP_CLIENT_SECRET');
    expect(env.textContent).not.toContain(SECRET);
    const sw = await screen.findByTestId('adm-oldsecret');
    // карточка рисуется сразу со скелетоном — ждём само содержимое, а не контейнер
    expect((await within(sw).findByTestId('adm-oldsecret-expires')).textContent).toContain('2026-11-13');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('пока перехода нет — «Отозвать прежний» заблокирован, отзыв не уходит', async () => {
    const { f, calls } = fake({ policy: true, switched: false });
    await rotate(f);
    const sw = await screen.findByTestId('adm-oldsecret');
    await waitFor(() => expect(within(sw).getByTestId('adm-oldsecret-switched').getAttribute('data-seen')).toBe('false'));
    expect((within(sw).getByTestId('adm-oldsecret-revoke') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sw).getByTestId('adm-oldsecret-revoke'));
    expect(calls.some(c => c.url.endsWith('/rotated/revoke'))).toBe(false);
  });

  it('агент перешёл — «Проверить» видит сессию, отзыв прежнего: дифф → clientId → DELETE на сервере', async () => {
    const { f, calls, setSwitched } = fake({ policy: true, switched: false });
    await rotate(f);
    const sw = await screen.findByTestId('adm-oldsecret');
    await waitFor(() => expect(within(sw).getByTestId('adm-oldsecret-switched').getAttribute('data-seen')).toBe('false'));
    setSwitched(true);
    fireEvent.click(within(sw).getByTestId('adm-oldsecret-recheck'));
    await waitFor(() => expect(within(sw).getByTestId('adm-oldsecret-switched').getAttribute('data-seen')).toBe('true'));
    expect(within(sw).getByTestId('adm-oldsecret-switched').textContent).toContain('nb');
    fireEvent.click(within(sw).getByTestId('adm-oldsecret-revoke'));
    await within(sw).findByTestId(`kit-diff-row-${CID}`);
    fireEvent.change(within(sw).getByTestId('kit-diff-confirm'), { target: { value: CID } });
    fireEvent.click(within(sw).getByTestId('kit-diff-apply'));
    await within(sw).findByTestId('adm-oldsecret-revoked');
    const revokes = calls.filter(c => c.url.endsWith('/rotated/revoke')).map(c => c.body);
    expect(revokes).toEqual([{ dry_run: true }, {}]);
  });

  it('KC не оставил прежний секрет — словами сервера, блока «перешёл?» нет', async () => {
    const { f } = fake({ policy: false });
    await rotate(f);
    expect(screen.getByTestId('adm-rotate-olddead').textContent).toContain('secret-rotation');
    expect(screen.queryByTestId('adm-oldsecret')).toBeNull();
  });

  it('из карточки агента «Прежний секрет…» открывает тот же блок без новой ротации', async () => {
    const { f, calls } = fake({ policy: true, switched: true });
    wrap(<RotatePanel clientId={CID} fetchImpl={f} />);
    fireEvent.click(screen.getByTestId('adm-oldsecret-open'));
    const sw = await screen.findByTestId('adm-oldsecret');
    await waitFor(() => expect(within(sw).getByTestId('adm-oldsecret-switched').getAttribute('data-seen')).toBe('true'));
    expect(calls.some(c => c.url.endsWith('/rotate'))).toBe(false);
  });

  it('прежнего секрета нет — так и сказано, отзывать нечего', async () => {
    const { f } = fake({ policy: true, oldActive: false });
    wrap(<OldSecretSwitch clientId={CID} fetchImpl={f} />);
    expect(await screen.findByTestId('adm-oldsecret-none')).toBeTruthy();
    expect(screen.queryByTestId('adm-oldsecret-revoke')).toBeNull();
  });
});
