import { describe, expect, it } from 'vitest';
import canonical from '../../../shared/lore-statuses.json';
import {
  CLOSED_CATEGORIES, STATUS_CATEGORY_TABLE, categoryOf, countSection, formatSectionCount,
  isOpenCategory, toSliceEnvelope,
  type SliceEnvelope,
} from './s1';
import { STUB_SECTION_COUNTS, STUB_SLICE_BODIES, stubFetchLoreSliceMeta, stubFetchSectionCounts } from './s1.stubs';

// SPRINT_UXR_S1_HONEST_API/S1-01: контракты S1, на которые S4 (UI v2) пишется
// параллельно на заглушках. Спека: SPEC-LORE-UXR-S1-CONTRACTS.
// Три контракта: (1) ответ слайса с полнотой, (2) категории статусов,
// (3) правило счётчиков. Тест фиксирует форму — сервер (S1-02/06/07) обязан
// отдавать то же самое, иначе UI на заглушках разъедется с боевым.

const NOW = '2026-11-08T10:00:00.000Z';

describe('S1 контракт 1: ответ слайса с метаданными полноты', () => {
  it('полный ответ без маркеров — complete, без предупреждений', () => {
    const env = toSliceEnvelope<{ id: string }>({ rows: [{ id: 'a' }] }, NOW);
    expect(env).toEqual<SliceEnvelope<{ id: string }>>({
      rows: [{ id: 'a' }],
      fetchedAt: NOW,
      scope: null,
      truncated: false,
      limit: null,
      page: null,
      outsideScope: null,
      warnings: [],
      completeness: 'complete',
    });
  });

  it('обрезанный сервером ответ — partial, лимит и подсказка сохранены (сейчас fetchLoreSlice их выбрасывает)', () => {
    const env = toSliceEnvelope({ rows: [], truncated: true, limit: 1000, hint: 'выдача обрезана' }, NOW);
    expect(env.truncated).toBe(true);
    expect(env.limit).toBe(1000);
    expect(env.completeness).toBe('partial');
    expect(env.warnings).toContain('выдача обрезана');
  });

  it('truncated:"unknown" — полнота неизвестна, а не «полно»', () => {
    const env = toSliceEnvelope({ rows: [], truncated: 'unknown', hint: 'проверить нечем' }, NOW);
    expect(env.truncated).toBe('unknown');
    expect(env.completeness).toBe('unknown');
  });

  it('страница с has_more — partial; warning страницы попадает в warnings', () => {
    const env = toSliceEnvelope({
      rows: [{}],
      page: { limit: 1, offset: 0, total: 3, has_more: true },
    }, NOW);
    expect(env.page).toEqual({ limit: 1, offset: 0, total: 3, has_more: true });
    expect(env.completeness).toBe('partial');

    const empty = toSliceEnvelope({
      rows: [],
      page: { limit: 5, offset: 0, total: 0, has_more: false, fields: ['x'], fields_checked: false, warning: 'fields не проверены' },
    }, NOW);
    expect(empty.warnings).toContain('fields не проверены');
  });

  it('скоуп и outside_scope переносятся; скоуп сам по себе не делает ответ неполным', () => {
    const env = toSliceEnvelope({
      rows: [],
      scope: { applied: true, projects: 2, note: 'выдача сужена проектным скоупом' },
      outside_scope: { id: 'X', verdict: 'outside_scope', reason: 'запись вне ваших проектов' },
    }, NOW);
    expect(env.scope).toEqual({ applied: true, projects: 2, note: 'выдача сужена проектным скоупом' });
    expect(env.outsideScope?.verdict).toBe('outside_scope');
    expect(env.completeness).toBe('complete');
    expect(env.warnings).toEqual(['выдача сужена проектным скоупом', 'запись вне ваших проектов']);
  });

  it('серверные warnings (будущее поле S1-02) складываются с выведенными, без дублей', () => {
    const env = toSliceEnvelope({ rows: [], warnings: ['w1', 'w1'], truncated: true, hint: 'w1' }, NOW);
    expect(env.warnings).toEqual(['w1']);
  });

  it('старый формат без rows — пустой список, а не исключение', () => {
    expect(toSliceEnvelope({}, NOW).rows).toEqual([]);
  });
});

describe('S1 контракт 2: категории статусов по типам', () => {
  it('accepted у ADR/спек/решений — «действует» и считается открытым (180 из 241 ADR не прячутся)', () => {
    for (const t of ['adr', 'spec', 'decision'] as const) {
      expect(categoryOf(t, 'accepted')).toBe('in_force');
    }
    expect(isOpenCategory('in_force')).toBe(true);
  });

  it('deprecated есть в таблице ADR (в данных встречается, в shared/lore-statuses.json пока нет)', () => {
    expect(categoryOf('adr', 'deprecated')).toBe('withdrawn');
  });

  it('закрытые — только finished и withdrawn', () => {
    expect([...CLOSED_CATEGORIES].sort()).toEqual(['finished', 'withdrawn']);
    expect(categoryOf('task', 'done')).toBe('finished');
    expect(categoryOf('task', 'cancelled')).toBe('withdrawn');
    expect(categoryOf('sprint', 'active')).toBe('in_progress');
    expect(categoryOf('task', 'planned')).toBe('not_started');
  });

  it('незнакомый статус — unknown и считается открытым: не прятать то, что не распознали', () => {
    expect(categoryOf('task', 'что-то новое')).toBe('unknown');
    expect(isOpenCategory('unknown')).toBe(true);
  });

  it('регистр и пробелы не важны', () => {
    expect(categoryOf('adr', '  ACCEPTED ')).toBe('in_force');
  });

  it('таблица покрывает каждый канонический статус из shared/lore-statuses.json', () => {
    for (const s of canonical.planStatuses) {
      expect(STATUS_CATEGORY_TABLE.task[s], `task:${s}`).toBeDefined();
      expect(STATUS_CATEGORY_TABLE.sprint[s], `sprint:${s}`).toBeDefined();
    }
    for (const s of canonical.adrStatuses) {
      expect(STATUS_CATEGORY_TABLE.adr[s], `adr:${s}`).toBeDefined();
    }
  });
});

describe('S1 контракт 3: правило счётчиков', () => {
  const rows = [
    { s: 'accepted' }, { s: 'accepted' }, { s: 'proposed' },
    { s: 'superseded' }, { s: 'deprecated' }, { s: 'странный' },
  ];

  it('открытые = не закрытые категории (включая «действует» и unknown); закрытые отдельно', () => {
    const c = countSection({ section: 'adrs', entityType: 'adr', rows, statusOf: (r) => r.s });
    expect(c.open).toBe(4);
    expect(c.closed).toBe(2);
    expect(c.byCategory).toEqual({ in_force: 2, in_progress: 1, withdrawn: 2, unknown: 1 });
    expect(c.completeness).toBe('complete');
  });

  it('полнота и скоуп конверта переходят в счётчик', () => {
    const c = countSection({
      section: 'adrs', entityType: 'adr', rows, statusOf: (r) => r.s,
      envelope: { completeness: 'partial', scope: { applied: true, projects: 1 } },
      filters: { component: 'FORSETI' },
    });
    expect(c.completeness).toBe('partial');
    expect(c.scope).toEqual({ applied: true, projects: 1 });
    expect(c.filters).toEqual({ component: 'FORSETI' });
  });

  it('формат: «142 · +361»; без закрытых — просто число; неполнота видна', () => {
    const base = { section: 's', byCategory: {}, scope: null, filters: {} };
    expect(formatSectionCount({ ...base, open: 142, closed: 361, completeness: 'complete' })).toBe('142 · +361');
    expect(formatSectionCount({ ...base, open: 7, closed: 0, completeness: 'complete' })).toBe('7');
    expect(formatSectionCount({ ...base, open: 7, closed: 2, completeness: 'partial' })).toBe('≥7 · +2');
    expect(formatSectionCount({ ...base, open: 7, closed: 0, completeness: 'unknown' })).toBe('7?');
  });
});

describe('S1 заглушки для UI S4', () => {
  it('каждая заглушка тела слайса проходит через тот же конверт и даёт заявленную полноту', () => {
    for (const [name, stub] of Object.entries(STUB_SLICE_BODIES)) {
      const env = toSliceEnvelope(stub.body, NOW);
      expect(env.completeness, name).toBe(stub.expect);
    }
  });

  it('stubFetchLoreSliceMeta отдаёт конверт; неизвестный сценарий — ошибка, а не пустота', async () => {
    const env = await stubFetchLoreSliceMeta('truncated');
    expect(env.completeness).toBe('partial');
    await expect(stubFetchLoreSliceMeta('nope' as never)).rejects.toThrow(/unknown stub/);
  });

  it('заглушки счётчиков согласованы с правилом форматирования', async () => {
    const counts = await stubFetchSectionCounts();
    expect(counts).toBe(STUB_SECTION_COUNTS);
    const adrs = counts.find((c) => c.section === 'adrs');
    expect(adrs && formatSectionCount(adrs)).toBe('183 · +58');
  });
});
