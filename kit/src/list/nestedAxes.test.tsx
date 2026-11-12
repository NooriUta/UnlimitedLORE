// @vitest-environment jsdom
// NestedList: свои оси фильтра и группировки от вызывающего
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS — третий вид «Список»).
//
// По умолчанию оси — статус (и вид, если видов больше одного): правило #1237
// не меняется. Вызывающий может назвать свои оси (исполнитель, фаза) — тогда
// они встают ПОСЛЕ умолчания, без дублей. Предметных имён нет (K-14).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { NestedList } from './NestedList';

const ctx: KitCtx = {
  config: {
    modules: [], menu: { groups: [] },
    kinds: { k: { title: 'Урок', icon: 'quill-ink', fields: [{ key: 'who', title: 'Ведёт', type: 'text' }] } },
    statuses: { items: [{ code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' }] },
  },
  data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  href: id => '#' + id, esc: s => s, md: s => s,
};
const records = [
  { id: 'L-1', kind: 'k', title: 'Феху', status: 'open', fields: { who: 'Сигрид' } },
  { id: 'L-2', kind: 'k', title: 'Уруз', status: 'open', fields: { who: 'Эйрик' } },
];

describe('NestedList · оси вызывающего', () => {
  it('по умолчанию — только статус (один вид)', () => {
    render(<KitLangProvider lang="ru"><NestedList ctx={ctx} records={records} /></KitLangProvider>);
    const seg = document.querySelector('fieldset[data-seg="filter"]') as HTMLElement;
    expect(seg.querySelectorAll('.sk-facet').length || seg.querySelectorAll('button[aria-expanded]').length).toBe(1);
  });

  it('свои оси встают после статуса: фасет «Ведёт» есть', () => {
    render(<KitLangProvider lang="ru"><NestedList ctx={ctx} records={records} axes={['fields.who']} /></KitLangProvider>);
    expect(screen.getByRole('button', { name: /^Ведёт/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Статус/ })).toBeTruthy();
  });
});
