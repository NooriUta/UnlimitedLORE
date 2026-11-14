// @vitest-environment jsdom
// SPRINT_LORE_MODEL_AS_CONFIG/MC-07 — приёмка v1.17.21 (14.11.2026): в паспорте человека вкладка
// «Задачи» показывала «?» вместо числа.
//
// Корень (доказан этим тестом): фасад читает задачи человека срезом user_tasks и отдаёт первые
// 100 (TAB_FIRST_PAGE); у владелицы открытых ролей больше — строка meta.data_state приходит
// `state: truncated` с полным `total`. fromLoreRecord складывал в meta.errors ВСЕ источники с
// state !== 'ok', то есть и обрезанный. kit считает блок из errors сбоем, если о нём не сказано
// как о сбое раньше, — и счётчик вкладки становился «не смогли посчитать».
//
// Правило: «обрезано» — не сбой. Число вкладки — полное, если источник его назвал; «?» остаётся
// только для настоящего сбоя или отказа в правах.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordView, type KitCtx, type PassportOrder } from '@seidr/kit';
import { recordFromServer } from '../api/liveRecord';
import { fromLoreRecord } from './loreRecordContract';

const tasks = (n: number) => Array.from({ length: n }, (_, i) => ({
  rel: 'ROLE_HELD_BY', dir: 'in', id: `S/T-${i + 1}`, type: 'task', title: `Задача ${i + 1}`, status: 'active',
}));

const person = (n: number, tasksState: Record<string, unknown>) => recordFromServer({
  contract: 'lore.record/1',
  record: { type: 'user', id: 'kc-1', title: 'Алекса', status: '', version: null, updated_at: null, updated_by: null },
  schema: {
    type: 'user', label: 'Человек', icon: 'person', fields: [], tabs: [],
    relations: [{ key: 'tasks', label: 'Задачи', relation: 'association', rel: 'ROLE_HELD_BY', dir: 'in', place: 'link_tab', target_type: 'task' }],
  },
  values: { title: 'Алекса' },
  links: tasks(n),
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { data_state: [{ source: 'user_by_id', state: 'ok' }, { source: 'user_tasks', part: 'tasks', ...tasksState }] },
}, '2026-11-14T00:00:00Z');

function tasksCount(n: number, tasksState: Record<string, unknown>): HTMLElement | null {
  const { record, data, config } = fromLoreRecord(person(n, tasksState), 'ru');
  const ctx = { config, data, href: () => undefined } as unknown as KitCtx;
  // Порядок разделов решён моделью (как в ListPassport): вкладка связи — своим ключом «tasks».
  const sections: PassportOrder = { decided: true, notes: [], sections: [
    { key: 'tasks', source: 'relation', ref: 'tasks', order: 1, slot: 'own', group: null },
  ] };
  render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} sections={sections} />);
  const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes('Задачи'));
  expect(tab, 'вкладки «Задачи» в ряду нет').toBeTruthy();
  return tab!.querySelector('.sk-tab__count');
}

describe('MC-07 · «Задачи» в паспорте человека — число, а не «?»', () => {
  it('положительный контроль: прочитано целиком — число задач', () => {
    expect(tasksCount(3, { state: 'ok' })?.textContent).toBe('3');
  });

  it('обрезано (первые 100 из 230) — «обрезано» не сбой: в meta.errors его нет', () => {
    const { data } = fromLoreRecord(person(100, { state: 'truncated', has_more: true, shown: 100, total: 230 }), 'ru');
    const errors = (data.meta as { errors?: { block: string }[] }).errors ?? [];
    expect(errors.map(e => e.block)).not.toContain('user_tasks · tasks');
  });

  it('обрезано — во вкладке полное число из data_state, а не «?» и не 100', () => {
    expect(tasksCount(100, { state: 'truncated', has_more: true, shown: 100, total: 230 })?.textContent).toBe('230');
  });

  it('обрезано без названного total — число загруженных, не «?»', () => {
    expect(tasksCount(100, { state: 'truncated', has_more: true, shown: 100 })?.textContent).toBe('100');
  });

  it('настоящий сбой среза — «?» остаётся', () => {
    expect(tasksCount(0, { state: 'error', reason: 'user_tasks: timeout' })?.textContent).toBe('?');
  });

  it('нет прав — «?» остаётся', () => {
    expect(tasksCount(0, { state: 'forbidden', reason: 'скоуп' })?.textContent).toBe('?');
  });
});
