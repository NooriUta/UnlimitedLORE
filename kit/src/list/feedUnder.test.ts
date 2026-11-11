// Нижний уровень двухуровневой ленты — правило свёртки
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-TWO-LEVEL, spec:SPEC-LORE-KIT-FEED-VIEW §4).
//
// Открытый вопрос спеки («грузить нижний уровень при раскрытии или сразу»)
// закрыт словом владелицы 10.11.2026. Дословно — про тело записи в ленте: «нет
// в feed грузить первые 3 абзаца остально при расеррытии». То же правило она
// распространила на нижний уровень: ГРУЗИТЬ ПРИ РАСКРЫТИИ. Это CONFIRMED, а не
// допущение, и проверяется здесь: у незагруженного нижнего уровня нет строк
// вовсе, а предложение под полосой — «запросить», а не «раскрыть».
//
// Почему правило живёт чистой функцией, а не в разметке: это утверждения о
// состоянии («не загружено» ≠ «пусто» ≠ «нет прав» ≠ «показано не всё»), и
// проверять их надо по отдельности. Тот же приём, что у `foldBody`.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '../core/contract';
import { foldUnder } from './feedUnder';
import type { FeedUnder } from './feedUnder';

const rec = (id: string): KitRecord => ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: {} });
const three = [rec('u1'), rec('u2'), rec('u3')];

describe('K2-FEED-TWO-LEVEL · «грузить при раскрытии» (слово владелицы 10.11.2026)', () => {
  it('положительный контроль: загруженный и раскрытый нижний уровень даёт строки', () => {
    const f = foldUnder({ kind: 'here', records: three }, true);
    expect(f.rows.map(r => r.id)).toEqual(['u1', 'u2', 'u3']);
    expect(f.action).toEqual({ kind: 'close' });
  });

  it('не загружено — строк НЕТ и в раскрытом виде: их ещё не присылали', () => {
    const f = foldUnder({ kind: 'rest', count: 7 }, true);
    expect(f.rows).toEqual([]);
    expect(f.action).toEqual({ kind: 'load', n: 7 });
  });

  it('не загружено — предложение «запросить», а не «раскрыть»: иначе кнопка обещает мгновенное', () => {
    expect(foldUnder({ kind: 'rest', count: 7 }, false).action).toEqual({ kind: 'load', n: 7 });
  });

  it('загружено и свёрнуто — «раскрыть» без похода в сеть', () => {
    expect(foldUnder({ kind: 'here', records: three }, false).action).toEqual({ kind: 'open', n: 3 });
    expect(foldUnder({ kind: 'here', records: three }, false).rows).toEqual([]);
  });

  it('числа не назвали — «Ещё» без числа, а не выдуманное', () => {
    expect(foldUnder({ kind: 'rest', count: null }, false).action).toEqual({ kind: 'load', n: null });
  });

  it('число пришло мусором (отрицательное) — считаем «не назвали», а не печатаем «−3»', () => {
    expect(foldUnder({ kind: 'rest', count: -3 }, false).action).toEqual({ kind: 'load', n: null });
    expect(foldUnder({ kind: 'rest', count: 2.5 }, false).action).toEqual({ kind: 'load', n: null });
  });
});

describe('K2-FEED-TWO-LEVEL · честные состояния нижнего уровня', () => {
  it('«не загружено» ≠ «пусто»: у первого есть предложение, у второго — утверждение', () => {
    const notLoaded = foldUnder({ kind: 'rest', count: 4 }, false);
    const empty = foldUnder({ kind: 'here', records: [] }, true);
    expect(notLoaded.nothing).toBe(false);
    expect(empty.nothing).toBe(true);
    expect(empty.action).toEqual({ kind: 'none' });
    expect(notLoaded.action.kind).not.toBe(empty.action.kind);
  });

  it('источник назвал ноль, не загружая — это тоже проверенный ноль, и кнопки нет', () => {
    const f = foldUnder({ kind: 'rest', count: 0 }, false);
    expect(f.nothing).toBe(true);
    expect(f.action).toEqual({ kind: 'none' });
  });

  it('«нет прав» — свой исход: причина названа, повтор НЕ предлагается', () => {
    const f = foldUnder({ kind: 'forbidden', reason: 'нет доступа к источнику' }, true);
    expect(f.action).toEqual({ kind: 'denied', reason: 'нет доступа к источнику' });
    // Главное: «нет прав» не выдаёт себя за «ничего не двигалось».
    expect(f.nothing).toBe(false);
  });

  it('«не дошло» — своя причина и повтор; это НЕ «нет прав» и не «пусто»', () => {
    const f = foldUnder({ kind: 'failed', reason: 'источник не ответил' }, true);
    expect(f.action).toEqual({ kind: 'retry', reason: 'источник не ответил' });
    expect(f.nothing).toBe(false);
  });

  it('едет — «идёт», и второй раз не предлагаем', () => {
    expect(foldUnder({ kind: 'loading' }, true).action).toEqual({ kind: 'busy' });
    expect(foldUnder({ kind: 'loading' }, true).rows).toEqual([]);
  });

  it('все пять исходов названы РАЗНЫМИ словами — ни один не оттенок другого', () => {
    const kinds = new Set<string>([
      foldUnder({ kind: 'rest', count: 2 }, false).action.kind,
      foldUnder({ kind: 'here', records: three }, true).action.kind,
      foldUnder({ kind: 'loading' }, true).action.kind,
      foldUnder({ kind: 'failed', reason: 'п' }, true).action.kind,
      foldUnder({ kind: 'forbidden', reason: 'п' }, true).action.kind,
    ]);
    expect(kinds.size).toBe(5);
  });

  it('показано не всё — названо числом: «показаны 3 из 18»', () => {
    const f = foldUnder({ kind: 'here', records: three, total: 18 }, true);
    expect(f.cut).toEqual({ shown: 3, total: 18 });
  });

  it('пришло всё — про обрезку НЕ утверждаем', () => {
    expect(foldUnder({ kind: 'here', records: three, total: 3 }, true).cut).toBeNull();
    expect(foldUnder({ kind: 'here', records: three }, true).cut).toBeNull();
  });

  it('итог меньше числа строк — не верим и обрезку не выдумываем', () => {
    expect(foldUnder({ kind: 'here', records: three, total: 2 }, true).cut).toBeNull();
  });

  it('нижнего уровня у записи нет вовсе — предлагать нечего, и это не «пусто»', () => {
    const f = foldUnder(null, true);
    expect(f.rows).toEqual([]);
    expect(f.action).toEqual({ kind: 'none' });
    expect(f.nothing).toBe(false);
  });
});

describe('K2-FEED-TWO-LEVEL · уровней ровно два', () => {
  it('состояние нижнего уровня не несёт своего нижнего уровня: глубже kit не идёт', () => {
    // Договор типа: `here` отдаёт ЗАПИСИ, а не ещё одну свёртку. Проверяем это
    // на значении: иначе лента однажды поехала бы деревом неизвестной глубины,
    // а просьба владелицы была про ДВА уровня.
    const u: FeedUnder = { kind: 'here', records: three };
    for (const r of u.kind === 'here' ? u.records : []) {
      expect(Object.keys(r)).not.toContain('under');
    }
  });
});
