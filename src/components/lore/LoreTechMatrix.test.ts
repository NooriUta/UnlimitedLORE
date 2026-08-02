import { describe, it, expect } from 'vitest';
import { buildRow, sharedTechs } from './LoreTechMatrix';
import type { LoreTechRow } from '../../api/lore';

const row = (tech: string, version: string | null, checkedAt: string | null): LoreTechRow => ({
  spec_id: `SPEC-TECH-X-${tech}`,
  tech_name: tech,
  version,
  content_md: null,
  checked_at: checkedAt,
  component_id: 'X',
});

const fresh = new Date().toISOString();
const old = '2020-01-01T00:00:00Z';

describe('buildRow', () => {
  it('ставит версию в колонку своей технологии, остальные оставляет пустыми', () => {
    const cells = buildRow([row('React', '19.2.7', fresh)], ['React', 'Vite']);
    expect(cells.map(c => [c.tech, c.present, c.version])).toEqual([
      ['React', true, '19.2.7'],
      ['Vite', false, null],
    ]);
  });

  it('помечает устаревшую запись, не теряя версию', () => {
    const [cell] = buildRow([row('ArcadeDB', '26.7.2', old)], ['ArcadeDB']);
    expect(cell.present).toBe(true);
    expect(cell.version).toBe('26.7.2');
    expect(cell.stale).toBe(true);
  });

  it('свежая запись не помечается устаревшей', () => {
    const [cell] = buildRow([row('ArcadeDB', '26.7.2', fresh)], ['ArcadeDB']);
    expect(cell.stale).toBe(false);
  });

  // checked_at отсутствует у части легаси-записей — их нельзя показывать
  // как актуальные: «неизвестно когда проверяли» ближе к «давно», чем к «сейчас».
  it('запись без даты проверки считается устаревшей', () => {
    const [cell] = buildRow([row('nginx', '1.31-alpine', null)], ['nginx']);
    expect(cell.stale).toBe(true);
  });

  it('компонент без единой технологии даёт строку из пустых ячеек', () => {
    const cells = buildRow([], ['React', 'Vite']);
    expect(cells.every(c => !c.present && c.version === null)).toBe(true);
  });

  it('технология, которой нет среди колонок, не ломает строку', () => {
    const cells = buildRow([row('zustand', '5.0.14', fresh)], ['React']);
    expect(cells).toHaveLength(1);
    expect(cells[0].present).toBe(false);
  });

  // Реестр не запрещает две записи одной технологии у одного компонента,
  // а ячейка в матрице ровно одна — берём первую и не молчим об этом в коде.
  it('дубль технологии схлопывается в первую запись', () => {
    const cells = buildRow(
      [row('Java', '21', fresh), row('Java', '25', fresh)],
      ['Java'],
    );
    expect(cells[0].version).toBe('21');
  });

  it('пустое имя технологии игнорируется', () => {
    const cells = buildRow([{ ...row('', '1.0', fresh), tech_name: '' }], ['React']);
    expect(cells[0].present).toBe(false);
  });
});

describe('sharedTechs', () => {
  it('оставляет только встречающиеся минимум в двух компонентах', () => {
    expect(sharedTechs(['React', 'zustand', 'Java'], { React: 4, zustand: 1, Java: 6 }))
      .toEqual(['React', 'Java']);
  });

  it('технология без счётчика считается единичной', () => {
    expect(sharedTechs(['React'], {})).toEqual([]);
  });

  it('порог настраивается', () => {
    expect(sharedTechs(['React', 'Java'], { React: 4, Java: 6 }, 5)).toEqual(['Java']);
  });
});
