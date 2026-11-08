// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36 — значки в углу карточки на доске.
//
// Сверено с прототипом v4 (docs/prototypes/ux-redesign-shell-v4.html,
// функция cardHtml): там на карточке код, заголовок, статус-чип, приоритет и
// проекты. У нас на карточке было только название и код, поэтому доска
// говорила о записи меньше, чем список, и при переключении вида часть
// сведений пропадала.
//
// Статус на доске не дублируем: колонки доски — это и есть статусы.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, fields: Record<string, unknown>): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    task: {
      title: 'Задачи', icon: 'checkbox-tree',
      fields: [
        { key: 'priority', title: 'Приоритет', type: 'enum' },
        { key: 'work_class', title: 'Класс работы', type: 'enum' },
        { key: 'owner', title: 'Исполнитель', type: 'text' },
        { key: 'note', title: 'Заметка', type: 'text' },
      ],
    },
  },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['board'],
    columns: ['title+id', 'status', 'fields.priority', 'fields.work_class', 'fields.owner', 'fields.note'],
  },
};

const data: KitData = {
  records: [
    rec('T-1', 'todo', { priority: 'P0', work_class: 'enb', owner: 'claude', note: 'длинная заметка' }),
    rec('T-2', 'done', { priority: null, work_class: null, owner: null, note: null }),
  ],
  edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z', total: 2, truncated: false },
};

const card = (id: string) => document.querySelector(`.sk-board__card[data-record-id="${id}"]`) as HTMLElement;

/** Доска — единственный вид в конфиге, поэтому она и открывается по умолчанию. */
function board() {
  const r = render(<ListView config={cfg} data={data} />);
  // Положительный контроль: если доска вдруг не отрисовалась, проверки ниже
  // «не нашли значок» выглядели бы как успех.
  expect(document.querySelectorAll('.sk-board__card')).toHaveLength(data.records.length);
  return r;
}

describe('S4-36 · значки в углу карточки на доске', () => {
  it('значения полей видны на карточке, а не только в списке', () => {
    board();
    const badges = within(card('T-1')).getByTestId('board-badges');
    expect(badges.textContent).toContain('P0');
    expect(badges.textContent).toContain('enb');
  });

  it('у значка есть подпись поля: «P0» само по себе ничего не говорит', () => {
    board();
    expect(within(card('T-1')).getByTitle(/Приоритет/)).toBeTruthy();
  });

  it('значков не больше трёх — угол карточки не превращается в таблицу', () => {
    board();
    const badges = within(card('T-1')).getByTestId('board-badges');
    expect(badges.querySelectorAll('.sk-board__badge')).toHaveLength(3);
  });

  it('пустые значения не рисуются: пустой значок хуже отсутствующего', () => {
    board();
    expect(within(card('T-2')).queryByTestId('board-badges')).toBeNull();
  });

  it('статус на карточке не дублируется — колонки доски и есть статусы', () => {
    board();
    const badges = within(card('T-1')).getByTestId('board-badges');
    expect(badges.textContent).not.toContain('к работе');
  });
});
