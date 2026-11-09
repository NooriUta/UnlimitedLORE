// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-01 · шапка паспорта спринта на kit: строка-вердикт
// «статус · задачи x/y · просрочено · свежесть» из строк существующих слайсов
// (sprints + задачи спринта), без новых эндпоинтов.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KNOWN_STATUSES, KitLangProvider, RecordView, recordFacts, type KitConfig, type KitCtx } from '@seidr/kit';
import ru from '../i18n/ru.json';
import en from '../i18n/en.json';
import {
  HAS_TASK, SPRINT_FACTS, loreStatuses, sprintKitData, taskRecordId,
  type SprintSliceRow, type SprintTaskSliceRow,
} from './loreRecord';

const NOW = '2026-11-07T12:00:00Z';

const SPRINT: SprintSliceRow = {
  sprint_id: 'SPRINT_UXR_S5_RECORD_TASKS', name: 'Паспорта записей', status_raw: 'in_progress',
  planned_end_date: '2026-11-05', valid_from: '2026-11-06T08:00:00Z', context_md: '## Цель',
};
const TASKS: SprintTaskSliceRow[] = [
  { task_id: 'S5-01', title: 'Шапка', status_raw: 'done', order_index: 1 },
  { task_id: 'S5-02', title: 'Паспорт спринта', status_raw: 'in_progress', order_index: 2 },
  { task_id: 'S5-03', title: 'Паспорт ADR', status_raw: 'todo', order_index: 3 },
  { task_id: 'S5-08', title: 'Серверный черновик', status_raw: 'cancelled', order_index: 8 },
];

function config(lang: 'ru' | 'en' = 'ru'): KitConfig {
  return {
    modules: [], menu: { groups: [] },
    kinds: {
      Sprint: { title: 'Спринт', icon: 'sprint', tabs: [{ key: 'tasks', title: 'Задачи', render: () => 'таблица задач' }] },
      Task: { title: 'Задача', icon: 'checkbox-tree' },
    },
    statuses: loreStatuses(lang),
  };
}

function ctxOf(data: KitCtx['data'], lang: 'ru' | 'en' = 'ru'): KitCtx {
  return { data, config: config(lang), href: id => `?passport=${id}`, esc: s => s, md: s => <div>{s}</div> };
}

describe('S5-01 · sprintKitData — строки слайсов → запись kit', () => {
  it('спринт — запись Sprint, задачи — записи Task с id «спринт/код», рёбра HAS_TASK', () => {
    const { record, data } = sprintKitData(SPRINT, TASKS, NOW);
    expect(record).toMatchObject({ id: SPRINT.sprint_id, kind: 'Sprint', title: 'Паспорта записей', status: 'active', updated_at: SPRINT.valid_from, body_md: '## Цель' });
    expect(record.fields.planned_end_date).toBe('2026-11-05');
    expect(taskRecordId(SPRINT.sprint_id, 'S5-01')).toBe('SPRINT_UXR_S5_RECORD_TASKS/S5-01');
    expect(data.records.map(r => r.id)).toContain('SPRINT_UXR_S5_RECORD_TASKS/S5-02');
    expect(data.edges.filter(e => e.type === HAS_TASK)).toHaveLength(4);
    expect(data.meta.generated_at).toBe(NOW);
  });

  it('факты: задачи 1/3 (отменённая вне знаменателя), просрочено на 2 дн, обновлено 1 дн назад', () => {
    const { record, data } = sprintKitData(SPRINT, TASKS, NOW);
    const f = recordFacts(record, ctxOf(data), { ...SPRINT_FACTS, now: NOW });
    expect(f.tasks).toEqual({ state: 'ok', done: 1, total: 3, open: 2, cancelled: 1 });
    expect(f.due).toEqual({ state: 'overdue', days: 2 });
    expect(f.fresh).toMatchObject({ state: 'ok', days: 1 });
  });

  it('задачи не загрузились — meta.errors[tasks], строка говорит «не смогли проверить»', () => {
    const { record, data } = sprintKitData(SPRINT, { error: 'HTTP 403' }, NOW);
    expect(data.meta.errors).toEqual([{ block: 'tasks', reason: 'HTTP 403' }]);
    render(<RecordView record={record} ctx={ctxOf(data)} tab="overview" onTab={() => {}} facts={{ ...SPRINT_FACTS, now: NOW }} />);
    expect(screen.getByTestId('kit-facts').querySelector('[data-fact="tasks"]')?.textContent).toContain('не смогли проверить');
  });

  it('пустые даты слайса (null) — честные «срок не задан» и «свежесть неизвестна»', () => {
    const { record, data } = sprintKitData({ ...SPRINT, planned_end_date: null, valid_from: null }, TASKS, NOW);
    const f = recordFacts(record, ctxOf(data), { ...SPRINT_FACTS, now: NOW });
    expect(f.due).toEqual({ state: 'none' });
    expect(f.fresh).toEqual({ state: 'unknown' });
  });
});

describe('S5-01 · шапка паспорта спринта', () => {
  function view(lang: 'ru' | 'en' = 'ru') {
    const { record, data } = sprintKitData(SPRINT, TASKS, NOW);
    const onTab = vi.fn();
    render(
      <KitLangProvider lang={lang}>
        <RecordView record={record} ctx={ctxOf(data, lang)} tab="overview" onTab={onTab} facts={{ ...SPRINT_FACTS, now: NOW }} />
      </KitLangProvider>,
    );
    return onTab;
  }

  it('статус словами локали, задачи 1/3, просрочено, свежесть', () => {
    view();
    const line = screen.getByTestId('kit-facts');
    expect(line.textContent).toContain('В работе'); // код плана active (status_raw in_progress → planStatusOf), подпись как v1
    expect(line.textContent).toContain('1/3');
    expect(line.textContent).toContain('Просрочено на 2 дн');
    expect(line.textContent).toContain('1 дн назад');
  });

  // Уточнено 09.11: раньше в строке фактов была РОВНО ОДНА кнопка, и тест брал
  // её без имени. Теперь кнопок две — статус тоже стал кнопкой, когда права
  // позволяют его сменить (дефект «не могу поменять статус адр»). Предмет
  // проверки не изменился, поэтому кнопка выбирается по своему факту.
  it('«задачи 1/3» ведёт на вкладку «Задачи» (?tab=tasks) — одно касание', () => {
    const onTab = view();
    const tasks = screen.getByTestId('kit-facts').querySelector('[data-fact="tasks"] button')!;
    fireEvent.click(tasks);
    expect(onTab).toHaveBeenCalledWith(SPRINT_FACTS.tasksTab);
  });

  it('английская локаль: статус и факты по-английски', () => {
    view('en');
    const line = screen.getByTestId('kit-facts');
    expect(line.textContent).toContain('In progress');
    expect(line.textContent).toContain('Overdue by 2 d');
  });
});

describe('S5-01 · статусы LORE для kit', () => {
  it('каждый известный статус — с подписью в ru и en и с категорией', () => {
    for (const code of KNOWN_STATUSES) {
      const key = `record.status.${code}` as keyof typeof ru;
      expect(ru[key], code).toBeTruthy();
      expect((en as Record<string, string>)[key], code).toBeTruthy();
    }
    const items = loreStatuses('ru').items;
    expect(items.map(i => i.code).sort()).toEqual([...KNOWN_STATUSES].sort());
    expect(items.find(i => i.code === 'done')?.category).toBe('done');
    expect(items.find(i => i.code === 'cancelled')?.category).toBe('cancelled');
    expect(items.find(i => i.code === 'in_progress')?.category).toBe('active');
    expect(items.find(i => i.code === 'backlog')?.category).toBe('todo');
    for (const i of items) expect(i.color).toMatch(/^var\(--/);
  });
});
