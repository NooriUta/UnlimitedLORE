import { describe, expect, it, vi } from 'vitest';
import { collect } from './writeToolHarness.js';

// 05.11.2026 (сессия Völva): task_new отвергал effort_days — «Unrecognized key»,
// хотя task_set то же поле принимает. Оценку нельзя было задать при создании,
// а чекер качества тут же ставил задаче «missing: effort_days». Семь задач за
// смену получили упрёк на пустом месте.
//
// Правило, а не кейс: всё, что task_set умеет записать о задаче, task_new
// обязан принять при создании и донести до бэкенда. Исключения — только поля,
// которых у создания нет по смыслу (адрес задачи и пакетный режим).

const sent: { path: string; body: unknown }[] = [];
vi.mock('../backend.js', () => ({
  ACTIVE_PROJECT: undefined,
  lorePost: vi.fn(async (path: string, body: unknown) => { sent.push({ path, body }); return { ok: true }; }),
  loreGet: vi.fn(async () => ({ ok: true, rows: [] })),
  loreUpload: vi.fn(async () => ({ ok: true })),
}));

const { registerLoreWrite } = await import('./loreWrite.js');

// note_append (MT-NOTE-APPEND): дописка к СУЩЕСТВУЮЩЕЙ заметке — у создаваемой
// задачи заметки ещё нет, при создании её задаёт note_md.
const NOT_FOR_CREATE = new Set(['task_uid', 'tasks', 'note_append']);

describe('task_new принимает всё, что task_set пишет о задаче', () => {
  const tools = collect(registerLoreWrite);
  const byName = (n: string) => tools.find(t => t.name === n);

  it('схема task_new — надмножество полей задачи из task_set', () => {
    const tn = byName('task_new');
    const ts = byName('task_set');
    expect(tn, 'task_new найден').toBeTruthy();
    expect(ts, 'task_set найден').toBeTruthy();
    const setFields = Object.keys(ts!.schema).filter(k => !NOT_FOR_CREATE.has(k));
    expect(setFields).toContain('effort_days');   // положительный контроль: сравниваем не пустоту
    const missing = setFields.filter(k => !(k in tn!.schema));
    expect(missing).toEqual([]);
  });

  it('effort_days из task_new доходит до тела запроса создания', async () => {
    sent.length = 0;
    await byName('task_new')!.handler({ sprint_id: 'SPRINT_X', task_id: 'T-1', title: 't', effort_days: 0.125 });
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('/lore/task');
    expect((sent[0].body as Record<string, unknown>).effort_days).toBe(0.125);
  });
});
