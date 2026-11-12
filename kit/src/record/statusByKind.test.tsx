// @vitest-environment jsdom
// Замечание владелицы 11.11.2026: «в паспорте в дочерних табличных видах не
// подтягиваются правильные иконки, привязанные к статусам».
//
// Причина: паспорт кладёт в `config.statuses.items` ЦИКЛ СВОЕГО ТИПА — так меню
// смены статуса предлагает только свои статусы (S4-STATUS-AXIS-CONFIG). Дочерняя
// таблица (задачи спринта) искала оформление своих строк в том же цикле: код
// задачи, которого у спринта нет, давал «неизвестно», а совпавший код — иконку
// и подпись спринта.
//
// Правило: оформление статуса записи берётся по паре «вид записи + код» —
// `statuses.byKind[kind]`, если приложение дало цикл этого вида; иначе — общий
// словарь, как раньше. Меню смены статуса по-прежнему строится из `items`.
// Иконки не регистрируются: GameIcon без набора рисует заглушку с data-missing =
// слаг — по нему и видно, какую иконку выбрали.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordRelations } from './RecordRelations';
import { StatusPill } from './fmt';

const SPRINT_CYCLE = [
  { code: 'active', title: 'Идёт', category: 'active' as const, icon: 'run', color: 'var(--inf)' },
  { code: 'closed', title: 'Закрыт', category: 'done' as const, icon: 'locked-chest', color: 'var(--t3)' },
];
const TASK_CYCLE = [
  { code: 'active', title: 'В работе', category: 'active' as const, icon: 'quill-ink', color: 'var(--acc)' },
  { code: 'review', title: 'На проверке', category: 'active' as const, icon: 'magnifying-glass', color: 'var(--wrn)' },
];

const config = (byKind?: KitConfig['statuses']['byKind']): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: { title: 'Спринт', icon: 'sprint', relations: [{ key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'HAS_TASK', dir: 'out' }] },
    task: { title: 'Задача', icon: 'checklist' },
  },
  statuses: { items: SPRINT_CYCLE, ...(byKind ? { byKind } : {}) },
});

const sprint: KitRecord = { id: 'SP', kind: 'sprint', title: 'Спринт', status: 'active', fields: {} };
const t1: KitRecord = { id: 'T-1', kind: 'task', title: 'Задача 1', status: 'active', fields: {} };
const t2: KitRecord = { id: 'T-2', kind: 'task', title: 'Задача 2', status: 'review', fields: {} };

const ctxOf = (cfg: KitConfig): KitCtx => ({
  config: cfg,
  data: { records: [sprint, t1, t2], edges: [{ from: 'SP', to: 'T-1', type: 'HAS_TASK' }, { from: 'SP', to: 'T-2', type: 'HAS_TASK' }], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  href: id => `?open=${id}`, esc: s => s, md: s => s,
});

const cell = (id: string) => document.querySelector(`[data-record-id="${id}"] [data-status]`) as HTMLElement | null
  ?? [...document.querySelectorAll('tr')].find(tr => tr.textContent?.includes(id))?.querySelector('[data-status]') as HTMLElement;
const iconOf = (el: HTMLElement) => el.querySelector('[data-missing]')?.getAttribute('data-missing');

describe('статус дочерней строки — по циклу её вида, а не вида паспорта', () => {
  const show = (cfg: KitConfig) => render(<RecordRelations record={sprint} ctx={ctxOf(cfg)} defs={cfg.kinds.sprint.relations!} lang="ru" />);

  it('совпавший код (active) — иконка и подпись задачи, а не спринта', () => {
    show(config({ task: TASK_CYCLE, sprint: SPRINT_CYCLE }));
    const c = cell('T-1');
    expect(iconOf(c)).toBe('quill-ink');
    expect(c.textContent).toContain('В работе');
  });

  it('код, которого у спринта нет (review), — оформление задачи, а не «неизвестно»', () => {
    show(config({ task: TASK_CYCLE }));
    const c = cell('T-2');
    expect(iconOf(c)).toBe('magnifying-glass');
    expect(c.textContent).toContain('На проверке');
  });

  it('приложение циклов по видам не дало — как раньше, общий словарь', () => {
    show(config());
    expect(iconOf(cell('T-1'))).toBe('run');
  });

  it('плашка статуса записи (Peek, шапка) — тоже по виду записи', () => {
    const { container } = render(<StatusPill code="review" kind="task" ctx={ctxOf(config({ task: TASK_CYCLE }))} unknownTitle="?" />);
    expect(container.querySelector('[data-missing]')?.getAttribute('data-missing')).toBe('magnifying-glass');
    expect(container.textContent).toBe('На проверке');
  });
});
