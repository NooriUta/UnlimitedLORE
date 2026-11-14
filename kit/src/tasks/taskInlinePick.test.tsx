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
    for (const name of ['Тип', 'Класс', 'Автор', 'Исполнитель', 'Принимающий'])
      expect(within(row).getByRole('combobox', { name }), name).toBeTruthy();
    // PU-17: свободного текста для ролей по-прежнему нет.
    for (const name of ['Автор', 'Исполнитель', 'Принимающий'])
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
    const rev = within(row).getByRole('combobox', { name: 'Принимающий' }) as HTMLSelectElement;
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

  // PU-25, приёмка v1.17.21: список задач спринта отдаёт держателя роли ИМЕНЕМ (у агента — name,
  // срез tasks_of_sprint: COALESCE(name, display_name, actor_id)), а кандидаты task_identities —
  // КОДОМ (у агента actor_id, имя — подпись). Без сопоставления текущий исполнитель вставал лишним
  // пунктом «Claude Code» рядом с настоящим кандидатом «Claude Code», и выбранным был не кандидат.
  const AGENTS: KitDictItem[] = [{ code: 'owner', title: 'owner' }, { code: 'AGENT-FULL-x1', title: 'Claude Code' }, { code: 'AGENT-CODEX-y2', title: 'Codex' }];
  const BY_NAME: TaskRowData = { ...TASK, author: 'owner', executor: 'Claude Code', reviewer: 'owner' };

  it('держатель роли именем — выбран его кандидат (код), лишнего пункта нет', async () => {
    render(<TaskTable tasks={[BY_NAME]} phases={PHASES} groupBy="none" dict={DICT} onSave={vi.fn(async () => {})}
      assigneeOptions={async () => AGENTS} label="Задачи" />);
    const row = await openEdit();
    const ex = within(row).getByRole('combobox', { name: 'Исполнитель' }) as HTMLSelectElement;
    expect(ex.value).toBe('AGENT-FULL-x1');
    expect([...ex.options].map(o => o.value)).toEqual(['owner', 'AGENT-FULL-x1', 'AGENT-CODEX-y2']);
    expect((within(row).getByRole('combobox', { name: 'Автор' }) as HTMLSelectElement).value).toBe('owner');
    expect((within(row).getByRole('combobox', { name: 'Класс' }) as HTMLSelectElement).value).toBe('enb');
    expect((within(row).getByRole('combobox', { name: 'Тип' }) as HTMLSelectElement).value).toBe('dev');
  });

  it('держатель именем не тронут — роль в запрос не уходит; сменили — уходит код кандидата', async () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={[BY_NAME]} phases={PHASES} groupBy="none" dict={DICT} onSave={onSave}
      assigneeOptions={async () => AGENTS} label="Задачи" />);
    let row = await openEdit();
    fireEvent.change(within(row).getByRole('combobox', { name: 'Класс' }), { target: { value: 'jtd' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenLastCalledWith(BY_NAME, { workClass: 'jtd' });
    row = await openEdit();
    fireEvent.change(within(row).getByRole('combobox', { name: 'Исполнитель' }), { target: { value: 'AGENT-CODEX-y2' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(onSave).toHaveBeenLastCalledWith(BY_NAME, { executor: 'AGENT-CODEX-y2' });
  });

  it('имя совпало у двух кандидатов — не угадываем: текущее остаётся своим пунктом', async () => {
    const twins: KitDictItem[] = [{ code: 'A-1', title: 'Claude Code' }, { code: 'A-2', title: 'Claude Code' }];
    render(<TaskTable tasks={[BY_NAME]} phases={PHASES} groupBy="none" dict={DICT} onSave={vi.fn(async () => {})}
      assigneeOptions={async () => twins} label="Задачи" />);
    const row = await openEdit();
    const ex = within(row).getByRole('combobox', { name: 'Исполнитель' }) as HTMLSelectElement;
    expect(ex.value).toBe('Claude Code');
  });

  it('колонка «Автор» есть в таблице и показывает автора', () => {
    render(<TaskTable tasks={[TASK]} phases={PHASES} groupBy="none" label="Задачи" />);
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toContain('Автор');
  });
});
