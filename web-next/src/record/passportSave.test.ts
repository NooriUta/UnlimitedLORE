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
  it('ADR: тело целиком по-прежнему не сохраняем — разделы правятся по отдельности', async () => {
    const f = vi.fn(async () => ok());
    await expect(savePassportField('adr', { id: 'ADR-1', title: 'A' }, 'body_md', 'x', f as unknown as typeof fetch)).rejects.toThrow(/раздел/);
    expect(f).not.toHaveBeenCalled();
  });
});

// S4-24: ADR правится по разделам — каждый своим полем через /lore/adr.
// Поле name обязательно: сервер перезаписывает запись целиком, и без имени
// ADR остался бы безымянным.
describe('ADR по разделам (S4-24)', () => {
  it('контекст уходит своим полем, имя обязательно', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('adr', { id: 'ADR-LORE-047', title: 'Контракт записи' }, 'context_md', 'новый контекст', f as unknown as typeof fetch);
    expect(calls(f)).toEqual([{ url: '/lore/adr', body: { adr_id: 'ADR-LORE-047', name: 'Контракт записи', context_md: 'новый контекст' } }]);
  });

  it('решение и следствия — тем же путём, каждый своим полем', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('adr', { id: 'A', title: 'И' }, 'decision_md', 'решили так', f as unknown as typeof fetch);
    await savePassportField('adr', { id: 'A', title: 'И' }, 'consequences_md', 'отсюда следует', f as unknown as typeof fetch);
    expect(calls(f).map(c => Object.keys(c.body).filter(k => k.endsWith('_md')))).toEqual([['decision_md'], ['consequences_md']]);
  });

  it('соседние разделы не затираются: шлём только изменённый', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('adr', { id: 'A', title: 'И' }, 'context_md', 'только контекст', f as unknown as typeof fetch);
    const body = calls(f)[0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('decision_md');
    expect(body).not.toHaveProperty('consequences_md');
  });

  it('без имени не отправляем вовсе: безымянный ADR хуже несохранённого', async () => {
    const f = vi.fn(async () => ok());
    await expect(savePassportField('adr', { id: 'A', title: '  ' }, 'context_md', 'текст', f as unknown as typeof fetch))
      .rejects.toThrow(/имя|name/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('пустой раздел — это очистка, а не отказ: разделы бывают пустыми', async () => {
    const f = vi.fn(async () => ok());
    await savePassportField('adr', { id: 'A', title: 'И' }, 'consequences_md', '', f as unknown as typeof fetch);
    expect(calls(f)[0].body).toMatchObject({ consequences_md: '' });
  });

  it('незнакомое поле ADR не отправляем — молча не портим запись', async () => {
    const f = vi.fn(async () => ok());
    await expect(savePassportField('adr', { id: 'A', title: 'И' }, 'status', 'accepted', f as unknown as typeof fetch)).rejects.toThrow();
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
  it('ADR правится — но по разделам, и причина говорит именно это (S4-24)', () => {
    // Раньше здесь стояло can_edit: false. С S4-24 разделы ADR правятся,
    // и причина объясняет «по разделам», а не «нельзя»: иначе человек решит,
    // что ADR не правится вовсе, и пойдёт править мимо интерфейса.
    const c = toLoreRecord(load('adr'), '2026-11-08T00:00:00Z');
    expect(c.perms.can_edit).toBe(true);
    expect(c.perms.reason).toMatch(/раздел/);
  });
});
