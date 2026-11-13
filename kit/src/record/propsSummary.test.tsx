// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-16 — в свёрнутой строке «▸ Свойства · …» паспорта во весь экран
// стоял сырой JSON {"value":7.5,"known":13,"of":13}: сводка печатала каждое значение одним
// valueText, не глядя на вид поля, а итог спринта (вид sum) — объект. Правило: сводка
// форматирует значение по виду поля тем же текстом, что и вкладка «Свойства»; объект, у которого
// своего вида нет, в сводку не попадает — JSON в строке не бывает никогда.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'sprint',
      fields: [
        { key: 'priority', title: 'Приоритет', type: 'text' },
        { key: 'effort_total', title: 'Оценка', type: 'sum' },
        { key: 'actual_total', title: 'Факт', type: 'sum' },
        { key: 'blob', title: 'Неизвестный объект', type: 'text' },
      ],
    },
  },
  statuses: { items: [] },
};

const rec: KitRecord = {
  id: 'SPRINT_X', kind: 'sprint', title: 'Спринт', status: '', fields: {
    priority: 'critical',
    effort_total: { value: 7.5, known: 13, of: 13 },
    actual_total: { value: null, known: 0, of: 13 },
    blob: { a: 1 },
  },
};
const ctx: KitCtx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-13T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s };

describe('PU-16 · сводка «Свойства» без сырого JSON', () => {
  const summary = () => {
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    return container.querySelector('details.sk-rec-propsrow summary')!.textContent ?? '';
  };

  it('ни одного «{» в свёрнутой строке', () => {
    expect(summary()).not.toContain('{');
  });

  it('итоги — тем же текстом, что во вкладке: число и «не заполнено»', () => {
    const s = summary();
    expect(s).toMatch(/7[,.]5/);
    expect(s).toContain('не заполнено');
    expect(s).toContain('critical');
  });
});
