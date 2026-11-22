// @vitest-environment jsdom
// «Часть скрыта правами» — в строке «Показано» самого списка (SPRINT_UXR_S15_KIT6; владелица 21.11.2026, страница
// «Чего нет в kit», пункт 5): «Показано 8 из 8» без счёта скрытого читается как «больше записей нет».
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const cfg = { modules: [], menu: { groups: [] }, kinds: { room: { title: 'Комнаты', icon: 'house' } },
  statuses: { items: [{ code: 'shared', title: 'общая', category: 'active', icon: 'house', color: 'var(--t2)' }] },
  list: { views: ['list'] } } as unknown as KitConfig;
const recs: KitRecord[] = [1, 2, 3].map((i) => ({ id: `r${i}`, kind: 'room', title: `Комната ${i}`, status: 'shared', fields: {} }));
const data = (meta: Partial<KitData['meta']>): KitData => ({ records: recs, edges: [], journal: [], meta: { generated_at: '2026-11-21T00:00:00Z', total: 3, ...meta } });

describe('ListView: скрыто правами', () => {
  it('meta.hidden — в строке «Показано» словами с числом', () => {
    render(<ListView config={cfg} data={data({ hidden: 4 })} urlState={false} />);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 3 из 3 · ещё 4 скрыты правами');
  });
  it('нет скрытых — строка прежняя', () => {
    render(<ListView config={cfg} data={data({})} urlState={false} />);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 3 из 3');
  });
});
