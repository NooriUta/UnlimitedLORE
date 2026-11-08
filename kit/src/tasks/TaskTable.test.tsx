// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-02 — таблица задач спринта: атрибуты в строке,
// статус в 2 касания (звезда → пункт палитры), правка в строке, группировка.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { KitLangProvider, registerGameIcons, TaskTable, type TaskPhase, type TaskRowData } from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const phases: TaskPhase[] = [
  { uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 },
  { uid: 'ph-2', id: 'P2', title: 'Сборка', order: 2 },
];

const tasks: TaskRowData[] = [
  { uid: 'u1', id: 'S5-01', title: 'Паспорт спринта', status: 'active', phase: 'ph-1', effortDays: 2, executor: 'claude', reviewer: 'owner', taskType: 'feature', workClass: 'enb', order: 1 },
  { uid: 'u2', id: 'S5-02', title: 'Вкладка задач', status: 'todo', phase: 'ph-2', effortDays: 1.5, executor: null, reviewer: null, taskType: null, workClass: null, order: 2 },
  { uid: 'u3', id: 'S5-03', title: 'Готовое', status: 'done', phase: 'ph-2', effortDays: null, executor: 'codex', reviewer: 'claude', taskType: 'bug', workClass: 'uc', order: 3 },
];

describe('TaskTable · атрибуты видны в строке', () => {
  it('у каждой задачи — строка с id, заголовком, статусом, оценкой и ролями', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи спринта" />);
    const table = screen.getByRole('table', { name: 'Задачи спринта' });
    const row = within(table).getByRole('row', { name: /S5-01/ });
    expect(within(row).getByText('Паспорт спринта')).toBeTruthy();
    expect(within(row).getByRole('img', { name: /Статус: в работе/ })).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('claude')).toBeTruthy();
    expect(within(row).getByText('owner')).toBeTruthy();
    expect(within(row).getByText('feature')).toBeTruthy();
    // Шапка таблицы — заголовки колонок.
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(
      expect.arrayContaining(['Статус', 'ID', 'Задача', 'Фаза', 'Оценка, д', 'Исполнитель', 'Ревьюер', 'Тип']),
    );
  });

  it('пустое значение — прочерк, а не пустая ячейка', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" />);
    const row = screen.getByRole('row', { name: /S5-02/ });
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('id задачи — ссылка, если экран дал hrefFor', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" hrefFor={t => `?section=tasks&passport=${t.id}`} />);
    const link = screen.getByRole('link', { name: 'S5-01' });
    expect(link.getAttribute('href')).toBe('?section=tasks&passport=S5-01');
  });

  it('по-английски — английские заголовки и имена статусов', () => {
    render(<KitLangProvider lang="en"><TaskTable tasks={tasks} phases={phases} groupBy="none" label="Tasks" /></KitLangProvider>);
    expect(screen.getByRole('columnheader', { name: 'Executor' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Status: in progress/ })).toBeTruthy();
  });
});

describe('TaskTable · группировка', () => {
  it('по фазе — шапки групп с числом задач, колонка «Фаза» скрыта', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="phase" label="Задачи" />);
    const heads = screen.getAllByRole('rowheader').map(h => h.textContent);
    expect(heads[0]).toMatch(/P1 · Разведка/);
    expect(heads[0]).toMatch(/1/);
    expect(heads[1]).toMatch(/P2 · Сборка/);
    expect(heads[1]).toMatch(/2/);
    expect(screen.queryByRole('columnheader', { name: 'Фаза' })).toBeNull();
  });

  it('по статусу — группы по категориям жизненного цикла', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="status" label="Задачи" />);
    const heads = screen.getAllByRole('rowheader').map(h => h.textContent ?? '');
    expect(heads.map(h => h.replace(/\s*\d+$/, ''))).toEqual(['Бэклог', 'В работе', 'Готово']);
  });

  it('переключатель группировки — кнопки с aria-pressed, выбор уходит наверх', () => {
    const onGroupByChange = vi.fn();
    render(<TaskTable tasks={tasks} phases={phases} groupBy="phase" onGroupByChange={onGroupByChange} label="Задачи" />);
    const group = screen.getByRole('group', { name: 'Группировка' });
    const byPhase = within(group).getByRole('button', { name: 'По фазе' });
    expect(byPhase.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'По статусу' }));
    expect(onGroupByChange).toHaveBeenCalledWith('status');
  });
});

describe('TaskTable · статус в 2 касания', () => {
  it('касание 1 — звезда открывает палитру, касание 2 — выбор статуса', async () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onStatusChange={onStatusChange} label="Задачи" />);
    const row = screen.getByRole('row', { name: /S5-02/ });
    fireEvent.click(within(row).getByRole('button', { name: /Статус: к работе/ }));
    const menu = screen.getByRole('menu', { name: /S5-02/ });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(8);
    expect(within(menu).getByRole('menuitemradio', { name: 'К работе' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Готово' })); });
    expect(onStatusChange).toHaveBeenCalledWith(tasks[1], 'done');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('фокус уходит в палитру; Escape закрывает её и возвращает фокус на звезду', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onStatusChange={async () => {}} label="Задачи" />);
    const star = within(screen.getByRole('row', { name: /S5-02/ })).getByRole('button', { name: /Статус/ });
    fireEvent.click(star);
    const menu = screen.getByRole('menu');
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(star);
  });

  it('выбор текущего статуса — без запроса', () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onStatusChange={onStatusChange} label="Задачи" />);
    fireEvent.click(within(screen.getByRole('row', { name: /S5-02/ })).getByRole('button', { name: /Статус/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'К работе' }));
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('отказ сервера — видимая ошибка в строке (role=alert), а не тишина', async () => {
    const onStatusChange = vi.fn(async () => { throw new Error('409 reviewer gate'); });
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onStatusChange={onStatusChange} label="Задачи" />);
    const row = screen.getByRole('row', { name: /S5-02/ });
    fireEvent.click(within(row).getByRole('button', { name: /Статус/ }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Готово' })); });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Статус не сменился/);
    expect(alert.textContent).toMatch(/409 reviewer gate/);
  });

  it('без onStatusChange звезда — не кнопка (только чтение)', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" />);
    expect(screen.queryByRole('button', { name: /Статус/ })).toBeNull();
  });
});

describe('TaskTable · правка в строке', () => {
  function openEdit() {
    const row = screen.getByRole('row', { name: /S5-01/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Править S5-01' }));
    return screen.getByRole('row', { name: /S5-01/ });
  }

  it('кнопка «Править» превращает строку в поля; сохранение шлёт только изменённое', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    const title = within(row).getByRole('textbox', { name: 'Задача' }) as HTMLInputElement;
    expect(title.value).toBe('Паспорт спринта');
    fireEvent.change(title, { target: { value: 'Паспорт спринта v2' } });
    fireEvent.change(within(row).getByRole('textbox', { name: 'Оценка, д' }), { target: { value: '3' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith(tasks[0], { title: 'Паспорт спринта v2', effortDays: 3 });
    expect(screen.queryByRole('textbox', { name: 'Задача' })).toBeNull();
  });

  it('Escape отменяет правку без запроса', () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    fireEvent.keyDown(within(row).getByRole('textbox', { name: 'Задача' }), { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Задача' })).toBeNull();
  });

  it('Enter сохраняет', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    const exec = within(row).getByRole('textbox', { name: 'Исполнитель' });
    fireEvent.change(exec, { target: { value: 'codex' } });
    await act(async () => { fireEvent.keyDown(exec, { key: 'Enter' }); });
    expect(onSave).toHaveBeenCalledWith(tasks[0], { executor: 'codex' });
  });

  it('без изменений — «Сохранить» просто закрывает правку, без запроса', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Задача' })).toBeNull();
  });

  it('пустой заголовок — подсказка у поля, запрос не уходит', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    const title = within(row).getByRole('textbox', { name: 'Задача' });
    fireEvent.change(title, { target: { value: ' ' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).not.toHaveBeenCalled();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/Заголовок не может быть пустым/);
  });

  it('отказ сервера — ошибка в строке, правка остаётся открытой с введённым', async () => {
    const onSave = vi.fn(async () => { throw new Error('403 forbidden'); });
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" onSave={onSave} label="Задачи" />);
    const row = openEdit();
    fireEvent.change(within(row).getByRole('textbox', { name: 'Задача' }), { target: { value: 'Новое' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(screen.getByRole('alert').textContent).toMatch(/Не сохранилось.*403 forbidden/);
    expect((screen.getByRole('textbox', { name: 'Задача' }) as HTMLInputElement).value).toBe('Новое');
  });

  it('без onSave кнопки «Править» нет', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" />);
    expect(screen.queryByRole('button', { name: /Править/ })).toBeNull();
  });
});

describe('TaskTable · доступность и стиль', () => {
  it('axe без нарушений: и чтение, и палитра, и правка', async () => {
    const { container } = render(
      <TaskTable tasks={tasks} phases={phases} groupBy="phase" onGroupByChange={() => {}}
        onStatusChange={async () => {}} onSave={async () => {}} label="Задачи" />,
    );
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(within(screen.getByRole('row', { name: /S5-02/ })).getByRole('button', { name: /Статус/ }));
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Править S5-01' }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('seidr.css: шапка таблицы uppercase, цели касания ≥ --tap, шрифты токенами', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/seidr.css'), 'utf8');
    const rule = (sel: string) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
    };
    expect(rule('.sk-tasks__th')).toMatch(/text-transform:\s*uppercase/);
    expect(rule('.sk-tasks__th')).toMatch(/font-size:\s*var\(--fs-/);
    expect(rule('.sk-tasks__menu-item')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-tasks__input')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-tasks__wrap')).toMatch(/overflow-x:\s*auto/);
  });
});
