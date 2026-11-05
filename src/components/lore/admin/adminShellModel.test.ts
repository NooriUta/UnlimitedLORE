import { describe, expect, it } from 'vitest';
import { ALL_TABS, NAV_GROUPS } from './adminTabs';
import {
  kcCounter, readiness, readinessCounter, sliceCounter, systemChips, whereAmI, whereAmILine,
} from './adminShellModel';
import type { Preflight } from './types';

// AH-05 (прототип admin-v2, одобрен 04.11.2026): чистая логика оболочки —
// «где я» на телефоне, честные счётчики навигации и полоса состояния системы.
// Правило всех трёх: «не смогли проверить» ≠ «пусто» ≠ «всё хорошо».

const PF_OK: Preflight = {
  auth_enabled: true, kc_configured: true, kc_reachable: true, kc_error: '',
  admin_count: 2, agent_scope_enforced: true, can_enable_auth: true, hint: '',
};

describe('где я (телефон): группа › вкладка · N/9', () => {
  it('каждая вкладка знает свою группу, цвет группы и позицию среди 9', () => {
    expect(ALL_TABS).toHaveLength(9);
    ALL_TABS.forEach((k, i) => {
      const w = whereAmI(k);
      const g = NAV_GROUPS.find(x => x.tabs.some(([t]) => t === k))!;
      expect(w.pos).toBe(i + 1);
      expect(w.total).toBe(9);
      expect(w.group).toBe(g.label);
      expect(w.color).toBe(g.rail);
    });
  });

  it('строка — «группа › вкладка · N/9»', () => {
    expect(whereAmILine(whereAmI('users'))).toBe('Доступ › Люди · 1/9');
    expect(whereAmILine(whereAmI('claudeRules'))).toBe('Справочники › Правила CLAUDE · 7/9');
    expect(whereAmILine(whereAmI('quick'))).toBe('Система › Быстрые команды · 9/9');
  });

  it('у каждой группы есть подпись риска', () => {
    for (const g of NAV_GROUPS) expect(g.risk.length, g.label).toBeGreaterThan(0);
  });
});

describe('счётчик в навигации: число, «?» с причиной или красный', () => {
  it('KC ответил — число, в том числе честный 0', () => {
    expect(kcCounter({ k: 'ok', rows: [1, 2, 3] })).toEqual({ kind: 'n', n: 3 });
    expect(kcCounter({ k: 'ok', rows: [] })).toEqual({ kind: 'n', n: 0 });
  });

  it('403 / 503 / сеть — «?», причина у каждого своя; загрузка — ничего', () => {
    expect(kcCounter({ k: 'forbidden' })).toEqual({ kind: 'unk', why: 'kc403' });
    expect(kcCounter({ k: 'off', detail: 'not configured' })).toEqual({ kind: 'unk', why: 'kc503', detail: 'not configured' });
    expect(kcCounter({ k: 'error', detail: 'HTTP 500' })).toEqual({ kind: 'unk', why: 'kcErr', detail: 'HTTP 500' });
    expect(kcCounter({ k: 'loading' })).toEqual({ kind: 'none' });
  });

  it('слайс: сбой — «?» (а не пропавший счётчик), 0 после загрузки — ничего, иначе число', () => {
    expect(sliceCounter(0, 'HTTP 500', true)).toEqual({ kind: 'unk', why: 'srcErr', detail: 'HTTP 500' });
    expect(sliceCounter(5, 'HTTP 500', true)).toEqual({ kind: 'unk', why: 'srcErr', detail: 'HTTP 500' });
    expect(sliceCounter(0, undefined, true)).toEqual({ kind: 'none' });
    expect(sliceCounter(0, undefined, false)).toEqual({ kind: 'none' });
    expect(sliceCounter(12, undefined, true)).toEqual({ kind: 'n', n: 12 });
  });

  it('готовность к auth: preflight не ответил — «?»; непройденные проверки — красный счётчик', () => {
    expect(readinessCounter(null)).toEqual({ kind: 'unk', why: 'preflight' });
    expect(readinessCounter(PF_OK)).toEqual({ kind: 'none' });
    expect(readinessCounter({ ...PF_OK, agent_scope_enforced: false, kc_reachable: false }))
      .toEqual({ kind: 'bad', n: 2 });
  });

  it('проверки готовности — те же, что в «Настройках»', () => {
    expect(readiness(PF_OK)).toEqual({ admins: true, kc: true, scope: true });
    expect(readiness({ ...PF_OK, admin_count: -1, kc_configured: false })).toEqual({ admins: false, kc: false, scope: true });
  });
});

describe('полоса состояния системы: auth, KC, права агентов, роль', () => {
  const chip = (id: string, a: Parameters<typeof systemChips>[0]) => systemChips(a).find(c => c.id === id)!;

  it('всегда четыре чипа в одном порядке', () => {
    expect(systemChips({ authEnabled: false, preflight: null, users: { k: 'loading' }, role: 'admin' }).map(c => c.id))
      .toEqual(['auth', 'kc', 'scope', 'role']);
  });

  it('auth off — предупреждение (это заменяет dev-баннер), on — зелёный', () => {
    expect(chip('auth', { authEnabled: false, preflight: PF_OK, users: { k: 'loading' }, role: 'admin' }))
      .toMatchObject({ tone: 'wrn', state: 'off' });
    expect(chip('auth', { authEnabled: true, preflight: PF_OK, users: { k: 'loading' }, role: 'admin' }))
      .toMatchObject({ tone: 'suc', state: 'on' });
  });

  it('KC: ok / не настроен / недоступен / 403 / неизвестно — разные состояния', () => {
    const base = { authEnabled: true, users: { k: 'loading' } as const, role: 'admin' };
    expect(chip('kc', { ...base, preflight: PF_OK })).toMatchObject({ tone: 'suc', state: 'ok' });
    expect(chip('kc', { ...base, preflight: { ...PF_OK, kc_configured: false } })).toMatchObject({ tone: 'dng', state: 'off' });
    expect(chip('kc', { ...base, preflight: { ...PF_OK, kc_reachable: false, kc_error: 'timeout' } }))
      .toMatchObject({ tone: 'dng', state: 'down', detail: 'timeout' });
    expect(chip('kc', { ...base, preflight: PF_OK, users: { k: 'forbidden' } })).toMatchObject({ tone: 'dng', state: '403' });
    expect(chip('kc', { ...base, preflight: null })).toMatchObject({ tone: 'wrn', state: 'unknown' });
    expect(chip('kc', { ...base, preflight: null, users: { k: 'off', detail: 'x' } })).toMatchObject({ tone: 'dng', state: 'off' });
  });

  it('права агентов: preflight не ответил — «неизвестно», а не «защищено»', () => {
    const base = { authEnabled: true, users: { k: 'loading' } as const, role: 'admin' };
    expect(chip('scope', { ...base, preflight: null })).toMatchObject({ tone: 'wrn', state: 'unknown' });
    expect(chip('scope', { ...base, preflight: { ...PF_OK, agent_scope_enforced: false } })).toMatchObject({ tone: 'dng', state: 'off' });
    expect(chip('scope', { ...base, preflight: PF_OK })).toMatchObject({ tone: 'suc', state: 'on' });
  });

  it('роль — нейтральный чип с именем роли', () => {
    expect(chip('role', { authEnabled: true, preflight: PF_OK, users: { k: 'loading' }, role: 'viewer' }))
      .toMatchObject({ tone: 'mute', state: 'viewer' });
  });
});
