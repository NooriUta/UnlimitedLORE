// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-01 · шапка записи: строка-вердикт
// «статус · задачи x/y · просрочено · свежесть» и липкие вкладки.
// Сводка считается чистой функцией из X_DATA (записи + рёбра + meta), без сервера.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordFacts, RecordView, recordFacts, type RecordFactsSpec } from './index';
import { KitLangProvider } from '../i18n';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));

const NOW = '2026-11-07T12:00:00Z';

const S: KitRecord = {
  id: 'SPRINT_X', kind: 'Sprint', title: 'Спринт X', status: 'active',
  fields: { planned_end: '2026-11-04' }, updated_at: '2026-11-05T09:00:00Z',
};
const task = (id: string, status: string): KitRecord => ({ id, kind: 'Task', title: `Задача ${id}`, status, fields: {} });

function cfg(): KitConfig {
  return {
    modules: [], menu: { groups: [] },
    kinds: {
      Sprint: { title: 'Спринты', icon: 'sprint', tabs: [{ key: 'tasks', title: 'Задачи', render: () => 'таблица' }] },
      Task: { title: 'Задачи', icon: 'checkbox-tree' },
    },
    statuses: {
      items: [
        { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--st-todo' },
        { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: '--st-active' },
        { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: '--st-done' },
        { code: 'cancelled', title: 'Отменено', category: 'cancelled', icon: 'cross-mark', color: '--st-cancelled' },
      ],
    },
  };
}

function dat(over: Partial<KitData> = {}): KitData {
  const tasks = [task('T-1', 'done'), task('T-2', 'done'), task('T-3', 'active'), task('T-4', 'todo'), task('T-5', 'cancelled'), task('T-6', 'weird')];
  return {
    records: [S, ...tasks],
    edges: [
      ...tasks.map(t => ({ from: 'SPRINT_X', to: t.id, type: 'HAS_TASK' })),
      { from: 'SPRINT_X', to: 'ADR-1', type: 'REFERS' },
    ],
    journal: [],
    meta: { generated_at: NOW },
    ...over,
  };
}

const ctxOf = (data = dat(), config = cfg()): KitCtx => ({
  data, config, href: id => `#rec=${id}`, esc: s => s, md: s => <div>{s}</div>,
});

const SPEC: RecordFactsSpec = { childEdge: 'HAS_TASK', dueField: 'planned_end', now: NOW, tasksTab: 'tasks' };

describe('S5-01 · recordFacts — чистый расчёт сводки', () => {
  it('задачи x/y: готово по категории done, отменённые вне знаменателя, неизвестный статус — открытая', () => {
    const f = recordFacts(S, ctxOf(), SPEC);
    expect(f.tasks).toEqual({ state: 'ok', done: 2, total: 5, open: 3, cancelled: 1 });
  });

  it('просрочено: срок прошёл, запись не закрыта — дни календарные по UTC', () => {
    expect(recordFacts(S, ctxOf(), SPEC).due).toEqual({ state: 'overdue', days: 3 });
  });

  it('срок сегодня и в будущем — не просрочено', () => {
    expect(recordFacts({ ...S, fields: { planned_end: '2026-11-07' } }, ctxOf(), SPEC).due).toEqual({ state: 'today' });
    expect(recordFacts({ ...S, fields: { planned_end: '2026-11-10' } }, ctxOf(), SPEC).due).toEqual({ state: 'onTime', days: 3 });
  });

  it('закрытая запись не бывает просроченной; нет срока — честное «не задан»', () => {
    expect(recordFacts({ ...S, status: 'done' }, ctxOf(), SPEC).due).toEqual({ state: 'closed' });
    expect(recordFacts({ ...S, fields: {} }, ctxOf(), SPEC).due).toEqual({ state: 'none' });
    expect(recordFacts({ ...S, fields: { planned_end: 'не дата' } }, ctxOf(), SPEC).due).toEqual({ state: 'none' });
  });

  it('свежесть: дни с updated_at, тон по порогам; нет даты — unknown', () => {
    expect(recordFacts(S, ctxOf(), SPEC).fresh).toEqual({ state: 'ok', days: 2, tone: 'suc' });
    expect(recordFacts({ ...S, updated_at: '2026-10-20T00:00:00Z' }, ctxOf(), SPEC).fresh).toEqual({ state: 'ok', days: 18, tone: 'wrn' });
    expect(recordFacts({ ...S, updated_at: '2026-08-01T00:00:00Z' }, ctxOf(), SPEC).fresh).toMatchObject({ tone: 'dng' });
    expect(recordFacts({ ...S, updated_at: undefined }, ctxOf(), SPEC).fresh).toEqual({ state: 'unknown' });
  });

  it('задачи не загрузились (meta.errors) — «не смогли проверить», а не 0/0', () => {
    const d = dat({ meta: { generated_at: NOW, errors: [{ block: 'tasks', reason: '403' }] } });
    expect(recordFacts(S, ctxOf(d), SPEC).tasks).toEqual({ state: 'error', reason: '403' });
  });

  it('задач нет — проверенный ноль; childEdge не задан — факта нет', () => {
    expect(recordFacts(S, ctxOf(dat({ edges: [] })), SPEC).tasks).toEqual({ state: 'none' });
    expect(recordFacts(S, ctxOf(), { now: NOW }).tasks).toBeNull();
  });

  it('детерминирована: порядок рёбер не влияет', () => {
    const d = dat();
    const rev = dat({ edges: [...d.edges].reverse() });
    expect(recordFacts(S, ctxOf(rev), SPEC)).toEqual(recordFacts(S, ctxOf(d), SPEC));
  });
});

describe('S5-01 · строка-вердикт в шапке', () => {
  function view(spec: RecordFactsSpec | null = SPEC, ctx = ctxOf(), lang: 'ru' | 'en' = 'ru') {
    const onTab = vi.fn();
    const r = render(
      <KitLangProvider lang={lang}>
        <RecordView record={S} ctx={ctx} tab="overview" onTab={onTab} facts={spec ?? undefined} />
      </KitLangProvider>,
    );
    return { ...r, onTab };
  }

  it('статус · задачи 2/5 · просрочено на 3 дн · обновлено 2 дн назад — по порядку', () => {
    view();
    const line = screen.getByTestId('kit-facts');
    const items = within(line).getAllByRole('listitem').map(li => li.getAttribute('data-fact'));
    expect(items).toEqual(['status', 'tasks', 'due', 'fresh']);
    expect(line.textContent).toContain('В работе');
    expect(line.textContent).toContain('2/5');
    expect(line.textContent).toContain('Просрочено на 3 дн');
    expect(line.textContent).toContain('2 дн назад');
    expect(line.querySelector('[data-fact="due"]')?.getAttribute('data-tone')).toBe('dng');
  });

  it('строка стоит между шапкой и вкладками', () => {
    view();
    const head = screen.getByTestId('kit-rec-head');
    const line = screen.getByTestId('kit-facts');
    const tablist = screen.getByRole('tablist');
    expect(head.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('«задачи x/y» — кнопка: одно касание до вкладки «Задачи»', () => {
    const { onTab } = view();
    const btn = within(screen.getByTestId('kit-facts')).getByRole('button', { name: /Задачи.*2.*5/ });
    fireEvent.click(btn);
    expect(onTab).toHaveBeenCalledWith('tasks');
  });

  // Сужено 09.11: утверждение было «в строке фактов НЕТ кнопок вообще», и оно
  // стало неверным не по своей вине — статус в строке теперь становится кнопкой,
  // когда права позволяют его сменить (дефект «не могу поменять статус адр»).
  // Предмет проверки — ФАКТ ЗАДАЧ, поэтому смотрим на него, а не на всю строку.
  it('вкладки «Задачи» у вида нет — факт задач текстом, не кнопкой', () => {
    view({ ...SPEC, tasksTab: 'nope' });
    const tasks = screen.getByTestId('kit-facts').querySelector('[data-fact="tasks"]')!;
    expect(tasks.querySelector('button')).toBeNull();
  });

  it('ошибка задач рисуется явно', () => {
    view(SPEC, ctxOf(dat({ meta: { generated_at: NOW, errors: [{ block: 'tasks', reason: '403' }] } })));
    const t = screen.getByTestId('kit-facts').querySelector('[data-fact="tasks"]');
    expect(t?.textContent).toContain('не смогли проверить');
    expect(t?.getAttribute('data-tone')).toBe('dng');
  });

  it('facts не передан — строки нет (обратная совместимость K-04)', () => {
    view(null);
    expect(screen.queryByTestId('kit-facts')).toBeNull();
  });

  it('английская локаль', () => {
    view(SPEC, ctxOf(), 'en');
    const line = screen.getByTestId('kit-facts');
    expect(line.textContent).toContain('Overdue by 3 d');
    expect(line.textContent).toContain('Tasks');
  });

  it('a11y: нарушений axe нет', async () => {
    const { container } = view();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('RecordFacts работает и отдельно от RecordView', () => {
    render(<RecordFacts record={S} ctx={ctxOf()} spec={SPEC} lang="ru" />);
    expect(screen.getByTestId('kit-facts').textContent).toContain('2/5');
  });
});

describe('S5-01 · липкие вкладки — разметка', () => {
  it('RecordView вешает класс липкой полосы на вкладки', () => {
    render(<RecordView record={S} ctx={ctxOf()} tab="overview" onTab={() => {}} />);
    expect(screen.getByRole('tablist').parentElement?.classList.contains('sk-rec__tabs')).toBe(true);
  });
});

