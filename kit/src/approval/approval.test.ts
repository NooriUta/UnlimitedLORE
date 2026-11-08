// K-11: роли и согласование двумя людьми — чистая логика (без React).
// Окончательная проверка 4-eyes — на сервере потребителя; kit лишь не даёт
// нажать заведомо запрещённое и честно объясняет почему.
import { describe, expect, it } from 'vitest';
import type { KitConfig, KitData, KitJournalEntry, KitRecord } from '../core/contract';
import { checkTransition, journalRows, pendingProposal, rolePerms } from './approval';

const statuses: KitConfig['statuses'] = {
  items: [
    { code: 'draft', title: 'Черновик', category: 'todo', icon: 'quill', color: 'var(--t3)' },
    { code: 'fix', title: 'Нужна правка', category: 'active', icon: 'cross-mark', color: 'var(--dng)', allow: ['editor', 'methodologist'] },
    { code: 'ok', title: 'Согласовано', category: 'done', icon: 'laurel-crown', color: 'var(--suc)', allow: ['methodologist'] },
  ],
  selfApprove: false,
};

const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: {}, statuses,
  roles: {
    editor: { canEdit: true, canStatus: true },
    methodologist: { canEdit: true, canStatus: true },
    reader: { canEdit: false, canStatus: false },
  },
};

const rec: KitRecord = { id: 'Q-1', kind: 'Quiz', title: 'Квиз', status: 'fix', fields: {} };

function data(journal: KitJournalEntry[]): KitData {
  return { records: [rec], edges: [], journal, meta: { generated_at: '2026-11-07T00:00:00Z' } };
}

const proposedByAnna: KitJournalEntry = {
  at: '2026-11-07T10:00:00Z', who: 'anna', record_id: 'Q-1', field: 'question', from: 'a', to: 'b',
};

describe('rolePerms', () => {
  it('без roles в конфиге — правка и статусы разрешены (ролевой модели нет)', () => {
    expect(rolePerms({ ...config, roles: undefined }, undefined)).toMatchObject({ canEdit: true, canStatus: true, known: true });
  });
  it('известная роль берёт свои права', () => {
    expect(rolePerms(config, 'editor')).toMatchObject({ canEdit: true, canStatus: true, known: true, readOnly: false });
    expect(rolePerms(config, 'reader')).toMatchObject({ canEdit: false, canStatus: false, known: true, readOnly: true });
  });
  it('роль не опознана или не передана при заданных roles — только чтение, known:false', () => {
    expect(rolePerms(config, 'ghost')).toMatchObject({ canEdit: false, canStatus: false, known: false, readOnly: true });
    expect(rolePerms(config, undefined)).toMatchObject({ readOnly: true, known: false });
  });
});

describe('checkTransition', () => {
  const ctx = (role: string | undefined, user: string | undefined, journal: KitJournalEntry[] = []) =>
    ({ config, data: data(journal), role, user });

  it('только чтение — отказ readonly', () => {
    expect(checkTransition(ctx('reader', 'bob'), rec, 'ok')).toEqual({ ok: false, reason: 'readonly' });
  });
  it('allow ограничивает роли, которым можно ставить статус', () => {
    expect(checkTransition(ctx('editor', 'bob'), rec, 'ok')).toEqual({ ok: false, reason: 'role' });
    expect(checkTransition(ctx('editor', 'bob'), rec, 'draft').ok).toBe(true);
  });
  it('статус вне конфига — unknown-status, текущий — same', () => {
    expect(checkTransition(ctx('methodologist', 'bob'), rec, 'nope')).toEqual({ ok: false, reason: 'unknown-status' });
    expect(checkTransition(ctx('methodologist', 'bob'), rec, 'fix')).toEqual({ ok: false, reason: 'same' });
  });
  it('selfApprove:false — автор предложения не может его согласовать', () => {
    expect(checkTransition(ctx('methodologist', 'anna', [proposedByAnna]), rec, 'ok')).toEqual({ ok: false, reason: 'self' });
  });
  it('selfApprove:false — второй человек согласует, ответ помечает fourEyes', () => {
    expect(checkTransition(ctx('methodologist', 'bob', [proposedByAnna]), rec, 'ok')).toEqual({ ok: true, fourEyes: true, proposer: 'anna' });
  });
  it('selfApprove:false и пользователь неизвестен — проверить нечем, отказ no-user', () => {
    expect(checkTransition(ctx('methodologist', undefined, [proposedByAnna]), rec, 'ok')).toEqual({ ok: false, reason: 'no-user' });
  });
  it('уже согласованное предложение не блокирует автора', () => {
    const approved = { ...proposedByAnna, approved_by: 'bob' };
    expect(checkTransition(ctx('methodologist', 'anna', [approved]), rec, 'ok').ok).toBe(true);
  });
  it('selfApprove не false — согласовать своё можно', () => {
    const c = { config: { ...config, statuses: { ...statuses, selfApprove: true } }, data: data([proposedByAnna]), role: 'methodologist', user: 'anna' };
    expect(checkTransition(c, rec, 'ok')).toEqual({ ok: true, fourEyes: false });
  });
  it('переход не в done не требует второго человека', () => {
    expect(checkTransition(ctx('editor', 'anna', [proposedByAnna]), rec, 'draft')).toEqual({ ok: true, fourEyes: false });
  });
});

describe('журнал «предложил / согласовал»', () => {
  const j: KitJournalEntry[] = [
    proposedByAnna,
    { at: '2026-11-07T11:00:00Z', who: 'bot', is_agent: true, record_id: 'Q-1', field: 'hint', from: '', to: 'x', approved_by: 'bob' },
    { at: '2026-11-07T12:00:00Z', who: 'carl', record_id: 'Q-1', field: 'status', from: 'fix', to: 'ok', approved_by: 'carl' },
    { at: '2026-11-07T13:00:00Z', who: 'zoe', record_id: 'Q-2', field: 'title', from: 'a', to: 'b' },
  ];
  it('pendingProposal — последняя несогласованная правка своей записи', () => {
    expect(pendingProposal(j, 'Q-1')?.who).toBe('anna');
    expect(pendingProposal(j, 'Q-3')).toBeUndefined();
  });
  it('journalRows — только своя запись, свежие сверху, со статусом согласования', () => {
    const rows = journalRows(j, 'Q-1', false);
    expect(rows.map(r => r.state)).toEqual(['self-approved', 'approved', 'pending']);
    expect(rows[1]).toMatchObject({ proposedBy: 'bot', proposedByAgent: true, approvedBy: 'bob' });
  });
  it('при selfApprove разрешённом «сам согласовал» — не нарушение', () => {
    expect(journalRows(j, 'Q-1', true)[0].state).toBe('approved');
  });
});
