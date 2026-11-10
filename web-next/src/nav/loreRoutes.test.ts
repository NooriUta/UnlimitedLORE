// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13 — баги B-01, B-02, B-06, B-07 из Q-UXR-4
// (D-2026-UXR-BUGS-IN-REDESIGN), маршрутная часть каркаса v2.
//
// ПЕРЕОТКРЫТО 09.11.2026: модуль был «единственным» только на словах — вне этого
// теста его не вызывал никто, и он описывал не ту схему. Адреса собирали сами
// список, палитра и лента; на проде ссылки из ленты открывали запись без меню
// или не открывали вовсе. Поэтому кроме контракта модуля здесь СТОРОЖ ВЫЗОВА:
// карта «тип → раздел» и адреса v1 нигде, кроме loreRoutes, не собираются.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUrlState, type UrlWindow } from '@seidr/kit';
import { V2_SECTIONS } from '../shell/v2Config';
import {
  SEARCH_HIT_TYPES, TYPE_SECTION, knownRecordHref, readRoute, recordHref, recordIdOf, searchHref, sectionHref, sectionOfType,
} from './loreRoutes';

const params = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('B-02 · тип записи → раздел v2; релиз — в релизы', () => {
  it('каждый раздел карты существует в оболочке v2', () => {
    for (const [t, sec] of Object.entries(TYPE_SECTION)) {
      expect(V2_SECTIONS as readonly string[], `${t} → ${sec}`).toContain(sec);
    }
  });

  it('релиз открывается в «Релизах», запись — параметром open', () => {
    const r = readRoute(params(recordHref('release', 'NooriUta/UnlimitedLORE#v1.17.5')!));
    expect(r.sec).toBe('release');
    expect(r.record).toEqual({ kind: 'release', id: 'NooriUta/UnlimitedLORE#v1.17.5' });
  });

  it('неизвестный тип и тип без раздела в v2 — null, а не тихий дефолтный раздел', () => {
    expect(recordHref('martian', 'X-1')).toBeNull();
    for (const t of ['doc', 'runbook', 'quality_gate', 'use_case', 'actor']) expect(recordHref(t, 'X-1'), t).toBeNull();
    expect(sectionOfType('toString')).toBeNull();
  });

  it('адрес от корня и с модулем — со страницы вне оболочки тоже ведёт в оболочку', () => {
    const h = recordHref('adr', 'ADR-1')!;
    expect(h.startsWith('/?')).toBe(true);
    expect(params(h).get('mod')).toBe('forseti');
    expect(h).not.toMatch(/\/lore\?|section=|passport=|[?&]rec=|[?&]kind=/);
  });
});

describe('B-06 · туда-обратно: запись = тот же тип и тот же id', () => {
  it('по всем типам с разделом, включая «/» и пробелы в id', () => {
    for (const t of Object.keys(TYPE_SECTION)) {
      const id = t === 'task' ? 'SPRINT_X/CO-11' : `${t}-id with space`;
      const r = readRoute(params(recordHref(t, id)!));
      expect(r.sec, t).toBe(TYPE_SECTION[t]);
      expect(r.record, t).toEqual({ kind: t, id });
    }
  });

  it('у каждого типа поиска, у которого есть раздел, ссылка открывает запись', () => {
    for (const t of SEARCH_HIT_TYPES) {
      const h = recordHref(t, 'X-1');
      if (sectionOfType(t)) expect(readRoute(params(h!)).record, t).toEqual({ kind: t, id: 'X-1' });
      else expect(h, t).toBeNull();
    }
  });

  it('релиз: код «проект#версия» не дополняется проектом второй раз (на проде удваивался)', () => {
    expect(recordIdOf('release', 'NooriUta/X#v1.17.5', 'NooriUta/X')).toBe('NooriUta/X#v1.17.5');
    expect(recordIdOf('release', 'v1.17.0', 'NooriUta/X')).toBe('NooriUta/X#v1.17.0');
    expect(recordIdOf('adr', 'ADR-1', 'NooriUta/X')).toBe('ADR-1');
  });

  it('раздел без записи и не-раздел записей — без записи', () => {
    expect(readRoute(new URLSearchParams('sec=adr')).record).toBeNull();
    expect(readRoute(new URLSearchParams('sec=news&open=X-1')).record).toBeNull();
  });
});

describe('B-01 · ?sec=search&q= не теряет запрос', () => {
  it('запрос туда-обратно, кириллица и пробелы внутри сохраняются', () => {
    const r = readRoute(params(searchHref('  релиз  весны ')));
    expect(r.sec).toBe('search');
    expect(r.q).toBe('релиз  весны');
  });

  it('пустой запрос — честно пустая строка, раздел поиска остаётся', () => {
    const r = readRoute(params(searchHref('')));
    expect(r.sec).toBe('search');
    expect(r.q).toBe('');
  });

  it('запрос читается и из «#»-фолбэка (песочница iframe, file://)', () => {
    const win: UrlWindow = {
      location: { pathname: '/', search: '', hash: '#sec=search&q=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7' },
      history: { pushState: () => {}, replaceState: () => {} },
    };
    expect(readRoute(readUrlState(win)).q).toBe('релиз');
  });
});

describe('B-07 · переход в другой раздел не тащит q, фильтры и запись', () => {
  it('sectionHref снимает параметры прежнего раздела', () => {
    const cur = new URLSearchParams('mod=forseti&sec=sprint&q=релиз&lf=%7B%7D&lq=done&open=S-1&place=right&tab=links');
    const p = params(sectionHref('adr', cur));
    expect(p.get('sec')).toBe('adr');
    for (const k of ['q', 'lf', 'lq', 'open', 'place', 'tab']) expect(p.get(k), k).toBeNull();
  });

  it('глобальные параметры (модуль) переживают переход', () => {
    const p = params(sectionHref('adr', new URLSearchParams('mod=lore&sec=sprint&q=x')));
    expect(p.get('mod')).toBe('lore');
  });

  it('ссылка на запись из поиска тоже не тащит q поиска', () => {
    const p = params(recordHref('adr', 'ADR-1', new URLSearchParams('sec=search&q=релиз'))!);
    expect(p.get('q')).toBeNull();
    expect(p.get('open')).toBe('ADR-1');
  });
});

// Ссылка по коду, когда тип записи известен только из загруженных записей:
// kit зовёт ctx.href(id) без типа (связи, граф, таблица связей паспорта). Паспорт
// отдавал «#код» — ссылка вела никуда (находка 09.11 при приёмке на проде).
describe('ссылка по коду из известных записей', () => {
  const recs = [{ id: 'S/T-1', kind: 'task' }, { id: 'ADR-1', kind: 'adr' }, { id: 'DOC-1', kind: 'doc' }];
  it('тип известен → адрес раздела оболочки', () => {
    expect(knownRecordHref('S/T-1', recs, () => 'x')).toBe('/?mod=forseti&sec=task&open=S%2FT-1');
    expect(knownRecordHref('ADR-1', recs, () => 'x')).toBe('/?mod=forseti&sec=adr&open=ADR-1');
  });
  it('записи нет или у типа нет раздела в v2 — запасная ссылка, раздел не выдумывается', () => {
    expect(knownRecordHref('NOPE', recs, id => '#' + id)).toBe('#NOPE');
    expect(knownRecordHref('DOC-1', recs, id => '#' + id)).toBe('#DOC-1');
  });
});

// Сторож вызова, а не модуля: прежний тест проверял модуль сам на себе и был
// зелёным, пока экраны собирали адреса в обход.
describe('S4-13 · адреса записей собирает только loreRoutes', () => {
  const SRC = join(__dirname, '..');
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
  // PassportDemo — витрина /kit/passport на демо-данных вне приложения (S4-33).
  const ALLOW = [join('nav', 'loreRoutes.ts'), join('pages', 'PassportDemo.tsx')];
  const files = walk(SRC).filter(f => !ALLOW.some(a => f.endsWith(a)));

  it('карта «тип → раздел» (Record<…, V2Section>) больше нигде не заводится', () => {
    const bad = files.filter(f => /Record<string,\s*V2Section>/.test(readFileSync(f, 'utf8')));
    expect(bad.map(f => relative(SRC, f))).toEqual([]);
  });

  it('ссылки «#код» вместо адреса записи (href: x => `#${…}`) в v2 нет', () => {
    const bad = files.filter(f => /href:\s*\w+\s*=>\s*`#\$\{/.test(readFileSync(f, 'utf8')));
    expect(bad.map(f => relative(SRC, f))).toEqual([]);
  });

  it('адресов v1 (/lore?section=…&passport=…) в v2 нет', () => {
    const bad = files.filter(f => /['"`]\/lore\?section=|passport=\$\{/.test(readFileSync(f, 'utf8')));
    expect(bad.map(f => relative(SRC, f))).toEqual([]);
  });
});
