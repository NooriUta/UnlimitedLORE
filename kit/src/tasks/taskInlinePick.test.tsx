// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-25 — правка в строке таблицы задач: тип, класс работы и роли
// (автор, исполнитель, ревьюер) — выбором из списка. Слова владелицы 13.11: «табличное
// редактирование не даёт редактировать dropdown список (автор и прочее ревью) и типы (ENB UC JTD)».
// PU-17 остаётся в силе: свободного текста для ролей нет — только кандидаты, которых дал экран.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, TaskTable, type KitDictItem, type TaskPhase, type TaskRowData } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const PHASES: TaskPhase[] = [];
const TASK: TaskRowData = {
  uid: 'S/T-1', id: 'T-1', title: 'Задача', status: 'in_progress', phase: null, effortDays: 1,
  author: 'owner', executor: 'claude', reviewer: 'owner', taskType: 'dev', workClass: 'enb', order: 1,
};
const DICT: { taskType: KitDictItem[]; workClass: KitDictItem[] } = {
  taskType: [{ code: 'dev', title: 'Разработка' }, { code: 'docs', title: 'Документация' }],
  workClass: [{ code: 'enb', title: 'ENB' }, { code: 'uc', title: 'UC' }, { code: 'jtd', title: 'JTD' }],
};
const PEOPLE: KitDictItem[] = [{ code: 'owner', title: 'Владелица' }, { code: 'claude', title: 'Claude Code' }, { code: 'codex', title: 'Codex' }];

async function openEdit() {
  const row = screen.getByRole('row', { name: /T-1/ });
  await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Править T-1' })); });
  return screen.getByRole('row', { name: /T-1/ });
}

describe('PU-25 · правка в строке — выбором', () => {
  it('тип, класс и три роли — выпадающие списки; уходит только изменённое', async () => {
    const onSave = vi.fn(async () => {});
    const assigneeOptions = vi.fn(async () => PEOPLE);
    render(<TaskTable tasks={[TASK]} phases={PHASES} groupBy="none" dict={DICT} onSave={onSave} assigneeOptions={assigneeOptions} label="Задачи" />);
    const row = await openEdit();
    expect(assigneeOptions).toHaveBeenCalledWith(TASK);
    for (const name of ['Тип', 'Класс', 'Автор', 'Исполнитель', 'Ревьюер'])
      expect(within(row).getByRole('combobox', { name }), name).toBeTruthy();
    // PU-17: свободного текста для ролей по-прежнему нет.
    for (const name of ['Автор', 'Исполнитель', 'Ревьюер'])
      expect(within(row).queryByRole('textbox', { name })).toBeNull();
    const cls = within(row).getByRole('combobox', { name: 'Класс' }) as HTMLSelectElement;
    expect([...cls.options].map(o => o.value)).toEqual(['enb', 'uc', 'jtd']);
    fireEvent.change(cls, { target: { value: 'uc' } });
    fireEvent.change(within(row).getByRole('combobox', { name: 'Исполнитель' }), { target: { value: 'codex' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenCalledWith(TASK, { workClass: 'uc', executor: 'codex' });
  });

  it('текущая роль не из кандидатов — остаётся выбранной и не теряется', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={[{ ...TASK, reviewer: 'legacy-name' }]} phases={PHASES} groupBy="none" dict={DICT} onSave={onSave}
      assigneeOptions={async () => PEOPLE} label="Задачи" />);
    const row = await openEdit();
    const rev = within(row).getByRole('combobox', { name: 'Ревьюер' }) as HTMLSelectElement;
    expect(rev.value).toBe('legacy-name');
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('кандидаты не прочитались — роли остаются текстом, причина названа, ввода нет', async () => {
    render(<TaskTable tasks={[TASK]} phases={PHASES} groupBy="none" dict={DICT} onSave={vi.fn(async () => {})}
      assigneeOptions={async () => { throw new Error('HTTP 503'); }} label="Задачи" />);
    const row = await openEdit();
    expect(within(row).queryByRole('combobox', { name: 'Исполнитель' })).toBeNull();
    expect(within(row).queryByRole('textbox', { name: 'Исполнитель' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/HTTP 503/);
    // Тип и класс от справочника не зависят от кандидатов — они выбираются.
    expect(within(row).getByRole('combobox', { name: 'Класс' })).toBeTruthy();
  });

  it('справочника нет — тип и класс не выбираются (не выдумываем варианты)', async () => {
    render(<TaskTable tasks={[TASK]} phases={PHASES} groupBy="none" onSave={vi.fn(async () => {})} label="Задачи" />);
    const row = await openEdit();
    expect(within(row).queryByRole('combobox', { name: 'Класс' })).toBeNull();
    expect(within(row).queryByRole('combobox', { name: 'Тип' })).toBeNull();
  });

  it('колонка «Автор» есть в таблице и показывает автора', () => {
    render(<TaskTable tasks={[TASK]} phases={PHASES} groupBy="none" label="Задачи" />);
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toContain('Автор');
  });
});
