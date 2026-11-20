// @vitest-environment jsdom
// Методика §7.8: подпись общей вкладки ассоциаций — из вида приложения (документа); нет — «Зависимости».
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitCtx, KindConfig } from '../core/contract';
import { RecordView } from './index';

beforeAll(() => registerGameIcons(gameIcons));

const ctxOf = (kind: KindConfig): KitCtx => ({
  config: { modules: [], menu: { groups: [] }, kinds: { quiz: kind }, statuses: { items: [{ code: 'open', title: 'Открыто', category: 'in_progress', icon: 'progression', color: 'var(--acc)' }] } },
  data: { records: [{ id: 'Q-1', kind: 'quiz', title: 'Квиз', status: 'open', fields: {} }, { id: 'T-1', kind: 'topic', title: 'Тема', status: 'open', fields: {} }],
    edges: [{ from: 'Q-1', to: 'T-1', type: 'QUIZ_OF' }, { from: 'Q-1', to: 'T-1', type: 'ON_TRAIL' }], journal: [], meta: { generated_at: '' } },
  href: id => '#' + id, esc: s => s, md: s => s,
});
const base: KindConfig = { title: 'Квиз', icon: 'checkbox-tree', relations: [{ key: 'topic', label: 'Тема', relation: 'association', rel: 'QUIZ_OF', dir: 'out' }] };
const tabs = () => screen.getAllByRole('tab').map(t => t.textContent ?? '');

describe('подпись группы связей (§7.8)', () => {
  it('вид назвал группу — вкладка ассоциаций подписана им', () => {
    const ctx = ctxOf({ ...base, relationGroups: { association: 'По смыслу' } });
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} />);
    expect(tabs().some(t => t.includes('По смыслу'))).toBe(true);
  });
  it('не назвал — прежняя подпись kit «Зависимости» (умолчание не меняется)', () => {
    const ctx = ctxOf(base);
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} />);
    expect(tabs().some(t => t.includes('Зависимости'))).toBe(true);
  });
});

// Пилот 16.11: при порядке разделов из модели (decided) kit не группировал связи вовсе, и каждая
// ассоциация становилась своей вкладкой («квиз руны 1», «лежит на тропах 2» — дефект приёмки ME-1).
// Правило: модель назвала связь поимённо — своя вкладка (S4-29); не назвала — общая вкладка группы.
describe('порядок из модели и общая вкладка ассоциаций', () => {
  const two: KindConfig = { title: 'Квиз', icon: 'checkbox-tree', relationGroups: { association: 'По смыслу' }, relations: [
    { key: 'topic', label: 'Квиз руны', relation: 'association', rel: 'QUIZ_OF', dir: 'out' },
    { key: 'trails', label: 'Лежит на тропах', relation: 'association', rel: 'ON_TRAIL', dir: 'out' },
  ] };
  const order = (keys: string[]) => ({ decided: true, sections: keys.map((k, i) => ({ key: k, source: 'relation' as const, ref: k, order: i, slot: 'own' as const })), notes: [] });

  it('модель связи не назвала — одна вкладка «По смыслу», а не вкладка на каждую', () => {
    const ctx = ctxOf(two);
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} sections={order(['body']) as never} />);
    const t = tabs();
    expect(t.some(x => x.includes('По смыслу'))).toBe(true);
    expect(t.some(x => x.includes('Квиз руны'))).toBe(false);
  });

  it('модель назвала связь поимённо — у неё своя вкладка (S4-29), остальные — в группе', () => {
    const ctx = ctxOf(two);
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} sections={order(['body', 'topic']) as never} />);
    const t = tabs();
    expect(t.some(x => x.includes('Квиз руны'))).toBe(true);
    expect(t.some(x => x.includes('По смыслу'))).toBe(true);
  });
});

describe('связь с пометкой shared — в общей вкладке, а не своей (§7.8 шаг 1)', () => {
  it('агрегация shared идёт во вкладку группы ассоциаций; без пометки — своя вкладка', () => {
    const k: KindConfig = { title: 'Квиз', icon: 'checkbox-tree', relationGroups: { association: 'По смыслу' }, relations: [
      { key: 'topic', label: 'Квиз руны', relation: 'association', rel: 'QUIZ_OF', dir: 'out' },
      { key: 'trails', label: 'Лежит на тропах', relation: 'aggregation', rel: 'QUIZ_OF', dir: 'out', shared: true },
    ] };
    const ctx = ctxOf(k);
    render(<RecordView record={ctx.data.records[0]} ctx={ctx} tab="" onTab={() => {}} />);
    const t = tabs();
    expect(t.some(x => x.includes('По смыслу'))).toBe(true);
    expect(t.some(x => x.includes('Лежит на тропах'))).toBe(false);
  });
});
