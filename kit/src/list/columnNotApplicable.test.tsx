// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35 — колонка, которой у типа НЕТ.
//
// Список бывает смешанным по типам. Колонка «Релиз» у спринта осмысленна, у
// ADR такого поля нет вовсе — и печатать там «—» значит утверждать «значения
// нет», то есть путать «поле не заполнено» с «поля не бывает». Это тот же
// класс, что «не смогли проверить» ≠ «пусто», только на уровне ячейки.
//
// Правило: тип объявил свои поля (`KindConfig.fields`) и колонки среди них
// нет → ячейка говорит «нет у типа» (другим видом и подсказкой). Тип полей не
// объявил → kit судить не берётся и печатает как раньше: утверждать нечем.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: { title: 'Спринт', icon: 'cog', fields: [{ key: 'release', title: 'Релиз', type: 'ref' }] },
    adr: { title: 'ADR', icon: 'scroll-quill', fields: [{ key: 'area', title: 'Область', type: 'enum' }] },
    loose: { title: 'Без схемы', icon: 'cog' },
  },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns: ['title+id', 'fields.release'], showClosed: 'all' },
};
const rec = (id: string, kind: string, fields: Record<string, unknown>): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'todo', fields });
const dataOf = (rs: KitRecord[]): KitData => ({ records: rs, edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z', total: rs.length } });
const releaseCell = (id: string) => {
  const row = document.querySelector(`[data-record-id="${id}"]`) as HTMLElement;
  return row.querySelector('.sk-list__c-fields-release') as HTMLElement;
};

describe('S4-35 · колонка, которой у типа нет', () => {
  const data = dataOf([
    rec('S1', 'sprint', { release: 'v1.17' }),
    rec('S2', 'sprint', {}),
    rec('A1', 'adr', { area: 'ui' }),
    rec('L1', 'loose', {}),
  ]);

  it('положительный контроль: у типа есть поле и значение — значение', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    expect(releaseCell('S1').textContent).toContain('v1.17');
  });

  it('у типа поле есть, значения нет — «—», как и было', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    expect(releaseCell('S2').textContent).toBe('—');
  });

  it('у типа такого поля нет — «нет у типа», а не «—»', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    const c = releaseCell('A1');
    expect(c.textContent).not.toBe('—');
    const na = c.querySelector('.sk-list__na') as HTMLElement;
    expect(na).toBeTruthy();
    expect(na.getAttribute('title')).toBe('У типа «ADR» нет поля «Релиз»');
  });

  it('тип полей не объявил — судить не о чем, печатается как раньше', () => {
    render(<ListView config={config} data={data} urlState={false} />);
    const c = releaseCell('L1');
    expect(c.textContent).toBe('—');
    expect(c.querySelector('.sk-list__na')).toBeNull();
  });
});
