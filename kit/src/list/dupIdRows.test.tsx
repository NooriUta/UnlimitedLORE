// @vitest-environment jsdom
// Пилот 16.11: квиз стоит на тропе дважды (два ребра к одной записи) — в части две строки с одним id.
// Ключ строки по id давал React одинаковые ключи: поведение не определено (у пилота при открытии
// сразу на этой вкладке ряд вкладок паспорта уезжал). Ключ строки уникален и при повторе id.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { NestedList } from './NestedList';

afterEach(() => vi.restoreAllMocks());

const ctx = { config: { modules: [], menu: { groups: [] }, kinds: { quiz: { title: 'Квиз', icon: 'checkbox-tree' } }, statuses: { items: [] } },
  data: { records: [], edges: [], journal: [], meta: { generated_at: '' } }, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
const q = (side: string): KitRecord => ({ id: 'quiz:М4/1', kind: 'quiz', title: 'Квиз', status: 'open', fields: { side } });

describe('строки с одинаковым id', () => {
  it('обе строки на месте, React не жалуется на одинаковые ключи', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<KitLangProvider lang="ru"><NestedList ctx={ctx} records={[q('A'), q('B')]} columns={['id', 'fields.side']} /></KitLangProvider>);
    expect(document.querySelectorAll('tbody tr[data-record-id]').length).toBe(2);
    expect(err.mock.calls.some(c => String(c[0]).includes('same key'))).toBe(false);
  });
});
