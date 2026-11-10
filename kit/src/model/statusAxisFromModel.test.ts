// Перевод категории статуса из модели знает ВСЮ ось LORE (B2 ревью 10.11.2026).
//
// Находка ревью (прод v1.17.9): «todo/planned/backlog/design — категория
// not_started неизвестна → показан как в работе». То есть на каждом экране
// «не начато» рисовалось «в работе», и рядом шумело предупреждение.
//
// ПРИЧИНА — расхождение двух мест в самом kit. Ось владелицы объявлена в
// `core/statusAxis.ts` шестью значениями (`not_started · in_progress ·
// in_force · finished · withdrawn · unknown`) и зеркалит канон сервера
// (`LoreStatusCategory`). А перевод документа в конфиг (`configFromModel`)
// держал СВОЙ список из четырёх значений и трёх синонимов, где `not_started`,
// `in_force` и `unknown` отсутствовали вовсе. Незнакомое падало в «в работе».
//
// Это тот же класс, что K-14 со статусными цветами в трёх местах: один факт,
// записанный дважды, расходится молча.
import { describe, expect, it } from 'vitest';
import { configFromModel } from './configFromModel';
import { parseModel } from './loadModel';
import { LORE_STATUS_AXIS } from '../core/statusAxis';

const ICON = 'compass';

/** Документ модели с одной статьёй статуса заданной категории. */
const docWith = (category: string) => parseModel({
  format: 'model/0',
  version: '2026-11-10T00:00:00Z',
  statuses: {
    task: { entries: [{ code: 'x', title: 'Икс', category, icon: ICON, color: 'var(--st-active)' }] },
  },
});

const categoryOf = (raw: string) => configFromModel(docWith(raw), { statusDict: 'task' }).statuses[0].category;
const notesOf = (raw: string) => configFromModel(docWith(raw), { statusDict: 'task' }).notes.statuses.join(' ');

describe('B2 · категория статуса из модели', () => {
  it('положительный контроль: статья разобрана, категория есть', () => {
    const r = configFromModel(docWith('in_progress'), { statusDict: 'task' });
    expect(r.statuses).toHaveLength(1);
    expect(r.statuses[0].category).toBe('active');
  });

  it('«не начато» — это НЕ «в работе»', () => {
    expect(categoryOf('not_started')).toBe('todo');
  });

  it('«действует» не попадает в завершённые: принятое живёт, а не лежит в архиве', () => {
    // Контракт kit знает четыре категории, и отдельного «действует» в нём нет.
    // Пока его нет, «действует» идёт как открытое — но НЕ как закрытое: ADR,
    // показанный завершённым, перестают считать обязательным (см. statusAxis).
    expect(categoryOf('in_force')).toBe('active');
  });

  it('«завершено» и «снято» переводятся по оси', () => {
    expect(categoryOf('finished')).toBe('done');
    expect(categoryOf('withdrawn')).toBe('cancelled');
  });

  it('каждое значение оси переводится, и ни одно не молчит про «неизвестно»', () => {
    for (const axis of LORE_STATUS_AXIS) {
      if (axis === 'unknown') continue;
      expect(['todo', 'active', 'done', 'cancelled'], axis).toContain(categoryOf(axis));
      expect(notesOf(axis), `${axis}: оговорки быть не должно`).not.toMatch(/категория/i);
    }
  });

  it('прежние четыре значения kit продолжают работать — конфиги до решения об оси', () => {
    expect(categoryOf('todo')).toBe('todo');
    expect(categoryOf('active')).toBe('active');
    expect(categoryOf('done')).toBe('done');
    expect(categoryOf('cancelled')).toBe('cancelled');
  });

  it('«unknown» из оси — это честное «неизвестно», и оно НАЗВАНО', () => {
    expect(categoryOf('unknown')).toBe('active');
    expect(notesOf('unknown')).toMatch(/неизвестн/i);
  });

  it('чужое слово вне оси — тоже названо, а не спрятано в «готово»', () => {
    expect(categoryOf('отгружено')).toBe('active');
    expect(notesOf('отгружено')).toMatch(/отгружено/);
  });

  it('точка расширения приложения сильнее оси: своя ось переводится своим правилом', () => {
    const r = configFromModel(docWith('отгружено'), {
      statusDict: 'task',
      categoryOf: raw => (raw === 'отгружено' ? 'done' : undefined),
    });
    expect(r.statuses[0].category).toBe('done');
  });
});
