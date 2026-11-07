// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-05 — статус-поповер «2 касания» (S → 1…9, отмена)
// и хуки сохранения: localStorage по умолчанию, подмена на API (hooks.onSave),
// onSave → Promise с откатом при отказе.
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../index';
import type { KitConfig, KitRecord } from './contract';
import {
  StatusChip, StatusPopover, canChangeStatus, createLocalSave, resolveSave, statusColor, statusTargets,
} from './index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const statuses: KitConfig['statuses'] = {
  items: [
    { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--t3', allow: ['active', 'cancelled'] },
    { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'acc' },
    { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)', hotkey: 'D' },
    { code: 'cancelled', title: 'Отменено', category: 'cancelled', icon: '✗', color: '--dng' },
  ],
  undo: true,
};

const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: {}, statuses,
  roles: { viewer: { canEdit: false, canStatus: false }, editor: { canEdit: true, canStatus: true } },
};

const rec = (status = 'todo'): KitRecord => ({ id: 'T-1', kind: 'task', title: 'Задача', status, fields: {} });

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, get length() { return m.size; },
  } as Storage;
}

describe('statusTargets — допустимые переходы и клавиши 1…9', () => {
  it('allow текущего статуса ограничивает цели; текущий не предлагается', () => {
    const t = statusTargets(statuses, 'todo');
    expect(t.map(x => x.item.code)).toEqual(['active', 'cancelled']);
    expect(t.map(x => x.key)).toEqual(['1', '2']);
  });

  it('без allow — все, кроме текущего; свой hotkey статуса важнее номера', () => {
    const t = statusTargets(statuses, 'active');
    expect(t.map(x => x.item.code)).toEqual(['todo', 'done', 'cancelled']);
    expect(t.map(x => x.key)).toEqual(['1', 'D', '3']);
  });

  it('больше 9 целей — у десятой и далее номера нет (клавиш 1…9)', () => {
    const many: KitConfig['statuses'] = {
      items: Array.from({ length: 11 }, (_, i) => ({ code: `s${i}`, title: `S${i}`, category: 'todo' as const, icon: 'help', color: 't3' })),
    };
    const t = statusTargets(many, 's0');
    expect(t).toHaveLength(10);
    expect(t[8].key).toBe('9');
    expect(t[9].key).toBe('');
  });

  it('неизвестный текущий статус — предлагаются все известные (выход из сбоя)', () => {
    expect(statusTargets(statuses, 'ghost').map(x => x.item.code)).toEqual(['todo', 'active', 'done', 'cancelled']);
  });
});

describe('statusColor — цвет только токеном', () => {
  it('«--x», «x» и «var(--x)» сводятся к var(--x)', () => {
    expect(statusColor('--dng')).toBe('var(--dng)');
    expect(statusColor('acc')).toBe('var(--acc)');
    expect(statusColor('var(--suc)')).toBe('var(--suc)');
  });
  it('пусто — нейтральный --t3', () => {
    expect(statusColor('')).toBe('var(--t3)');
  });
});

describe('canChangeStatus — роль', () => {
  it('без ролей в конфиге — можно; роль с canStatus=false — нельзя; неизвестная роль — нельзя', () => {
    expect(canChangeStatus({ ...config, roles: undefined })).toBe(true);
    expect(canChangeStatus(config, 'editor')).toBe(true);
    expect(canChangeStatus(config, 'viewer')).toBe(false);
    expect(canChangeStatus(config, 'stranger')).toBe(false);
  });
});

describe('хуки сохранения: localStorage по умолчанию, подмена на API', () => {
  it('локальное сохранение пишет правку и накладывает её на записи', async () => {
    const backing = memStorage();
    const local = createLocalSave({ getBacking: () => backing, key: 'test.edits' });
    await local.save({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
    expect(JSON.parse(backing.getItem('test.edits')!)).toEqual({ 'T-1': { status: 'active' } });
    const [applied] = local.apply([rec('todo')]);
    expect(applied.status).toBe('active');
    expect(local.persistent).toBe(true);
  });

  it('правка обычного поля ложится в fields', async () => {
    const local = createLocalSave({ getBacking: () => memStorage() });
    await local.save({ type: 'field', id: 'T-1', field: 'owner', from: null, to: 'ann' });
    expect(local.apply([rec()])[0].fields.owner).toBe('ann');
  });

  it('хранилище недоступно — работаем в памяти, persistent=false (честно, без падения)', async () => {
    const local = createLocalSave({ getBacking: () => { throw new Error('SecurityError'); } });
    await expect(local.save({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'done' })).resolves.toBeUndefined();
    expect(local.persistent).toBe(false);
    expect(local.apply([rec()])[0].status).toBe('done');
  });

  it('hooks.onSave есть — сохранение идёт в API, локальное не трогается', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const backing = memStorage();
    const local = createLocalSave({ getBacking: () => backing, key: 'k' });
    const save = resolveSave({ onSave }, local);
    await save({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
    expect(onSave).toHaveBeenCalledWith({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
    expect(backing.getItem('k')).toBeNull();
  });

  it('hooks.onSave нет — сохранение локальное', async () => {
    const backing = memStorage();
    const local = createLocalSave({ getBacking: () => backing, key: 'k' });
    await resolveSave(undefined, local)({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
    expect(backing.getItem('k')).not.toBeNull();
  });
});

describe('StatusPopover — «2 касания»: цифра выбирает, Esc/кнопка отменяют', () => {
  it('пункты пронумерованы, цифра 1 выбирает первый допустимый', async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(<StatusPopover statuses={statuses} current="todo" onPick={onPick} onCancel={onCancel} />);
    const menu = screen.getByRole('menu');
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual(['В работе1', 'Отменено2']);
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    fireEvent.keyDown(menu, { code: 'Digit2', key: '2' });
    expect(onPick).toHaveBeenCalledWith('cancelled');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('свой hotkey статуса (D) тоже выбирает; клавиша по e.code — работает в русской раскладке', () => {
    const onPick = vi.fn();
    render(<StatusPopover statuses={statuses} current="active" onPick={onPick} onCancel={() => {}} />);
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'KeyD', key: 'в' });
    expect(onPick).toHaveBeenCalledWith('done');
  });

  it('Escape и кнопка «Отмена» — onCancel, без выбора', () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<StatusPopover statuses={statuses} current="todo" onPick={onPick} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Escape', key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('нет допустимых переходов — честный текст, не пустое меню', () => {
    const closed: KitConfig['statuses'] = { items: [{ code: 'x', title: 'X', category: 'done', icon: 'help', color: 't3', allow: [] }] };
    render(<StatusPopover statuses={closed} current="x" onPick={() => {}} onCancel={() => {}} />);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByText(/Нет допустимых переходов/)).toBeTruthy();
  });
});

describe('StatusChip — чип статуса в списке и в записи', () => {
  it('показывает статус из конфига; клик → меню; цифра → оптимистичная смена и onSave', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    const { container } = render(<StatusChip record={rec()} config={config} save={save} onChange={onChange} />);
    const chip = screen.getByRole('button', { name: /Статус: К работе/ });
    expect(chip.getAttribute('data-category')).toBe('todo');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit1', key: '1' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Статус: В работе/ })).toBeTruthy();
    expect(save).toHaveBeenCalledWith({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('active'));
  });

  it('onSave отклонён — откат к прежнему статусу и видимая ошибка', async () => {
    let reject!: (e: Error) => void;
    const save = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    render(<StatusChip record={rec()} config={config} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: /Статус: К работе/ }));
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit1', key: '1' });
    const pending = screen.getByRole('button', { name: /Статус: В работе/ });
    expect(pending.getAttribute('aria-busy')).toBe('true');
    await act(async () => { reject(new Error('HTTP 500')); });
    expect(screen.getByRole('button', { name: /Статус: К работе/ })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/HTTP 500/);
  });

  it('undo в конфиге — после смены кнопка «Вернуть» сохраняет обратный переход', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={config} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: /Статус: К работе/ }));
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit1', key: '1' });
    const undo = await screen.findByRole('button', { name: /Вернуть/ });
    await act(async () => { fireEvent.click(undo); });
    expect(save).toHaveBeenLastCalledWith({ type: 'status', id: 'T-1', field: 'status', from: 'active', to: 'todo' });
    expect(screen.getByRole('button', { name: /Статус: К работе/ })).toBeTruthy();
  });

  it('в записи (hotkey): S открывает меню, цифра выбирает — ровно 2 нажатия', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={config} save={save} hotkey />);
    fireEvent.keyDown(document, { code: 'KeyS', key: 'ы' });
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit2', key: '2' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ to: 'cancelled' }));
  });

  it('S в поле ввода не перехватывается; в списке (без hotkey) S ничего не открывает', () => {
    render(<div><input aria-label="поиск" /><StatusChip record={rec()} config={config} save={vi.fn()} hotkey /></div>);
    fireEvent.keyDown(screen.getByLabelText('поиск'), { code: 'KeyS', key: 's' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('роль без canStatus — только показ (role=img), без кнопки', () => {
    render(<StatusChip record={rec()} config={config} save={vi.fn()} role="viewer" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: /Статус: К работе/ })).toBeTruthy();
  });

  it('статус вне конфига — показан честно как неизвестный, не подменён первым', () => {
    render(<StatusChip record={rec('ghost')} config={config} save={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /Статус: ghost/ });
    expect(chip.getAttribute('data-category')).toBe('unknown');
  });

  it('пустой код статуса (как «не смотрели» у Дата-странников) — допустим, если есть в конфиге', () => {
    const dw: KitConfig = { ...config, roles: undefined, statuses: { items: [
      { code: '', title: 'не смотрели', category: 'todo', icon: '○', color: '--t3' },
      { code: 'ok', title: 'согласовано', category: 'done', icon: '✓', color: '--suc' },
    ] } };
    render(<StatusChip record={rec('')} config={dw} save={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Статус: не смотрели/ })).toBeTruthy();
  });
});
