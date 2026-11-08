// Правка на месте в паспорте (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, ADR-LORE-047 п. 14.1):
// пока нет фасада записи — через существующие пути, те же, что у MCP sprint_set / task_set / spec_set.
import { describe, expect, it, vi } from 'vitest';
import { EDITABLE_BODY, savePassportField } from './passportSave';
import { toLoreRecord } from './loreRecordContract';
import type { PassportLoad } from './passportAdapters';

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(c => ({ url: String(c[0]), body: JSON.parse(String((c[1] as RequestInit).body)) }));

describe('сохранение текста записи — существующими путями записи', () => {
  it('спринт: /lore/sprint/update с context_md', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('sprint', { id: 'SPRINT_A', title: 'Альфа' }, 'body_md', 'новый текст', f as unknown as typeof fetch);
    expect(calls(f)).toEqual([{ url: '/lore/sprint/update', body: { sprint_id: 'SPRINT_A', context_md: 'новый текст' } }]);
  });
  it('задача: /lore/task/edit с note_md и обязательным title', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('task', { id: 'SPRINT_A/A-1', title: 'Задача' }, 'body_md', 'заметка', f as unknown as typeof fetch);
    expect(calls(f)).toEqual([{ url: '/lore/task/edit', body: { task_uid: 'SPRINT_A/A-1', title: 'Задача', note_md: 'заметка' } }]);
  });
  it('спека: /lore/spec с content_md и обязательным title', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('spec', { id: 'SPEC-X', title: 'Спека' }, 'body_md', 'тело', f as unknown as typeof fetch);
    expect(calls(f)).toEqual([{ url: '/lore/spec', body: { spec_id: 'SPEC-X', title: 'Спека', content_md: 'тело' } }]);
  });
  it('ADR: тело склеено из трёх разделов — не сохраняем и говорим почему, сеть не трогаем', async () => {
    const f = vi.fn(async () => ok());
    await expect(savePassportField('adr', { id: 'ADR-1', title: 'A' }, 'body_md', 'x', f as unknown as typeof fetch)).rejects.toThrow(/раздел/);
    expect(f).not.toHaveBeenCalled();
  });
  it('ошибка сервера доходит до паспорта со статусом, а не «сохранено»', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'FORBIDDEN', detail: 'нет прав' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    await expect(savePassportField('sprint', { id: 'S', title: 'S' }, 'body_md', 'x', f as unknown as typeof fetch)).rejects.toMatchObject({ status: 403 });
  });
});

describe('контракт: право править — по типу, с честной причиной', () => {
  const load = (kind: string): PassportLoad => ({
    record: { id: 'X', kind, title: 'X', status: 'planned', fields: {} },
    data: { records: [], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } },
    config: { modules: [], menu: { groups: [] }, kinds: { [kind]: { title: kind, icon: 'help', fields: [] } }, statuses: { items: [] } },
  });
  it('спринт, задача, спека — текст правится; причина говорит, что проверки версии ещё нет', () => {
    for (const k of ['Sprint', 'task', 'spec']) {
      const c = toLoreRecord(load(k), '2026-11-08T00:00:00Z');
      expect(c.perms.can_edit).toBe(true);
      expect(c.perms.reason).toMatch(/верси/);
    }
    expect(EDITABLE_BODY).toEqual(['sprint', 'task', 'spec']);
  });
  it('ADR — только чтение с причиной', () => {
    const c = toLoreRecord(load('adr'), '2026-11-08T00:00:00Z');
    expect(c.perms.can_edit).toBe(false);
    expect(c.perms.reason).toMatch(/раздел/);
  });
});
