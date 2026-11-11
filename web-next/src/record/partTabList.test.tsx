// @vitest-environment jsdom
// Вкладка части паспорта (дети записи: задачи и спринты компонента, вопросы
// ADR…) — списком kit со стандартным управлением: поиск, фильтр, группировка,
// порядок. Слова владелицы 11.11.2026: «в паспорте, где табличный вид свёрнут
// под "ещё", должны идти стандартные сортировки, фильтры, группировки … и
// поиск тоже».
//
// Было: тело вкладки — строка имён через «·» (SPRINT_UXR_S9_SCALE_OPT/S9-05,
// «осталось»): ни статуса, ни кода, ни поиска.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitCtx } from '@seidr/kit';
import { fromLoreRecord, type LorePart, type LoreRecord1 } from './loreRecordContract';

const part = (over: Partial<LorePart>): LorePart => ({
  key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in',
  owned: true, relation: 'composition', state: 'ok', count: 0, items: [],
  ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `C/T-${i}`, title: `Задача ${i}`, status: i % 2 ? 'done' : 'active' }));

function component(parts: LorePart[]): LoreRecord1 {
  return {
    contract: 'lore.record/1',
    record: { type: 'component', id: 'C', title: 'Компонент', status: 'active', version: 'v', updated_at: '2026-11-11T00:00:00Z', updated_by: 'x' },
    schema: { type: 'component', label: 'Компонент', icon: 'gear', fields: [], tabs: [], relations: [] },
    values: {}, links: [], parts, facts: null,
    perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
    meta: { loaded_at: '2026-11-11T00:00:00Z', facade: 'server', sources: [] },
  };
}

function showTab(parts: LorePart[], key = 'tasks') {
  const l = fromLoreRecord(component(parts), 'ru');
  const ctx: KitCtx = { data: l.data, config: l.config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s };
  const tab = (l.config.kinds.component!.tabs ?? []).find(t => t.key === key)!;
  return render(<>{tab.render(l.record, ctx)}</>);
}
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('вкладка части — список kit со стандартным управлением', () => {
  it('положительный контроль: дети строками таблицы, с кодом и статусом', () => {
    showTab([part({ count: 3, items: many(3) })]);
    expect(rows().map(r => r.getAttribute('data-record-id'))).toEqual(['C/T-0', 'C/T-1', 'C/T-2']);
  });

  it('поиск сужает строки', () => {
    showTab([part({ count: 3, items: many(3) })]);
    fireEvent.change(screen.getByRole('searchbox', { name: /Текст/ }), { target: { value: 'Задача 2' } });
    expect(rows().map(r => r.getAttribute('data-record-id'))).toEqual(['C/T-2']);
  });

  it('есть фильтр, группировка и порядок', () => {
    const { container } = showTab([part({ count: 3, items: many(3) })]);
    for (const seg of ['filter', 'group', 'sort']) expect(container.querySelector(`[data-seg="${seg}"]`)).toBeTruthy();
  });

  it('пришло 100 из 230 — под списком «показаны 100 из 230» (S9-05)', () => {
    showTab([part({ count: 230, items: many(100) })]);
    expect(document.body.textContent).toContain('показаны 100 из 230');
  });

  it('положительный контроль: пришли все — оговорки нет', () => {
    showTab([part({ count: 3, items: many(3) })]);
    expect(document.body.textContent).not.toMatch(/показаны \d+ из/);
  });

  it('число неизвестно (count null) — оговорку не выдумываем', () => {
    showTab([part({ count: null, items: many(3) })]);
    expect(document.body.textContent).not.toMatch(/показаны \d+ из/);
  });

  it('детей нет — так и сказано словами, а не пустой таблицей', () => {
    showTab([part({ count: 0, items: [] })]);
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).toContain('Связей нет');
  });

  it('часть не прочиталась — причина, а не «пусто»', () => {
    showTab([part({ state: 'error', error: 'срез упал', count: null, items: [] })]);
    expect(document.body.textContent).toContain('срез упал');
  });
});
