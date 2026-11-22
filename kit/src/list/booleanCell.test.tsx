// @vitest-environment jsdom
// Поле «да/нет» в списке и карточках — словами kit (kit.field.yes/no), а не сырым true/false (находка показа
// /appnew 22.11.2026: «Черновик разбора чертежа: true»). Паспорт так уже делал (RecordView), список — нет.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { KitConfig, KitData } from '../core/contract';
import { ListView } from './ListView';

afterEach(cleanup);
const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { h: { title: 'Дом', icon: 'castle', fields: [{ key: 'draft', title: 'Черновик', type: 'bool' }] } },
  statuses: { items: [{ code: 'x', title: 'икс', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list', 'cards'], columns: ['title', 'fields.draft'], showClosed: 'all' },
};
const data: KitData = { records: [
  { id: 'a', kind: 'h', title: 'Альфа', status: 'x', fields: { draft: true } },
  { id: 'b', kind: 'h', title: 'Бета', status: 'x', fields: { draft: false } },
], edges: [], journal: [], meta: { generated_at: '2026-11-22T00:00:00Z', total: 2 } };

describe('поле «да/нет» — словами', () => {
  it('в таблице — «Да» и «Нет», а не true/false', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    const cells = [...document.querySelectorAll('td.sk-list__c-fields-draft')].map((td) => td.textContent);
    expect(cells).toEqual(['Да', 'Нет']);
  });
  it('в карточках — тоже', () => {
    render(<ListView config={cfg} data={data} urlState={false} initial={{ view: 'cards' }} />);
    expect(document.body.textContent).not.toMatch(/\btrue\b|\bfalse\b/);
  });
});
