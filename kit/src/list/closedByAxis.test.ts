// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG — «показывать закрытые»
// считает по оси из шести значений.
//
// Ловушка, которую это чинит: набор закрытых категорий был жёстко задан как
// done/cancelled — старая ось kit. Как только модель начнёт присылать
// finished/withdrawn, ни одна запись не попадёт в «закрытые», и закрытые
// перестанут сворачиваться. Ничего не упадёт — просто список станет длиннее,
// и никто не поймёт почему.
//
// И отдельно: «действует» закрытым НЕ считается. Принятый ADR живой, прятать
// его вместе с завершёнными нельзя.
import { describe, expect, it } from 'vitest';
import { splitClosed } from './listModel';
import type { KitConfig, KitRecord } from '../core/contract';

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'adr', title: id, status, fields: {} });

function cfg(items: KitConfig['statuses']['items']): KitConfig {
  return {
    modules: [], menu: { groups: [] }, kinds: { adr: { title: 'ADR', icon: 'scroll-quill' } },
    statuses: { items },
  } as KitConfig;
}

const OLD = cfg([
  { code: 'done', title: 'Готово', category: 'done', icon: 'x', color: 'var(--suc)' },
  { code: 'cancelled', title: 'Отменено', category: 'cancelled', icon: 'x', color: 'var(--t3)' },
  { code: 'active', title: 'В работе', category: 'active', icon: 'x', color: 'var(--inf)' },
]);

const NEW = cfg([
  { code: 'finished', title: 'Завершено', category: 'finished', icon: 'x', color: 'var(--suc)' },
  { code: 'withdrawn', title: 'Отозвано', category: 'withdrawn', icon: 'x', color: 'var(--t3)' },
  { code: 'accepted', title: 'Действует', category: 'in_force', icon: 'x', color: 'var(--suc)' },
  { code: 'doing', title: 'В работе', category: 'in_progress', icon: 'x', color: 'var(--inf)' },
]);

describe('S4-STATUS-AXIS-CONFIG · что считается закрытым', () => {
  it('старые значения оси по-прежнему закрыты — конфиги не ломаются', () => {
    const r = splitClosed([rec('a', 'done'), rec('b', 'cancelled'), rec('c', 'active')], 'below', OLD);
    expect(r.closed.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.open.map(x => x.id)).toEqual(['c']);
  });

  it('новые значения оси закрыты тоже — иначе закрытые перестали бы сворачиваться', () => {
    const r = splitClosed([rec('a', 'finished'), rec('b', 'withdrawn'), rec('c', 'doing')], 'below', NEW);
    expect(r.closed.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.open.map(x => x.id)).toEqual(['c']);
  });

  it('«действует» НЕ закрыт: принятый ADR живой', () => {
    const r = splitClosed([rec('a', 'accepted')], 'below', NEW);
    expect(r.closed).toEqual([]);
    expect(r.open.map(x => x.id)).toEqual(['a']);
  });

  it('статус вне конфигурации не считается закрытым — непонятное на виду', () => {
    const r = splitClosed([rec('a', 'сюрприз')], 'below', NEW);
    expect(r.open.map(x => x.id)).toEqual(['a']);
  });

  it('режим «все» ничего не прячет независимо от оси', () => {
    const r = splitClosed([rec('a', 'finished')], 'all', NEW);
    expect(r.closed).toEqual([]);
    expect(r.hidden).toBe(0);
  });
});
