// Правка текста на месте не должна исчезнуть при переходе на фасад
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST, регрессия моего же #963).
//
// **Что я сломал.** Эмуляция из срезов укладывала текст записи в `body_md`:
// у спринта — `context_md`, у задачи — `note_md`, у спеки — `content_md`.
// `fromLoreRecord` правит только `body_md`, а все прочие поля группы `body`
// рисует разделами ТОЛЬКО ДЛЯ ЧТЕНИЯ. Фасад называет поля своими именами
// (`LoreRecordRegistry`: sprint → context_md + outcome_md, task → note_md,
// spec → content_md), поэтому после подмены источника текст стал разделом, и
// кнопка ✎ у спринта, задачи и спеки пропала.
//
// Снаружи это выглядело как «правку убрали» — ровно тот класс, который я весь
// день и чинил, только теперь внесённый мной.
//
// **Почему правится так.** Первое правимое поле группы `body` становится телом
// записи — в точности как делала эмуляция, поэтому раскладка не меняется и
// путь записи остаётся прежним (`payload()` уже переводит `body_md` в
// `context_md` / `note_md` / `content_md` по типу). Остальные поля группы
// (у спринта — «Итог») остаются разделами, как и были.
//
// **У ADR — НЕ так, и это намеренно.** Его тело склеено из трёх разделов, и
// одним полем его не сохранить, не затерев соседние (ADR_BODY_READONLY).
// Поэтому у ADR тела записи не появляется: три раздела остаются разделами.
import { describe, expect, it } from 'vitest';
import { recordFromServer } from '../api/liveRecord';
import { fromLoreRecord } from './loreRecordContract';

const LOADED = '2026-11-09T04:00:00.000Z';

const body = (type: string, fields: { key: string; label: string; editable: boolean }[], values: Record<string, unknown>) => ({
  contract: 'lore.record/1',
  record: { type, id: 'ID-1', title: 'Запись', status: 'active', version: 'V1' },
  values,
  parts: [], links: [],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: {
    type, label: 'Вид', label_key: 'k', icon: 'i', layout: {}, relations: [],
    fields: fields.map(f => ({ ...f, label_key: 'k', kind: 'md', group: 'body', required: false })),
  },
  meta: { facade: 'server', sources: { block: [] }, data_state: [] },
});

const contractOf = (b: unknown) => recordFromServer(b, LOADED);

describe('S4-MODEL-PASSPORT-LIST · тело записи осталось правимым', () => {
  it('положительный контроль: контракт собрался', () => {
    const c = contractOf(body('sprint', [{ key: 'context_md', label: 'Контекст', editable: true }], { context_md: 'текст' }));
    expect(c.record.type).toBe('sprint');
  });

  it('спринт: «Контекст» становится телом записи — kit снова даёт его править', () => {
    const c = contractOf(body('sprint', [
      { key: 'context_md', label: 'Контекст', editable: true },
      { key: 'outcome_md', label: 'Итог', editable: true },
    ], { context_md: 'контекст', outcome_md: 'итог' }));
    expect(c.values.body_md).toBe('контекст');
    const view = fromLoreRecord(c, 'ru');
    expect(view.record.body_md).toBe('контекст');
  });

  it('второе поле тела остаётся разделом — как было до перехода', () => {
    const c = contractOf(body('sprint', [
      { key: 'context_md', label: 'Контекст', editable: true },
      { key: 'outcome_md', label: 'Итог', editable: true },
    ], { context_md: 'контекст', outcome_md: 'итог' }));
    // Раздел остался в схеме и в значениях — его рисует обзор, читать можно.
    expect(c.schema.fields.some(f => f.key === 'outcome_md')).toBe(true);
    expect(c.values.outcome_md).toBe('итог');
    // А первое поле больше не задвоено разделом.
    expect(c.schema.fields.some(f => f.key === 'context_md')).toBe(false);
  });

  it('задача: «Заметка» — тело записи', () => {
    const c = contractOf(body('task', [{ key: 'note_md', label: 'Заметка', editable: true }], { note_md: 'заметка' }));
    expect(c.values.body_md).toBe('заметка');
  });

  it('спека: «Текст» — тело записи', () => {
    const c = contractOf(body('spec', [{ key: 'content_md', label: 'Текст', editable: true }], { content_md: 'текст спеки' }));
    expect(c.values.body_md).toBe('текст спеки');
  });

  it('ADR: три раздела остаются разделами — склеенное тело не сохранить', () => {
    const c = contractOf(body('adr', [
      { key: 'context_md', label: 'Контекст', editable: true },
      { key: 'decision_md', label: 'Решение', editable: true },
      { key: 'consequences_md', label: 'Следствия', editable: true },
    ], { context_md: 'к', decision_md: 'р', consequences_md: 'с' }));
    expect(c.values.body_md).toBeUndefined();
    expect(c.schema.fields.map(f => f.key)).toEqual(['context_md', 'decision_md', 'consequences_md']);
  });

  it('поле тела только для чтения телом записи не становится: править его нельзя', () => {
    const c = contractOf(body('sprint', [{ key: 'context_md', label: 'Контекст', editable: false }], { context_md: 'текст' }));
    expect(c.values.body_md).toBeUndefined();
    expect(c.schema.fields.some(f => f.key === 'context_md')).toBe(true);
  });

  it('сервер сам прислал body_md — ничего не переносим', () => {
    const c = contractOf(body('sprint', [{ key: 'body_md', label: 'Текст', editable: true }], { body_md: 'как есть' }));
    expect(c.values.body_md).toBe('как есть');
  });
});
