// @vitest-environment jsdom
// Запись с телом в ленте: шапка, первые абзацы, вклеенный список относящегося
// и свёртка «Ещё N» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE,
// spec:SPEC-LORE-KIT-FEED-VIEW §5).
//
// Повод — владелица 09.11.2026: «для решений хорошо, а ADR так сэмулируй — у
// тебя должен появиться „Ещё"». Число абзацев названо ею 10.11.2026: «нет в
// feed грузить первые 3 абзаца остально при расеррытии», и слово «грузить»
// значит, что остаток ЗАПРАШИВАЕТСЯ, а не просто спрятан.
//
// Что здесь проверяется помимо разметки:
//   • «Ещё» без числа, когда числа не назвали, — вместо выдуманного;
//   • запрос остатка идёт РОВНО ОДИН раз и только когда остаток в источнике;
//   • сбой остатка назван причиной, а начало с экрана не исчезает;
//   • вклеенный список рисуется ТЕМ ЖЕ блоком, что у паспорта, а не похожим.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import type { FeedBody } from './feedBody';
import type { FeedFields } from './feedModel';

const rec = (id: string, updated_at: string): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: {}, updated_at });

const cfg = (): KitConfig => ({
  modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  edges: { BECAUSE: { label: 'Повод', color: 'var(--acc)' } },
  list: {
    views: ['list', 'feed'],
    columns: ['title+id'],
    showClosed: 'all',
    feed: { timeField: 'updated_at', because: ['BECAUSE'] } satisfies FeedFields,
  },
});

const NOW = '2026-11-10T12:00:00Z';
const rs = [rec('a', '2026-11-10T11:00:00Z'), rec('b', '2026-11-10T09:00:00Z')];

const data = (edges: KitData['edges'] = []): KitData => ({
  records: rs, edges, journal: [], meta: { generated_at: NOW, total: rs.length },
});

const p = (n: number): string[] => Array.from({ length: n }, (_, i) => `абзац ${i + 1} записи`);

/** Лента открыта, тело задано только у записи «a». */
function feed(body: FeedBody | null, onFeedBody?: (id: string) => void, edges: KitData['edges'] = []) {
  const r = render(
    <ListView
      config={cfg()}
      data={data(edges)}
      urlState={false}
      initial={{ view: 'feed' }}
      feedBody={rr => (rr.id === 'a' ? body : null)}
      onFeedBody={onFeedBody}
    />,
  );
  return r;
}

const item = (c: HTMLElement, id: string) => c.querySelector(`[data-record-id="${id}"]`) as HTMLElement;
const paras = (c: HTMLElement, id: string) => [...item(c, id).querySelectorAll('.sk-feed__para')].map(e => e.textContent?.trim());
const more = (c: HTMLElement, id: string) => item(c, id).querySelector('.sk-feed__bodymore') as HTMLElement | null;

describe('K2-FEED-BODY-MORE · шапка и первые абзацы', () => {
  it('положительный контроль: лента открыта и записи на месте', () => {
    const { container } = feed(null);
    expect(container.querySelector('.sk-feed')).toBeTruthy();
    expect(item(container, 'a')).toBeTruthy();
  });

  it('тело показано началом: три абзаца, не больше', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(7) });
    expect(paras(container, 'a')).toEqual(['абзац 1 записи', 'абзац 2 записи', 'абзац 3 записи']);
  });

  it('у записи БЕЗ тела блока тела нет: пустая рамка обещала бы текст', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(7) });
    expect(item(container, 'b').querySelector('.sk-feed__body')).toBeNull();
  });

  it('шапка записи остаётся на месте — тело её не вытесняет', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(7) });
    expect(within(item(container, 'a')).getByText('Запись a')).toBeTruthy();
  });
});

describe('K2-FEED-BODY-MORE · «Ещё N» называет число', () => {
  it('остаток загружен — «Ещё» несёт его число и раскрывает НА МЕСТЕ', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(7) });
    const b = more(container, 'a')!;
    expect(b.textContent).toMatch(/4/);
    fireEvent.click(b);
    expect(paras(container, 'a')).toHaveLength(7);
  });

  it('раскрытое сворачивается обратно', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(7) });
    fireEvent.click(more(container, 'a')!);
    fireEvent.click(more(container, 'a')!);
    expect(paras(container, 'a')).toHaveLength(3);
  });

  it('остаток в источнике — число приложения, и нажатие ЗАПРАШИВАЕТ его', () => {
    const onFeedBody = vi.fn();
    const { container } = feed({ kind: 'head', paragraphs: p(3), restCount: 9 }, onFeedBody);
    const b = more(container, 'a')!;
    expect(b.textContent).toMatch(/9/);
    fireEvent.click(b);
    expect(onFeedBody).toHaveBeenCalledWith('a');
  });

  it('числа остатка не назвали — «Ещё» БЕЗ числа, и сказано, что число неизвестно', () => {
    const { container } = feed({ kind: 'head', paragraphs: p(3), restCount: null }, () => {});
    const b = more(container, 'a')!;
    expect(b.textContent, 'выдуманного числа быть не должно').not.toMatch(/\d/);
    expect((b.getAttribute('title') ?? '') + (b.getAttribute('aria-label') ?? '')).not.toBe('');
  });

  it('остатка нет — «Ещё» не предлагаем вовсе', () => {
    const { container } = feed({ kind: 'head', paragraphs: p(2), restCount: 0 });
    expect(more(container, 'a')).toBeNull();
  });

  it('обработчика запроса нет — «Ещё» при незагруженном остатке не предлагаем: кнопка обещала бы действие, которого нет', () => {
    const { container } = feed({ kind: 'head', paragraphs: p(3), restCount: 9 });
    expect(more(container, 'a')).toBeNull();
  });
});

describe('K2-FEED-BODY-MORE · остаток едет и остаток не дошёл', () => {
  it('идёт запрос — сказано словами, и повторно не стреляет', () => {
    const onFeedBody = vi.fn();
    const { container } = feed({ kind: 'loading', paragraphs: p(3) }, onFeedBody);
    const b = more(container, 'a')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(b);
    expect(onFeedBody).not.toHaveBeenCalled();
  });

  it('остаток не дошёл — причина НА ЭКРАНЕ, а не только в данных', () => {
    const { container } = feed({ kind: 'failed', paragraphs: p(3), reason: 'источник не ответил' }, () => {});
    expect(within(item(container, 'a')).getByText(/источник не ответил/)).toBeTruthy();
  });

  it('после сбоя начало остаётся на экране и предлагается повтор', () => {
    const onFeedBody = vi.fn();
    const { container } = feed({ kind: 'failed', paragraphs: p(3), reason: 'источник не ответил' }, onFeedBody);
    expect(paras(container, 'a')).toHaveLength(3);
    fireEvent.click(more(container, 'a')!);
    expect(onFeedBody).toHaveBeenCalledWith('a');
  });

  it('«не дошёл остаток» и «тело короткое» выглядят РАЗНО', () => {
    const fail = feed({ kind: 'failed', paragraphs: p(3), reason: 'источник не ответил' }, () => {});
    const failed = item(fail.container, 'a').querySelector('.sk-feed__bodyfail');
    fail.unmount();
    const short = feed({ kind: 'full', paragraphs: p(2) });
    expect(failed, 'у сбоя остатка своя строка').toBeTruthy();
    expect(item(short.container, 'a').querySelector('.sk-feed__bodyfail')).toBeNull();
  });
});

describe('K2-FEED-BODY-MORE · вклеенный список относящегося', () => {
  const edges: KitData['edges'] = [
    { from: 'a', to: 'b', type: 'BECAUSE' },
    { from: 'a', to: 'zz', type: 'BECAUSE' },
  ];

  it('у записи с телом относящееся идёт БЛОКОМ с числом в заголовке', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(3) }, undefined, edges);
    const glue = item(container, 'a').querySelector('.sk-rec-glue');
    expect(glue, 'блок относящегося должен быть').toBeTruthy();
    expect(glue!.querySelector('.sk-rec-glue__head')!.textContent).toMatch(/2/);
  });

  it('блок — ТОТ ЖЕ, что у паспорта: своего класса лента не заводит', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(3) }, undefined, edges);
    expect(item(container, 'a').querySelector('[class*="sk-feed__glue"]'), 'второй механизм свёртки/вклейки').toBeNull();
  });

  it('относящегося нет — блока нет: пустой заголовок с нулём ничего не объясняет', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(3) }, undefined, []);
    expect(item(container, 'a').querySelector('.sk-rec-glue')).toBeNull();
  });

  it('незагруженная связанная запись показана КОДОМ, а не выдуманным заголовком', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(3) }, undefined, edges);
    const glue = item(container, 'a').querySelector('.sk-rec-glue')!;
    expect(glue.textContent).toMatch(/zz/);
  });

  it('у записи без тела блока относящегося нет — там строка, а не история', () => {
    const { container } = feed({ kind: 'full', paragraphs: p(3) }, undefined, [
      { from: 'b', to: 'a', type: 'BECAUSE' },
    ]);
    expect(item(container, 'b').querySelector('.sk-rec-glue')).toBeNull();
  });
});

// Владелица 11.11.2026: «в Ленте feed не используется рендеринг MartProse,
// исправь» и «по факту лента — это лента паспортов». Тело в ленте — тот же
// MD, что в паспорте, и читается тем же рендером: сырые «**» и «- » в ленте
// при отрисованном паспорте — два разных вида одного текста.
describe('тело в ленте рендерится MartProse, как в паспорте', () => {
  it('MD в абзаце разобран: жирный — <strong>, список — <li>, звёздочек в тексте нет', () => {
    const { container } = feed({ kind: 'full', paragraphs: ['Это **важно** и `код`', '- пункт один\n- пункт два'] });
    const body = item(container, 'a').querySelector('.sk-feed__body') as HTMLElement;
    expect(body.querySelector('.sk-prose')).toBeTruthy();
    expect(body.querySelector('strong')?.textContent).toBe('важно');
    expect(body.querySelector('code')?.textContent).toBe('код');
    expect([...body.querySelectorAll('li')].map(l => l.textContent)).toEqual(['пункт один', 'пункт два']);
    expect(body.textContent).not.toContain('**');
  });
});
