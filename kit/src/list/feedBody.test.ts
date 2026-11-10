// Тело записи в ленте: первые абзацы и остаток при раскрытии
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE, spec:SPEC-LORE-KIT-FEED-VIEW §5).
//
// Решение владелицы 10.11.2026, дословно: «нет в feed грузить первые 3 абзаца
// остально при расеррытии». Моё прежнее допущение «два абзаца» снято — число
// её, и оно названо ОДНИМ местом (FEED_BODY_PARAGRAPHS).
//
// Слово «грузить» здесь существенно: остаток не просто спрятан, его ЕЩЁ НЕТ.
// Поэтому у свёртки два РАЗНЫХ состояния — «остальное не загружено» и
// «загружено и скрыто», — и под телом в этих случаях предлагается разное:
// в первом запрос, во втором простое раскрытие. Один вид на оба случая врал бы
// дважды: обещал бы мгновенное раскрытие там, где будет запрос, и ходил бы в
// сеть за тем, что уже лежит рядом.
import { describe, expect, it } from 'vitest';
import { FEED_BODY_PARAGRAPHS, foldBody, type FeedBody } from './feedBody';

const p = (n: number): string[] => Array.from({ length: n }, (_, i) => `абзац ${i + 1}`);

describe('K2-FEED-BODY-MORE · потолок абзацев', () => {
  it('потолок — три, и он назван одним местом', () => {
    expect(FEED_BODY_PARAGRAPHS, 'число владелицы: «первые 3 абзаца»').toBe(3);
  });

  it('тела нет вовсе — показывать нечего и предлагать нечего', () => {
    const f = foldBody(null, false);
    expect(f.shown).toEqual([]);
    expect(f.action.kind).toBe('none');
  });

  it('тело короче потолка — весь текст виден, «Ещё» не предлагаем', () => {
    const body: FeedBody = { kind: 'full', paragraphs: p(2) };
    const f = foldBody(body, false);
    expect(f.shown).toHaveLength(2);
    expect(f.action.kind, '«Ещё» без остатка обещало бы спрятанное').toBe('none');
  });
});

describe('K2-FEED-BODY-MORE · остаток ЗАГРУЖЕН и скрыт', () => {
  const body: FeedBody = { kind: 'full', paragraphs: p(7) };

  it('свёрнуто — видны ровно первые три', () => {
    const f = foldBody(body, false);
    expect(f.shown).toEqual(['абзац 1', 'абзац 2', 'абзац 3']);
  });

  it('предлагается РАСКРЫТЬ, а не запросить: ходить в сеть за лежащим рядом незачем', () => {
    const f = foldBody(body, false);
    expect(f.action).toEqual({ kind: 'open', n: 4 });
  });

  it('раскрыто — видно всё, и можно свернуть обратно', () => {
    const f = foldBody(body, true);
    expect(f.shown).toHaveLength(7);
    expect(f.action.kind).toBe('close');
  });
});

describe('K2-FEED-BODY-MORE · остаток НЕ загружен', () => {
  it('число остатка названо приложением — его и несёт кнопка', () => {
    const body: FeedBody = { kind: 'head', paragraphs: p(3), restCount: 9 };
    expect(foldBody(body, false).action).toEqual({ kind: 'load', n: 9 });
  });

  it('числа остатка нет — «Ещё» идёт БЕЗ числа, а не с выдуманным', () => {
    const body: FeedBody = { kind: 'head', paragraphs: p(3), restCount: null };
    const a = foldBody(body, false).action;
    expect(a.kind).toBe('load');
    expect(a.kind === 'load' && a.n, 'своё число kit не придумывает').toBeNull();
  });

  it('остатка нет (0) — запрашивать нечего, «Ещё» не предлагаем', () => {
    const body: FeedBody = { kind: 'head', paragraphs: p(3), restCount: 0 };
    expect(foldBody(body, false).action.kind).toBe('none');
  });

  it('начало пришло длиннее потолка — скрытое местное считается в тот же остаток', () => {
    // Приложение прислало пять абзацев и сказало, что за ними ещё четыре:
    // спрятано 2 местных + 4 серверных = 6, и это ЧЕСТНОЕ число, а не «4».
    const body: FeedBody = { kind: 'head', paragraphs: p(5), restCount: 4 };
    expect(foldBody(body, false).action).toEqual({ kind: 'load', n: 6 });
  });

  it('раскрытие при незагруженном остатке всё ещё предлагает запрос', () => {
    const body: FeedBody = { kind: 'head', paragraphs: p(3), restCount: 9 };
    const f = foldBody(body, true);
    expect(f.shown, 'больше показать нечего — остаток ещё не пришёл').toHaveLength(3);
    expect(f.action.kind).toBe('load');
  });
});

describe('K2-FEED-BODY-MORE · остаток едет и остаток не дошёл', () => {
  it('идёт запрос — сказано «идёт», и повторно не предлагается', () => {
    const body: FeedBody = { kind: 'loading', paragraphs: p(3) };
    expect(foldBody(body, false).action.kind).toBe('busy');
  });

  it('пришедшие абзацы при запросе остатка НЕ исчезают', () => {
    const body: FeedBody = { kind: 'loading', paragraphs: p(3) };
    expect(foldBody(body, false).shown).toHaveLength(3);
  });

  it('остаток не дошёл — причина названа и предлагается повтор', () => {
    const body: FeedBody = { kind: 'failed', paragraphs: p(3), reason: 'источник не ответил' };
    expect(foldBody(body, false).action).toEqual({ kind: 'retry', reason: 'источник не ответил' });
  });

  it('сбой остатка — это НЕ «тело короткое»: начало остаётся на экране', () => {
    const body: FeedBody = { kind: 'failed', paragraphs: p(3), reason: 'источник не ответил' };
    expect(foldBody(body, false).shown).toHaveLength(3);
  });

  it('четыре состояния дают ЧЕТЫРЕ разных предложения, а не одно на все', () => {
    const kinds = new Set([
      foldBody({ kind: 'head', paragraphs: p(3), restCount: 5 }, false).action.kind,
      foldBody({ kind: 'full', paragraphs: p(7) }, false).action.kind,
      foldBody({ kind: 'loading', paragraphs: p(3) }, false).action.kind,
      foldBody({ kind: 'failed', paragraphs: p(3), reason: 'нет' }, false).action.kind,
    ]);
    expect(kinds.size, 'разные состояния остатка лечатся по-разному').toBe(4);
  });
});

describe('K2-FEED-BODY-MORE · потолок как параметр', () => {
  it('потолок можно задать иным — правило одно, число не вшито в логику', () => {
    const body: FeedBody = { kind: 'full', paragraphs: p(7) };
    expect(foldBody(body, false, 5).shown).toHaveLength(5);
    expect(foldBody(body, false, 5).action).toEqual({ kind: 'open', n: 2 });
  });

  it('потолок ноль не прячет ВСЁ тело молча: это не свёртка, а пропажа', () => {
    const body: FeedBody = { kind: 'full', paragraphs: p(3) };
    expect(foldBody(body, false, 0).shown.length, 'минимум один абзац виден').toBeGreaterThan(0);
  });
});
