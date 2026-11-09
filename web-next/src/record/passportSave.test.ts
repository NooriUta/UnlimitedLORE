// Правка на месте в паспорте (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, ADR-LORE-047 п. 14.1):
// пока нет фасада записи — через существующие пути, те же, что у MCP sprint_set / task_set / spec_set.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('S5-06 · путь записи РАЗДЕЛА берётся из схемы сервера (write)', () => {
  // Замечание серверной сессии 09.11, проверенное по её реестру
  // (LoreRecordRegistry:532): у каждого раздела тела свой `write {endpoint,
  // field}`. У спринта разделов ДВА — «Контекст» и «Итог», — и таблица «тип →
  // одно поле» молча не записала бы «Итог». Поэтому путь приходит данными.
  const calls: { url: string; body: unknown }[] = [];
  const net = (() => async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  })() as unknown as typeof fetch;

  beforeEach(() => { calls.length = 0; });

  it('положительный контроль: «Итог» спринта уходит своим полем по своему пути', async () => {
    await savePassportField(
      'sprint', { id: 'SP', title: 'Спринт' }, 'outcome_md', 'Итог работ', net, null,
      { endpoint: '/lore/sprint/update', field: 'outcome_md' },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/lore/sprint/update');
    expect(calls[0].body).toMatchObject({ sprint_id: 'SP', outcome_md: 'Итог работ' });
  });

  it('раздел ADR уходит своим полем, имя записи обязательно', async () => {
    await savePassportField(
      'adr', { id: 'ADR-1', title: 'Решение' }, 'decision_md', 'Текст', net, null,
      { endpoint: '/lore/adr', field: 'decision_md' },
    );
    expect(calls[0].body).toMatchObject({ adr_id: 'ADR-1', name: 'Решение', decision_md: 'Текст' });
  });

  it('без имени записи правка НЕ уходит — лучше не сохранить, чем сохранить безымянным', async () => {
    await expect(savePassportField(
      'adr', { id: 'ADR-1', title: '   ' }, 'decision_md', 'Текст', net, null,
      { endpoint: '/lore/adr', field: 'decision_md' },
    )).rejects.toThrow(/имя/);
    expect(calls).toHaveLength(0);
  });

  it('write не передан — прежний путь по склеенному телу (эмуляция)', async () => {
    await savePassportField('task', { id: 'SP/T1', title: 'Задача' }, 'body_md', 'Заметка', net, null);
    expect(calls[0].url).toContain('/lore/task/edit');
    expect(calls[0].body).toMatchObject({ task_uid: 'SP/T1', note_md: 'Заметка' });
  });
});
