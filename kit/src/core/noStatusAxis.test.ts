// У списка может не быть статусной оси вовсе
// (SPRINT_UXR_S10_SEIDR_KIT/K-14 · SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// kit требовал «хотя бы один статус» у КАЖДОГО конфига. Это предметное
// допущение, а не форма: есть ли у типа статусная ось — дело приложения и его
// данных. Правило владелицы 09.11: «kit должен оставаться универсальным, по
// нему дописывать MIDGARD, AIDA и странников».
//
// Повод — замеренный, а не воображаемый. Из восьми типов LORE, которым в v2
// строятся разделы, у ЧЕТЫРЁХ статуса нет ни в одном поле среза:
//   • вехи (`milestones`) — есть priority и week, статуса нет;
//   • компоненты (`components`) — справочник;
//   • технологии (`tech_registry`) — реестр версий;
//   • релизы (`releases`) — есть type и is_current, статуса нет.
// Под старым требованием разделу пришлось бы объявить фиктивный статус, и
// каждая строка получила бы чип статуса, которого у неё нет. Это ровно та
// ложь, против которой доктрина честных состояний: «оси нет» ≠ «ось есть,
// значение неизвестно».
//
// Что остаётся запрещённым — МОЛЧАНИЕ при расхождении: ось объявлена пустой, а
// данные статусы несут; ось пуста, а колонка или фасет «Статус» заказаны.
import { describe, expect, it } from 'vitest';
import { validateKitConfig, validateKitData } from './validate';
import type { KitConfig } from './contract';

const ICON = 'sprint';

/** Минимальный конфиг: ось статусов задаётся аргументом. */
function cfg(items: KitConfig['statuses']['items'], list?: Partial<KitConfig['list']>): unknown {
  return {
    modules: [{ id: 'm', title: 'M', icon: ICON, status: 'active' }],
    menu: { groups: [] },
    kinds: { milestone: { title: 'Вехи', icon: ICON } },
    statuses: { items },
    ...(list ? { list } : {}),
  };
}

const WITH_AXIS: KitConfig['statuses']['items'] = [
  { code: 'done', title: 'Готово', category: 'done', icon: ICON, color: 'var(--suc)' },
];

function data(records: { id: string; status: string }[]): unknown {
  return {
    records: records.map(r => ({ id: r.id, kind: 'milestone', title: r.id, status: r.status, fields: {} })),
    edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' },
  };
}

/** Коды ошибок (не предупреждений) — для сообщений, когда тест падает. */
const errs = (v: { errors: { path: string; code: string }[] }) => v.errors.map(e => `${e.path}:${e.code}`);
const warnCodes = (v: { warnings: { code: string; message: string }[] }, code: string) => v.warnings.filter(w => w.code === code);

describe('K-14 · статусной оси может не быть', () => {
  it('положительный контроль: конфиг СО статусами по-прежнему проходит', () => {
    const v = validateKitConfig(cfg(WITH_AXIS));
    expect(errs(v)).toEqual([]);
  });

  it('пустая ось — законный конфиг, а не ошибка', () => {
    const v = validateKitConfig(cfg([]));
    expect(errs(v), 'пустая ось отвергнута').toEqual([]);
  });

  it('запись без статуса при пустой оси не даёт ни одной жалобы', () => {
    const v = validateKitData(data([{ id: 'M-1', status: '' }]), cfg([]) as KitConfig);
    expect(errs(v)).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('пустая ось, а данные статусы несут — ОДНО предупреждение, а не по одному на строку', () => {
    const v = validateKitData(
      data([{ id: 'M-1', status: 'done' }, { id: 'M-2', status: 'open' }, { id: 'M-3', status: 'done' }]),
      cfg([]) as KitConfig,
    );
    const noAxis = warnCodes(v, 'status-without-axis');
    expect(noAxis).toHaveLength(1);
    // В сообщении названы сами значения: иначе непонятно, что именно чинить.
    expect(noAxis[0].message).toContain('done');
    expect(noAxis[0].message).toContain('open');
    // И ни одного «нет в config.statuses» — это был бы шум на каждой строке.
    expect(warnCodes(v, 'unknown-status')).toEqual([]);
  });

  it('колонка «Статус» при пустой оси — предупреждение: колонка обещает ось, которой нет', () => {
    const v = validateKitConfig(cfg([], { views: ['list'], columns: ['id', 'title', 'status'] }));
    expect(warnCodes(v, 'status-column-without-axis')).toHaveLength(1);
    expect(errs(v)).toEqual([]);
  });

  it('фасет «Статус» при пустой оси — то же предупреждение: фильтр обещает ось, которой нет', () => {
    const v = validateKitConfig(cfg([], { views: ['list'], columns: ['id'], filters: ['status'] }));
    expect(warnCodes(v, 'status-facet-without-axis')).toHaveLength(1);
    expect(errs(v)).toEqual([]);
  });

  it('колонка и фасет «Статус» при НЕПУСТОЙ оси предупреждений не дают', () => {
    const v = validateKitConfig(cfg(WITH_AXIS, { views: ['list'], columns: ['id', 'status'], filters: ['status'] }));
    expect(v.warnings.filter(w => w.code.endsWith('-without-axis'))).toEqual([]);
  });
});
