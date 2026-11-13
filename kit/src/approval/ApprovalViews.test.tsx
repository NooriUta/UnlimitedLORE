// @vitest-environment jsdom
// K-11: UI ролей и согласования двумя людьми — роль «только чтение» прячет
// правку, запрещённый статус виден с причиной, журнал «предложил / согласовал».
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KitConfig, KitData, KitJournalEntry, KitRecord } from '../core/contract';
import { ApprovalJournal, EditGate, StatusActions } from './ApprovalViews';
import { KitLangProvider } from '../i18n';

const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: {},
  statuses: {
    items: [
      { code: 'draft', title: 'Черновик', category: 'todo', icon: 'quill', color: 'var(--t3)' },
      { code: 'fix', title: 'Нужна правка', category: 'active', icon: 'cross-mark', color: 'var(--dng)' },
      { code: 'ok', title: 'Согласовано', category: 'done', icon: 'laurel-crown', color: 'var(--suc)', allow: ['methodologist'] },
    ],
    selfApprove: false,
  },
  roles: {
    methodologist: { canEdit: true, canStatus: true },
    editor: { canEdit: true, canStatus: true },
    reader: { canEdit: false, canStatus: false },
  },
};
const rec: KitRecord = { id: 'Q-1', kind: 'Quiz', title: 'Квиз', status: 'fix', fields: {} };
const journal: KitJournalEntry[] = [
  { at: '2026-11-07T10:00:00Z', who: 'anna', record_id: 'Q-1', field: 'question', from: 'a', to: 'b' },
  { at: '2026-11-07T11:00:00Z', who: 'bot', is_agent: true, record_id: 'Q-1', field: 'hint', from: '', to: 'x', approved_by: 'bob' },
];
const data = (j: KitJournalEntry[] = journal): KitData => ({ records: [rec], edges: [], journal: j, meta: { generated_at: 'x' } });
const ctx = (role?: string, user?: string, j?: KitJournalEntry[], cfg: KitConfig = config) => ({ config: cfg, data: data(j), role, user });

describe('EditGate', () => {
  it('роль «только чтение» прячет правку и показывает пилюлю', () => {
    render(<EditGate ctx={ctx('reader', 'r')}><button>Править</button></EditGate>);
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull();
    expect(screen.getByText('Только чтение')).toBeTruthy();
  });
  it('роль с правкой видит детей', () => {
    render(<EditGate ctx={ctx('editor', 'e')}><button>Править</button></EditGate>);
    expect(screen.getByRole('button', { name: 'Править' })).toBeTruthy();
  });
  it('неопознанная роль — только чтение с явной причиной', () => {
    render(<EditGate ctx={ctx('ghost', 'g')}><button>Править</button></EditGate>);
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull();
    expect(screen.getByText(/не опознана/)).toBeTruthy();
  });
});

describe('StatusActions', () => {
  it('только чтение — кнопок смены статуса нет', () => {
    render(<StatusActions ctx={ctx('reader', 'r')} record={rec} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Только чтение')).toBeTruthy();
  });
  it('автор предложения: «Согласовано» выключено с причиной про второго человека', () => {
    render(<StatusActions ctx={ctx('methodologist', 'anna')} record={rec} />);
    const ok = screen.getByRole('button', { name: /Согласовано/ }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    expect(ok.getAttribute('data-deny')).toBe('self');
    expect(screen.getByText(/второй человек/)).toBeTruthy();
    // текущий статус не предлагается
    expect(screen.queryByRole('button', { name: /Нужна правка/ })).toBeNull();
  });
  it('роль вне allow — кнопка выключена с причиной роли', () => {
    render(<StatusActions ctx={ctx('editor', 'e')} record={rec} />);
    const ok = screen.getByRole('button', { name: /Согласовано/ }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    expect(ok.getAttribute('data-deny')).toBe('role');
  });
  it('второй человек согласует: зовёт onSave с переходом статуса', async () => {
    const onSave = vi.fn(async () => {});
    render(<StatusActions ctx={ctx('methodologist', 'bob', undefined, { ...config, hooks: { onSave } })} record={rec} />);
    const ok = screen.getByRole('button', { name: /Согласовано/ }) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ type: 'status', id: 'Q-1', field: 'status', from: 'fix', to: 'ok' }));
    expect(screen.getByText(/окончательно проверяет сервер/)).toBeTruthy();
  });
  it('отказ сервера виден как ошибка, а не тихий успех', async () => {
    const onSave = vi.fn(async () => { throw new Error('4-eyes: self approve'); });
    render(<StatusActions ctx={ctx('methodologist', 'bob', undefined, { ...config, hooks: { onSave } })} record={rec} />);
    fireEvent.click(screen.getByRole('button', { name: /Согласовано/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('4-eyes: self approve');
  });
});

describe('ApprovalJournal', () => {
  it('столбцы «предложил / согласовал», ожидание и агент видны', () => {
    render(<ApprovalJournal ctx={ctx('reader', 'r')} recordId="Q-1" />);
    expect(screen.getByRole('columnheader', { name: 'Предложил' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Согласовал' })).toBeTruthy();
    expect(screen.getByText('ждёт согласования')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText(/бот/)).toBeTruthy();
  });
  it('пустой журнал — проверенный ноль, не ошибка', () => {
    const { container } = render(<ApprovalJournal ctx={ctx('reader', 'r', [])} recordId="Q-1" />);
    expect(container.querySelector('[data-state="empty"]')).toBeTruthy();
  });
  it('английская локаль', () => {
    render(<KitLangProvider lang="en"><ApprovalJournal ctx={ctx('reader', 'r')} recordId="Q-1" /></KitLangProvider>);
    expect(screen.getByRole('columnheader', { name: 'Proposed by' })).toBeTruthy();
  });
});
