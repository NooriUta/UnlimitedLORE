// @vitest-environment jsdom
// NestedList: счёт «Показано N из M» — про СВОИ записи, а не про всю выдачу
// (SPRINT_UXR_S14_KIT5/K5-LIST-TOTAL-TRUNCATED, находка пилота «Дата-странники» 15.11.2026).
//
// Было: вкладка связи с одной записью писала «Показано 1 из 1292 — выдача обрезана
// сервером». Вложенный список получал meta всей выгрузки (total 1292) и честно сравнивал
// её с одной строкой. Обрезку выдачи называет сам паспорт (RecordLinks), своей строкой;
// вложенный список — состав записи, и его итог — его же записи.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { ListView } from './ListView';
import { NestedList } from './NestedList';

const statuses = { items: [{ code: 'open', title: 'Идёт', category: 'in_progress' as const, icon: 'play-button', color: 'var(--acc)' }] };
const kinds = { k: { title: 'Урок', icon: 'quill-ink' } };
const one: KitRecord[] = [{ id: 'L-1', kind: 'k', title: 'Феху', status: 'open', fields: {} }];

const ctxWith = (meta: KitCtx['data']['meta']): KitCtx => ({
  config: { modules: [], menu: { groups: [] }, kinds, statuses },
  data: { records: [], edges: [], journal: [], meta },
  href: id => '#' + id, esc: s => s, md: s => s,
});

describe('NestedList · итог — свои записи', () => {
  it('положительный контроль: тот же meta у списка раздела даёт «обрезано» — строка существует', () => {
    const cfg = { modules: [], menu: { groups: [] }, kinds, statuses, list: { views: ['list' as const], columns: ['status', 'id', 'title'] } };
    render(<KitLangProvider lang="ru"><ListView config={cfg} urlState={false}
      data={{ records: one, edges: [], journal: [], meta: { generated_at: '', total: 1292 } }} /></KitLangProvider>);
    expect(screen.getByTestId('kit-list-shown').getAttribute('data-kind')).toBe('truncated');
  });

  it('связь с одной записью из выгрузки в 1292 — «1 из 1», без «обрезана»', () => {
    render(<KitLangProvider lang="ru"><NestedList ctx={ctxWith({ generated_at: '', total: 1292, returned: 1292 })} records={one} /></KitLangProvider>);
    const line = screen.getByTestId('kit-list-shown');
    expect(line.getAttribute('data-kind')).not.toBe('truncated');
    expect(line.textContent).not.toContain('1292');
  });

  it('выдача обрезана сервером — вложенный список всё равно не выдаёт её за свою обрезку', () => {
    render(<KitLangProvider lang="ru"><NestedList ctx={ctxWith({ generated_at: '', total: 1292, returned: 500, truncated: true })} records={one} /></KitLangProvider>);
    expect(screen.getByTestId('kit-list-shown').getAttribute('data-kind')).not.toBe('truncated');
  });
});
