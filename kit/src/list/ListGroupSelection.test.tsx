// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10 — выделение в ГРУППИРОВАННОМ списке.
//
// Повод — запрос сессии администрирования LORE 10.11.2026. Выделение в списке
// уже было (долгое нажатие, чекбоксы, массовые действия), но группы в нём не
// участвовали: отметить группу целиком нельзя, у заголовка не видно, сколько
// в ней отмечено, а главное — «показанным» считалось всё, что прошло фильтр.
// В группированном списке это неправда: свёрнутая группа и хвост за «ещё N»
// на экране не стоят, и действие забирало их МОЛЧА. Отметил группу, свернул
// её, нажал действие — и оно тронуло то, чего не видно.
//
// Правило здесь одно и то же с лентой и курсором: над чем действуем — то и
// показано; отмеченное за пределами показанного не теряется, а называется
// ЧИСЛОМ.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list'], filters: ['status'], groupings: ['status'], columns: ['title+id', 'status'] },
};

// Пять «к работе» и две «готово»: группа заметно больше бюджета, который
// задаётся в тестах с «ещё N», и заметно больше одной строки.
const records = [
  rec('t1', 'todo'), rec('t2', 'todo'), rec('t3', 'todo'), rec('t4', 'todo'), rec('t5', 'todo'),
  rec('d1', 'done'), rec('d2', 'done'),
];
const data: KitData = {
  records, edges: [], journal: [],
  meta: { generated_at: '2026-11-10T00:00:00Z', total: records.length },
};

const bulk = (run: (ids: readonly string[]) => void = () => {}) =>
  [{ id: 'x', title: 'Экспорт', run }];

function view(extra: Partial<React.ComponentProps<typeof ListView>> = {}) {
  return render(
    <ListView
      config={cfg}
      data={data}
      urlState={false}
      initial={{ group: 'status' }}
      bulkActions={bulk()}
      {...extra}
    />,
  );
}

const enterSelection = () => fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
const bar = () => screen.getByTestId('kit-list-selbar');
const head = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-group-key="${key}"]`) as HTMLElement;
const groupBox = (container: HTMLElement, key: string) =>
  within(head(container, key)).getByRole('checkbox');
const rowBox = (name: string) => screen.getByRole('checkbox', { name: `Выбрать: ${name}` });

describe('S4-10 · группа отмечается одним движением', () => {
  it('положительный контроль: список сгруппирован, у заголовков — счётчики', () => {
    const { container } = view();
    const heads = [...container.querySelectorAll('[data-group-key]')];
    expect(heads.map(h => h.getAttribute('data-group-key'))).toEqual(['todo', 'done']);
    expect(heads[0].textContent).toContain('5');
  });

  it('вне режима выбора чекбоксов у групп нет: список остаётся списком', () => {
    const { container } = view();
    expect(within(head(container, 'todo')).queryByRole('checkbox')).toBeNull();
  });

  it('чекбокс группы выбирает её целиком — одним движением, а не пятью', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    expect(bar().textContent).toContain('Выбрано: 5');
    // Соседняя группа не тронута: выбор группы — это выбор ЕЁ записей.
    expect((rowBox('Запись d1') as HTMLInputElement).checked).toBe(false);
  });

  it('повторное нажатие снимает выбор группы, не задевая другую', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    fireEvent.click(groupBox(container, 'done'));
    expect(bar().textContent).toContain('Выбрано: 7');
    fireEvent.click(groupBox(container, 'todo'));
    expect(bar().textContent).toContain('Выбрано: 2');
    expect((rowBox('Запись d1') as HTMLInputElement).checked).toBe(true);
  });

  it('у чекбокса группы есть имя с названием группы: без него это «ещё один квадратик»', () => {
    const { container } = view();
    enterSelection();
    expect(groupBox(container, 'todo').getAttribute('aria-label')).toContain('к работе');
  });

  it('состояние чекбокса группы: пусто · часть (mixed) · вся группа', () => {
    const { container } = view();
    enterSelection();
    const box = () => groupBox(container, 'todo') as HTMLInputElement;
    expect(box().checked).toBe(false);
    expect(box().indeterminate).toBe(false);
    fireEvent.click(rowBox('Запись t1'));
    expect(box().checked).toBe(false);
    expect(box().indeterminate).toBe(true);
    fireEvent.click(groupBox(container, 'todo'));
    expect(box().checked).toBe(true);
    expect(box().indeterminate).toBe(false);
  });
});

describe('S4-10 · у заголовка группы видно, сколько в ней отмечено', () => {
  it('«3 из 5» у своей группы, и ничего — у чужой', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(rowBox('Запись t1'));
    fireEvent.click(rowBox('Запись t2'));
    fireEvent.click(rowBox('Запись t3'));
    const note = within(head(container, 'todo')).getByTestId('kit-list-gsel-todo');
    expect(note.textContent).toMatch(/3/);
    expect(note.textContent).toMatch(/5/);
    expect(within(head(container, 'done')).queryByTestId('kit-list-gsel-done')).toBeNull();
  });

  it('счётчик группы считает отмеченное и в свёрнутой группе: иначе выбор «исчезает»', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    fireEvent.click(within(head(container, 'todo')).getByRole('button', { name: /к работе/ }));
    expect(within(head(container, 'todo')).getByTestId('kit-list-gsel-todo').textContent).toMatch(/5/);
  });
});

describe('S4-10 · в действие уходит только показанное, остальное названо числом', () => {
  it('свёрнутая группа: действие не получает её строк, и это сказано числом', () => {
    const run = vi.fn();
    const { container } = view({ bulkActions: bulk(run) });
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    expect(bar().textContent).toContain('Выбрано: 5');
    // Сворачиваем группу — её строки со экрана ушли.
    fireEvent.click(within(head(container, 'todo')).getByRole('button', { name: /к работе/ }));
    expect(bar().textContent).toContain('Выбрано: 0');
    expect(screen.getByTestId('kit-list-selhidden').textContent).toMatch(/5/);
    // Действовать не над чем — кнопка недоступна, а не «сработала вхолостую».
    expect((screen.getByRole('button', { name: 'Экспорт' }) as HTMLButtonElement).disabled).toBe(true);
    expect(run).not.toHaveBeenCalled();
    // Раскрыли обратно — выбор на месте, он не пропал.
    fireEvent.click(within(head(container, 'todo')).getByRole('button', { name: /к работе/ }));
    expect(bar().textContent).toContain('Выбрано: 5');
    expect(screen.queryByTestId('kit-list-selhidden')).toBeNull();
  });

  it('хвост за «ещё N»: действие получает ровно показанные строки, скрытые — числом', () => {
    const run = vi.fn();
    const { container } = view({ bulkActions: bulk(run), budget: { perGroup: 2 } });
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    expect(bar().textContent).toContain('Выбрано: 2');
    expect(screen.getByTestId('kit-list-selhidden').textContent).toMatch(/3/);
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }));
    expect(run).toHaveBeenCalledWith(['t1', 't2']);
  });

  it('«ещё N» раскрывает по бюджету: показанных больше, скрытых меньше — и числа сходятся', () => {
    const { container } = view({ budget: { perGroup: 2 } });
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    // Шаг раскрытия — тот же бюджет (2), а не «всё сразу»: 2 → 4 → 5.
    fireEvent.click(screen.getByRole('button', { name: /ещё 3/ }));
    expect(bar().textContent).toContain('Выбрано: 4');
    expect(screen.getByTestId('kit-list-selhidden').textContent).toMatch(/1/);
    fireEvent.click(screen.getByRole('button', { name: /ещё 1/ }));
    expect(bar().textContent).toContain('Выбрано: 5');
    expect(screen.queryByTestId('kit-list-selhidden')).toBeNull();
  });

  it('«выбрать все показанные» берёт показанные, а не всё отфильтрованное', () => {
    const { container } = view({ budget: { perGroup: 2 } });
    enterSelection();
    // 2 показанных «к работе» + 2 «готово» = 4 из семи записей.
    fireEvent.click(within(bar()).getByRole('button', { name: /Выбрать все показанные/ }));
    expect(bar().textContent).toContain('Выбрано: 4');
    expect(screen.queryByTestId('kit-list-selhidden')).toBeNull();
    expect(container.querySelectorAll('.sk-list__row.is-selected')).toHaveLength(4);
  });
});

describe('S4-10 · полоса действий: над скольким действует и где стоит', () => {
  it('полоса остаётся на месте при переключении группировки, выбор не теряется', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(rowBox('Запись t1'));
    fireEvent.click(rowBox('Запись d1'));
    const root = container.querySelector('.sk-list') as HTMLElement;
    expect(root.firstElementChild?.getAttribute('data-testid')).toBe('kit-list-selbar');
    // Переключаем группировку на «одна на список».
    fireEvent.click(screen.getByRole('button', { name: /^Группировка:/ }));
    const dlg = screen.getByRole('dialog', { name: 'Группировка' });
    fireEvent.click(within(dlg).getByRole('radio', { name: /без группировки/ }));
    expect(root.firstElementChild?.getAttribute('data-testid')).toBe('kit-list-selbar');
    expect(bar().textContent).toContain('Выбрано: 2');
  });

  it('Esc по-прежнему выходит из режима и снимает всё — включая выбор групп', () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    fireEvent.keyDown(container.querySelector('.sk-list') as HTMLElement, { key: 'Escape' });
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('axe: группированный список в режиме выбора — без нарушений', async () => {
    const { container } = view();
    enterSelection();
    fireEvent.click(groupBox(container, 'todo'));
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S4-10 · инварианты kit: CSS и обе локали', () => {
  it('у новых классов sk-… есть правила в seidr.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    expect(css).toMatch(/--fs-base/); // положительный контроль чтения файла
    for (const cls of ['sk-list__ghrow', 'sk-list__gcheck', 'sk-list__gsel', 'sk-list__selhidden']) {
      expect(css, cls).toContain(`.${cls}`);
    }
  });

  it('ключи выбора групп есть в ОБЕИХ локалях: инлайн-дефолт не считается', () => {
    const ru = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/ru.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8'));
    for (const k of ['kit.list.selectGroup', 'kit.list.groupSelected', 'kit.list.selHidden']) {
      expect(ru[k], `ru: ${k}`).toBeTruthy();
      expect(en[k], `en: ${k}`).toBeTruthy();
    }
  });
});
