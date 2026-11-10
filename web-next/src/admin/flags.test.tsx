// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-08 — флаги и версия LORE в админке.
// Форма — от сервера (LoreAdminFlags, PR #957): GET /lore/admin/flags →
// { version{commit,built_at,schema_version}, flags[{key,value,default,overridden,meaning}], overridden }.
// Тег релиза знает только /lore/version (release, null — выкатка не передала).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { FlagsScreen } from './FlagsScreen';
import { parseFlags } from './flags';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const FLAGS = {
  version: { commit: 'abc1234', built_at: '2026-11-10T09:00:00Z', schema_version: 81 },
  flags: [
    { key: 'lore.enabled', value: true, default: false, overridden: true, meaning: 'LORE включён в этом бэкенде' },
    { key: 'lore.scope.enforce', value: false, default: false, overridden: false, meaning: 'проектный read-скоуп' },
    { key: 'lore.stats.enabled', value: true, default: true, overridden: false, meaning: 'телеметрия' },
  ],
  overridden: 1,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fake(o: { flags?: unknown; flagsStatus?: number; version?: unknown; versionStatus?: number } = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/lore/admin/flags')) return json(o.flags ?? FLAGS, o.flagsStatus ?? 200);
    if (url.startsWith('/lore/version')) return json(o.version ?? { commit: 'abc1234', release: 'v1.17.9' }, o.versionStatus ?? 200);
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
}
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><FlagsScreen fetchImpl={f} /></KitLangProvider>);

describe('модель флагов', () => {
  it('разбирает флаги, версию и число изменённых', () => {
    const d = parseFlags(FLAGS);
    expect(d.flags.map(f => f.key)).toEqual(['lore.enabled', 'lore.scope.enforce', 'lore.stats.enabled']);
    expect(d.flags[0]).toMatchObject({ value: true, def: false, overridden: true });
    expect(d.version).toEqual({ commit: 'abc1234', built_at: '2026-11-10T09:00:00Z', schema_version: 81 });
    expect(d.overridden).toBe(1);
  });

  it('ответ без массива flags — сбой, а не «флагов нет»', () => {
    expect(() => parseFlags({ version: {} })).toThrow(/flags/);
  });

  it('флаг без булева значения — сбой, а не «выключен»', () => {
    expect(() => parseFlags({ flags: [{ key: 'lore.x', default: false }] })).toThrow(/value/);
  });
});

describe('экран флагов и версии', () => {
  it('видны флаги, их значение и умолчание, изменённый помечен', async () => {
    mount(fake());
    const table = await screen.findByTestId('adm-flags');
    const row = within(table).getByTestId('adm-flag-lore.enabled');
    expect(row.getAttribute('data-overridden')).toBe('true');
    expect(row.textContent).toContain('LORE включён в этом бэкенде');
    expect(within(table).getByTestId('adm-flag-lore.scope.enforce').getAttribute('data-overridden')).toBeNull();
    expect(screen.getByTestId('adm-flags-overridden').textContent).toContain('1');
  });

  it('версия сборки: коммит, схема и тег релиза из /lore/version', async () => {
    mount(fake());
    const v = await screen.findByTestId('adm-version');
    expect(v.textContent).toContain('abc1234');
    expect(v.textContent).toContain('81');
    expect((await screen.findByTestId('adm-release')).textContent).toContain('v1.17.9');
  });

  it('тег релиза не передан выкаткой — так и сказано, а не пустая клетка', async () => {
    mount(fake({ version: { commit: 'abc1234', release: null } }));
    expect((await screen.findByTestId('adm-release')).getAttribute('data-state')).toBe('none');
  });

  it('/lore/version не прочитался — флаги видны, про релиз сказано «не смогли»', async () => {
    mount(fake({ version: { error: 'DOWN' }, versionStatus: 502 }));
    await screen.findByTestId('adm-flags');
    expect((await screen.findByTestId('adm-release')).getAttribute('data-state')).toBe('error');
  });

  it('фильтр «только изменённые» — в адресе', async () => {
    mount(fake());
    await screen.findByTestId('adm-flags');
    fireEvent.click(screen.getByTestId('adm-flags-changed'));
    expect(window.location.search).toContain('adm-flags=changed');
    const table = screen.getByTestId('adm-flags');
    expect(within(table).queryByTestId('adm-flag-lore.scope.enforce')).toBeNull();
    expect(within(table).getByTestId('adm-flag-lore.enabled')).toBeTruthy();
  });

  it('403 — «нет прав», а не пустой список', async () => {
    mount(fake({ flags: { error: 'FORBIDDEN', detail: 'admin only' }, flagsStatus: 403 }));
    expect(await screen.findByText(/admin only/)).toBeTruthy();
    expect(screen.queryByTestId('adm-flags')).toBeNull();
  });

  it('502 — ошибка загрузки с повтором', async () => {
    mount(fake({ flags: { error: 'DOWN' }, flagsStatus: 502 }));
    expect(await screen.findByRole('button', { name: /повтор/i })).toBeTruthy();
    expect(screen.queryByTestId('adm-flags')).toBeNull();
  });
});
