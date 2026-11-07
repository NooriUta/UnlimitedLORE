// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14 — модель команд над записью/выделением и
// слияния серверного поиска. Чистые функции, без React.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '../core/contract';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';
import {
  actionsFor,
  hotkeyKeys,
  mergeRemote,
  searchPalette,
  targetIds,
  type PaletteAction,
  type PaletteTarget,
} from './paletteModel';

const noop = () => {};
const ACTIONS: PaletteAction[] = [
  { id: 'open', title: 'Открыть', scope: 'record', run: noop },
  { id: 'copy-ids', title: 'Копировать коды', scope: 'any', run: noop },
  { id: 'bulk-close', title: 'Закрыть выбранные', scope: 'selection', run: noop },
];
const rec = (id: string): KitRecord => fixtureData().records.find(r => r.id === id)!;

describe('S4-14 · цель палитры', () => {
  it('targetIds: запись — её id, выделение — id по порядку, нет цели — пусто', () => {
    expect(targetIds({ type: 'record', record: rec('T-1') })).toEqual(['T-1']);
    expect(targetIds({ type: 'selection', ids: ['T-2', 'T-1'] })).toEqual(['T-2', 'T-1']);
    expect(targetIds(null)).toEqual([]);
  });

  it('actionsFor: над записью — record и any; над выделением — selection и any', () => {
    expect(actionsFor({ type: 'record', record: rec('T-1') }, ACTIONS).map(a => a.id)).toEqual(['open', 'copy-ids']);
    expect(actionsFor({ type: 'selection', ids: ['T-1', 'T-2'] }, ACTIONS).map(a => a.id)).toEqual(['copy-ids', 'bulk-close']);
  });

  it('actionsFor: пустое выделение и отсутствие цели — действий нет (не над чем)', () => {
    expect(actionsFor({ type: 'selection', ids: [] }, ACTIONS)).toEqual([]);
    expect(actionsFor(null, ACTIONS)).toEqual([]);
  });

  it('hotkeyKeys: «Mod+Shift+C» → подсказка Kbd', () => {
    expect(hotkeyKeys('Mod+Shift+C')).toEqual(['Ctrl', 'Shift', 'C']);
    expect(hotkeyKeys('x')).toEqual(['X']);
  });
});

describe('S4-14 · действия в выдаче палитры', () => {
  const target: PaletteTarget = { type: 'record', record: rec('T-1') };

  it('пустой запрос: действия над целью идут первыми, потом недавние', () => {
    const r = searchPalette({
      query: '', data: fixtureData(), config: fixtureConfig(), mode: 'all',
      recent: ['record:T-3'], actions: actionsFor(target, ACTIONS),
    });
    expect(r.items.map(i => `${i.type}:${i.id}`)).toEqual(['action:open', 'action:copy-ids', 'record:T-3']);
  });

  it('запрос ищет и по действиям', () => {
    const r = searchPalette({
      query: 'копир', data: fixtureData(), config: fixtureConfig(), mode: 'all',
      recent: [], actions: actionsFor(target, ACTIONS),
    });
    expect(r.items.map(i => `${i.type}:${i.id}`)).toEqual(['action:copy-ids']);
  });

  it('поиск «/» (records) действий не показывает', () => {
    const r = searchPalette({
      query: '', data: fixtureData(), config: fixtureConfig(), mode: 'records',
      recent: [], actions: actionsFor(target, ACTIONS),
    });
    expect(r.items).toEqual([]);
  });
});

describe('S4-14 · слияние серверного поиска', () => {
  it('серверные записи, которых нет среди найденных локально, добавляются с origin=remote', () => {
    const local = searchPalette({ query: 'adr', data: fixtureData(), config: fixtureConfig(), mode: 'records', recent: [] });
    const remote: KitRecord[] = [
      { id: 'ADR-1', kind: 'adr', title: 'Решение о палитре', status: '', fields: {} },
      { id: 'ADR-99', kind: 'adr', title: 'Серверное решение', status: '', fields: {} },
      { id: 'X-1', kind: 'mystery', title: 'Неизвестный тип', status: '', fields: {} },
    ];
    const extra = mergeRemote(local.items, remote, fixtureConfig());
    expect(extra.map(i => i.id)).toEqual(['ADR-99', 'X-1']);
    expect(extra.every(i => i.origin === 'remote')).toBe(true);
    // Неизвестный kind — показываем код типа, а не пустоту.
    expect(extra[1].kindTitle).toBe('mystery');
  });
});
