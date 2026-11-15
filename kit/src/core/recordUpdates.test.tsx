// @vitest-environment jsdom
// Событие «запись обновлена» (SPRINT_UXR_S14_KIT5/K5-RECORD-UPDATED-EVENT).
//
// Слово владелицы 15.11.2026: «сделать hook: когда паспорт правится или правится его статус
// объекта, возвращаемой части — событие обновления, и обновлять элемент». Запись видна сразу в
// нескольких местах (строка списка, строка части в паспорте родителя). До правки после смены
// статуса в паспорте обновлялся только паспорт; остальное показывало старое до перезагрузки.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from './contract';
import { publishRecordUpdate, subscribeRecordUpdates, usePatchedData } from './recordUpdates';
import { useStatusChange } from './useStatusChange';
import { ListView } from '../list/ListView';

const rec = (id: string, status: string, fields: Record<string, unknown> = {}): KitRecord => ({ id, kind: 'k', title: id, status, fields });
const data = (records: KitRecord[]): KitData => ({ records, edges: [], journal: [], meta: { generated_at: '' } });

afterEach(() => vi.restoreAllMocks());

describe('шина записей', () => {
  it('подписчик получает событие; отписка — больше не получает', () => {
    const got: unknown[] = [];
    const off = subscribeRecordUpdates(e => got.push(e));
    publishRecordUpdate({ id: 'A', field: 'status', value: 'done' });
    off();
    publishRecordUpdate({ id: 'A', field: 'status', value: 'active' });
    expect(got).toEqual([{ id: 'A', field: 'status', value: 'done' }]);
  });

  it('usePatchedData: статус, заголовок и поле накладываются на запись с тем же id', () => {
    const d = data([rec('A', 'active'), rec('B', 'active')]);
    const { result } = renderHook(() => usePatchedData(d));
    act(() => {
      publishRecordUpdate({ id: 'A', field: 'status', value: 'done' });
      publishRecordUpdate({ id: 'A', field: 'title', value: 'Новое имя' });
      publishRecordUpdate({ id: 'A', field: 'effort', value: 3 });
      publishRecordUpdate({ id: 'Z', field: 'status', value: 'done' }); // записи нет в данных — ничего
    });
    expect(result.current.records[0]).toMatchObject({ id: 'A', status: 'done', title: 'Новое имя', fields: { effort: 3 } });
    expect(result.current.records[1].status).toBe('active');
    expect(result.current.records).toHaveLength(2);
  });

  it('свежие данные от приложения главнее накопленных правок', () => {
    let d = data([rec('A', 'active')]);
    const { result, rerender } = renderHook(() => usePatchedData(d));
    act(() => publishRecordUpdate({ id: 'A', field: 'status', value: 'done' }));
    d = data([rec('A', 'blocked')]);
    rerender();
    expect(result.current.records[0].status).toBe('blocked');
  });
});

describe('издатель: смена статуса', () => {
  it('сервер принял — событие; отказал — события нет, элемент прежний', async () => {
    const got: unknown[] = [];
    const off = subscribeRecordUpdates(e => got.push(e));
    const ok = renderHook(() => useStatusChange(rec('A', 'active'), async () => {}));
    await act(async () => { await ok.result.current.change('done'); });
    const bad = renderHook(() => useStatusChange(rec('B', 'active'), async () => { throw new Error('нет прав'); }));
    await act(async () => { await bad.result.current.change('done'); });
    off();
    expect(got).toEqual([{ id: 'A', field: 'status', value: 'done' }]);
  });
});

describe('подписчик: строка списка', () => {
  it('после смены статуса записи в паспорте строка списка показывает новый статус без перезагрузки', () => {
    const cfg = {
      modules: [], menu: { groups: [] }, kinds: { k: { title: 'К', icon: 'quill-ink' } },
      statuses: { items: [
        { code: 'active', title: 'В работе', category: 'in_progress', icon: 'progression', color: 'var(--acc)' },
        { code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' },
      ] },
      list: { views: ['list'], columns: ['status', 'id', 'title'], showClosed: 'all' },
    } as unknown as KitConfig;
    render(<ListView config={cfg} data={data([rec('A', 'active')])} urlState={false} />);
    const statusOf = () => document.querySelector('[data-status]')?.getAttribute('data-status') ?? document.body.innerHTML.slice(0, 3000);
    expect(statusOf()).toBe('active');
    act(() => publishRecordUpdate({ id: 'A', field: 'status', value: 'done' }));
    expect(statusOf()).toBe('done');
  });
});
