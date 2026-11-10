// SPRINT_UXR_S9_SCALE_OPT/S9-01, клиентская половина — счётчики, посчитанные
// ИСТОЧНИКОМ ДАННЫХ, а не загруженной страницей.
//
// Почему правило вообще понадобилось: `facetOf` и `quickCounts` считают по
// `data.records`, то есть по тому, что влезло в страницу выдачи. Рядом при этом
// стоит «Показано 1000 из 4000» — и человек читает счётчик фасета как число по
// всей выдаче, хотя он посчитан по тысяче. Это не погрешность, а другое
// утверждение.
//
// Поэтому здесь закреплено ТРИ разных ответа вместо одного числа:
//   • «посчитано по всей выдаче» — число источника;
//   • «не посчитано» — не ноль и не число страницы, а «?» с причиной;
//   • «посчитано по загруженным строкам» — прежнее число, но названное так.
//
// И отдельно — что сумма по оси бывает БОЛЬШЕ числа записей: у записи бывает
// несколько значений (одна запись в нескольких разрезах). Это норма, а не сбой
// счёта, и подпись не должна выглядеть как ошибка.
import { describe, expect, it } from 'vitest';
import { axisOf, axisSource, countsNotes, facetFromAxis, quickSource } from './listCounts';
import type { AxisCounts, ListCounts } from './listCounts';

const axis = (values: [string, number][], extra: Partial<AxisCounts> = {}): AxisCounts => ({
  values: values.map(([value, count]) => ({ value, count })),
  empty: 0,
  nonempty: values.reduce((n, v) => n + v[1], 0),
  total: values.reduce((n, v) => n + v[1], 0),
  ...extra,
});

const counted = (axes: Record<string, AxisCounts>, extra: Partial<Extract<ListCounts, { kind: 'counted' }>> = {}): ListCounts =>
  ({ kind: 'counted', axes, ...extra });

const wide = { keys: [] as string[], text: false };

describe('S9-01 · ось: число источника, «не посчитано» и число страницы — три разных ответа', () => {
  it('положительный контроль: ось посчитана — число берётся у источника', () => {
    const c = counted({ 'fields.a': axis([['x', 400], ['y', 100]], { total: 500 }) });
    const s = axisSource(c, 'fields.a', wide);
    expect(s.from).toBe('all');
    expect(s.from === 'all' && s.axis.total).toBe(500);
  });

  it('ось в «не посчитано» — это НЕ ноль: источник «unknown» с причиной', () => {
    const c = counted({}, { unavailable: { 'fields.a': 'разрез по этому полю не считается' } });
    const s = axisSource(c, 'fields.a', wide);
    expect(s.from).toBe('unknown');
    expect(s.from === 'unknown' && s.reason).toBe('разрез по этому полю не считается');
  });

  it('оси не спрашивали — число остаётся по странице, а не выдумывается', () => {
    expect(axisSource(counted({ 'fields.b': axis([['x', 1]]) }), 'fields.a', wide).from).toBe('page');
    expect(axisSource(undefined, 'fields.a', wide).from).toBe('page');
  });

  it('«fields.» в имени не считается другой осью: fields.a и a — одна ось', () => {
    const c = counted({ a: axis([['x', 7]]) });
    expect(axisSource(c, 'fields.a', wide).from).toBe('all');
    expect(axisOf({ 'fields.a': axis([['x', 7]]) }, 'a')?.total).toBe(7);
  });

  it('счётчиков у источника не бывает — числа честно остаются по странице', () => {
    expect(axisSource({ kind: 'unsupported' }, 'fields.a', wide).from).toBe('page');
  });

  it('источник отказал или сбойнул — «?», а не ноль и не число страницы', () => {
    expect(axisSource({ kind: 'forbidden' }, 'fields.a', wide).from).toBe('unknown');
    const f = axisSource({ kind: 'failed', reason: 'HTTP 500' }, 'fields.a', wide);
    expect(f.from === 'unknown' && f.reason).toBe('HTTP 500');
  });
});

describe('S9-01 · прочие условия сужают выдачу — числа источника для неё уже не те', () => {
  const c = counted({ 'fields.a': axis([['x', 400]]), 'fields.b': axis([['y', 300]]) });

  it('включён фильтр ЧУЖОГО поля — число источника больше не про эту выдачу', () => {
    expect(axisSource(c, 'fields.a', { keys: ['fields.b'], text: false }).from).toBe('page');
  });

  it('включён фильтр СВОЕГО поля — число источника годится: свою ось он и так не учитывает', () => {
    expect(axisSource(c, 'fields.a', { keys: ['fields.a'], text: false }).from).toBe('all');
  });

  it('введён текст — число источника не про эту выдачу', () => {
    expect(axisSource(c, 'fields.a', { keys: [], text: true }).from).toBe('page');
  });
});

describe('S9-01 · «Быстро»: число источника только там, где его можно сопоставить', () => {
  const c = counted({ status: axis([['active', 120], ['todo', 80]], { empty: 5, total: 205 }) });

  it('положительный контроль: одно поле — одно значение — число источника', () => {
    const q = quickSource(c, { status: 'active' }, wide);
    expect(q).toEqual({ from: 'all', count: 120 });
  });

  it('значения нет в оси — это проверенный ноль: ось посчитана по всей выдаче', () => {
    expect(quickSource(c, { status: 'blocked' }, wide)).toEqual({ from: 'all', count: 0 });
  });

  it('«без значения» — это «пусто» оси, а не ноль', () => {
    expect(quickSource(c, { status: '' }, wide)).toEqual({ from: 'all', count: 5 });
  });

  it('условие по двум полям источник так не считает — остаётся число страницы', () => {
    expect(quickSource(c, { status: 'active', 'fields.a': 'x' }, wide).from).toBe('page');
  });

  it('ось «Быстро» не посчитана — «?» с причиной, а не ноль', () => {
    const u = counted({}, { unavailable: { status: 'ось не посчитана' } });
    const q = quickSource(u, { status: 'active' }, wide);
    expect(q.from).toBe('unknown');
    expect(q.from === 'unknown' && q.reason).toBe('ось не посчитана');
  });

  it('включён любой фильтр поля — «Быстро» считается по странице: оно учитывает все условия', () => {
    expect(quickSource(c, { status: 'active' }, { keys: ['status'], text: false }).from).toBe('page');
  });
});

describe('S9-01 · неполный счёт и предел — говорятся словами', () => {
  it('положительный контроль: полный счёт — сказать нечего', () => {
    expect(countsNotes(counted({ a: axis([['x', 1]]) }, { completeness: 'complete' }))).toEqual([]);
    expect(countsNotes(undefined)).toEqual([]);
  });

  it('partial — «посчитано не целиком»', () => {
    expect(countsNotes(counted({}, { completeness: 'partial' }))).toEqual([{ kind: 'partial' }]);
  });

  it('unknown — «целиком ли, неизвестно»: это не «целиком»', () => {
    expect(countsNotes(counted({}, { completeness: 'unknown' }))).toEqual([{ kind: 'unknown' }]);
  });

  it('cap — назван предел и что именно в него упёрлось', () => {
    const notes = countsNotes(counted({}, { completeness: 'partial', cap: { parts: ['totals', 'a'], limit: 1000 } }));
    expect(notes).toEqual([{ kind: 'cap', limit: 1000, parts: ['totals', 'a'] }, { kind: 'partial' }]);
  });

  it('счётчиков не бывает / нет разрешённых проектов / сбой — каждое своими словами', () => {
    expect(countsNotes({ kind: 'unsupported' })).toEqual([{ kind: 'unsupported' }]);
    expect(countsNotes({ kind: 'forbidden' })).toEqual([{ kind: 'forbidden' }]);
    expect(countsNotes({ kind: 'failed', reason: 'HTTP 500' })).toEqual([{ kind: 'failed', reason: 'HTTP 500' }]);
  });
});

describe('S9-01 · ось со многими значениями у записи: Σ > числа записей — норма', () => {
  it('сумма больше итога — ось помечена «многозначной», а не сбойной', () => {
    const a = axis([['c1', 300], ['c2', 250]], { total: 400, nonempty: 400, empty: 0, multi: true });
    const f = facetFromAxis(a);
    expect(f.values.map(v => v.count)).toEqual([300, 250]);
    expect(f.total).toBe(400);
    expect(f.values.reduce((n, v) => n + v.count, 0)).toBeGreaterThan(f.total);
  });

  it('значения приходят порядком источника: по убыванию счёта', () => {
    const f = facetFromAxis(axis([['c2', 250], ['c1', 300]]));
    expect(f.values.map(v => v.value)).toEqual(['c2', 'c1']);
  });

  it('пусто / не пусто берутся у источника, а не считаются по странице', () => {
    const f = facetFromAxis(axis([['x', 10]], { empty: 4, nonempty: 10, total: 14 }));
    expect([f.empty, f.nonempty, f.total]).toEqual([4, 10, 14]);
  });
});
