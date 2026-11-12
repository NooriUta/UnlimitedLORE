// @vitest-environment jsdom
// Выбор из списка по группам и честное «варианты не загрузились»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица 11.11.2026: «у тебя же элемент
// с выпадающим списком учтён? … для задач исполнитель, ревьюер, автор»; сервер
// (#1241) отдаёт варианты срезом task_identities с группой kind (person / agent).
// kit: вариант может нести подпись группы — одиночный выбор рисует <optgroup>;
// варианты не пришли — поле говорит причину и даёт «Повторить», свободного ввода нет.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldEditor } from './FieldEditor';
import { RecordView } from '../record/RecordView';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

describe('enum с группами', () => {
  it('варианты с group — подписанными группами <optgroup> в порядке появления', () => {
    render(<FieldEditor def={{ key: 'executor', label: 'Исполнитель', kind: 'enum', options: [
      { value: 'olga', label: 'Ольга', group: 'Люди' }, { value: 'ivar', label: 'Ивар', group: 'Люди' },
      { value: 'AG-1', label: 'Claude Code', group: 'Агенты' },
    ] }} value={null} onChange={() => {}} />);
    const groups = [...document.querySelectorAll('optgroup')].map(g => [g.getAttribute('label'), g.querySelectorAll('option').length]);
    expect(groups).toEqual([['Люди', 2], ['Агенты', 1]]);
  });

  it('без group — плоский список, как раньше', () => {
    render(<FieldEditor def={{ key: 'p', label: 'Приоритет', kind: 'enum', options: ['high', 'low'] }} value={null} onChange={() => {}} />);
    expect(document.querySelector('optgroup')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

const rec: KitRecord = { id: 'S/T-1', kind: 'task', title: 'Задача', status: '', fields: { executor: 'olga' } };
const ctx = (cfg: KitConfig): KitCtx => ({ config: cfg, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } }, href: id => '#' + id, esc: s => s, md: s => s });

describe('паспорт: варианты не загрузились', () => {
  it('причина словами и «Повторить»; ✎ нет — свободного ввода нет', () => {
    const retry = vi.fn();
    const cfg: KitConfig = { modules: [], menu: { groups: [] }, statuses: { items: [] }, kinds: { task: { title: 'Задача', icon: 'scroll-unfurled', fields: [
      { key: 'executor', title: 'Исполнитель', type: 'enum', editable: true, optionsError: 'HTTP 502', onOptionsRetry: retry },
    ] } } };
    render(<RecordView record={rec} ctx={ctx({ ...cfg, hooks: { onSave: async () => {} } })} tab="overview" onTab={() => {}} />);
    expect(screen.getByText(/варианты не загрузились/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Править «Исполнитель»/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalled();
  });
});
