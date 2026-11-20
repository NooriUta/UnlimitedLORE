// @vitest-environment jsdom
// Пустые вкладки связей не занимают ряд (SPRINT_UXR_S14_KIT5/K5-EMPTY-LINK-TABS).
//
// Повод — пилот «Дата-странники» (сессия 696ed81e): на карточке topic:0.1 в ряду
// стояли «→ требует 0» и «→ подтема 0»; сессия мобильного кита (a1c7981d) — на
// телефоне в строку встаёт не больше четырёх вкладок. Методика паспорта §7.4.2:
// «пустая вкладка связей и пустая часть ряд не занимают».
//
// Развилка, которую держат эти тесты: прятать нулевую вкладку СОВСЕМ нельзя —
// «связей нет» и «не смогли проверить» обязаны оставаться различимыми. Поэтому:
//   • успешно прочитанный ноль — под «Ещё» (доступна, со своим «0»);
//   • «не загрузилось» и «нет доступа» — в ряду, со счётчиком «?», как прежде;
//   • открытая вкладка в ряду всегда, даже пустая.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitMeta, KitRecord } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const host = r('T-1', 'topic', 'Тема');
const records = [host, r('T-2', 'topic', 'Соседняя тема')];
// Одна связь есть («ссылается»), у «требует» и «подтема» — ноль.
const edges = [{ from: 'T-1', to: 'T-2', type: 'REFERS' }];

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    topic: {
      title: 'Тема', icon: 'scroll-quill',
      relations: [
        { key: 'refers', label: 'Ссылается', relation: 'aggregation', rel: 'REFERS', dir: 'out' },
        { key: 'requires', label: 'Требует', relation: 'aggregation', rel: 'REQUIRES', dir: 'out' },
        { key: 'subtopic', label: 'Подтема', relation: 'aggregation', rel: 'SUBTOPIC', dir: 'out' },
      ],
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};

const ctxOf = (meta: Record<string, unknown> = {}): KitCtx => ({
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-20T00:00:00Z', ...meta } as unknown as KitMeta },
});

const view = (tab = 'overview', meta: Record<string, unknown> = {}, sections?: PassportOrder) =>
  render(<RecordView record={host} ctx={ctxOf(meta)} tab={tab} onTab={() => {}} placement="bottom" sections={sections} />);

const rowNames = () => screen.getAllByRole('tab').map(t => (t.textContent ?? '').replace(/[◆◇⇢▷△]/g, ''));
const inRow = (label: string) => rowNames().some(n => n.startsWith(label));
const moreItem = (label: RegExp) => {
  fireEvent.click(screen.getByRole('tab', { name: /Ещё/ }));
  return within(screen.getByRole('menu', { name: 'Ещё' })).getByRole('menuitem', { name: label });
};

describe('K5-EMPTY-LINK-TABS · пустая вкладка связей уходит под «Ещё»', () => {
  it('положительный контроль: вкладка с непустой связью стоит в ряду со своим числом', () => {
    view();
    expect(inRow('Ссылается')).toBe(true);
  });

  it('вкладки с прочитанным нулём в ряду не стоят', () => {
    view();
    expect(inRow('Требует')).toBe(false);
    expect(inRow('Подтема')).toBe(false);
  });

  it('пустая вкладка не удалена: она под «Ещё» и со своим «0»', () => {
    view();
    const item = moreItem(/Требует/);
    expect(item.querySelector('.sk-tab__count')?.textContent).toBe('0');
  });

  it('открытая пустая вкладка остаётся в ряду — прятать читаемое нельзя', () => {
    view('requires');
    expect(inRow('Требует')).toBe(true);
  });

  it('«не загрузилось» — вкладка В РЯДУ со счётчиком «?», а не под «Ещё» как пустая', () => {
    view('overview', { data_state: [{ source: 'requires', state: 'error', reason: 'срез отдал 502' }] });
    expect(inRow('Требует')).toBe(true);
    const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes('Требует'))!;
    expect(tab.querySelector('.sk-tab__count')?.textContent).toBe('?');
  });

  it('«нет доступа» — тоже в ряду со счётчиком «?»', () => {
    view('overview', { data_state: [{ source: 'subtopic', state: 'forbidden', reason: 'нет прав' }] });
    expect(inRow('Подтема')).toBe(true);
    const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes('Подтема'))!;
    expect(tab.querySelector('.sk-tab__count')?.textContent).toBe('?');
  });

  it('группа связей с суммой ноль — под «Ещё»; с непроверенным разделом — в ряду', () => {
    const grouped = (): PassportOrder => ({
      decided: true, notes: [],
      sections: [
        { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
        { key: 'refers', source: 'relation', ref: 'REFERS', order: 2, slot: 'own', group: null },
        { key: 'requires', source: 'relation', ref: 'REQUIRES', order: 3, slot: 'own', group: { key: 'deps', label: 'Зависимости' } },
        { key: 'subtopic', source: 'relation', ref: 'SUBTOPIC', order: 4, slot: 'own', group: { key: 'deps', label: 'Зависимости' } },
      ],
    });
    const { unmount } = view('overview', {}, grouped());
    expect(inRow('Зависимости')).toBe(false);
    unmount();
    view('overview', { data_state: [{ source: 'requires', state: 'error', reason: '502' }] }, grouped());
    expect(inRow('Зависимости')).toBe(true);
  });
  it('вкладку части от приложения с тем же ключом правило не трогает: «Требует 0» вида — в ряду', () => {
    const cfg: KitConfig = { ...config, kinds: { topic: { ...config.kinds.topic, tabs: [{ key: 'requires', title: 'Требует', count: 0, render: () => 'часть' }] } } };
    render(<RecordView record={host} ctx={{ ...ctxOf(), config: cfg }} tab="overview" onTab={() => {}} placement="bottom" />);
    expect(inRow('Требует')).toBe(true);
    // А связь без двойника-вкладки по-прежнему уходит под «Ещё».
    expect(inRow('Подтема')).toBe(false);
  });
});
