// @vitest-environment jsdom
// Паспорт на телефоне — по образцу v1 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-COMPARE,
// решение владелицы D-2026-UXR-MOBILE-FOLLOWS-V1: «образец мобильного вида — старый v1»).
//
// ЗАМЕР живого v2 (360×800, pointer: coarse):
//  • колонка записи `.sk-rec` — 227 px из 360: поля дока, рамка и плавающая «×»
//    (float рядом с блоком-сеткой сужает ВЕСЬ блок, а не одну строку) съедали
//    треть ширины;
//  • у спринта ДВА ряда управления: сегмент «Контент · Свойства · Аналитика» и
//    под ним вкладки «Контент · Ещё 8» — задачи спрятаны под «Ещё»;
//  • заголовок 20 px в семь строк.
// В v1: паспорт во весь экран без полей, один ряд вкладок, у спринта первыми — задачи.
//
// ПРАВИЛА (на узком экране, порог kit — NARROW_QUERY):
//  1. Один ряд вкладок. Сегмент видов не рисуется; всё, что было под ним
//     («Свойства», связи, граф, журнал, история), — вкладками того же ряда
//     (что не влезло — под «Ещё»). Ничего не пропадает.
//  2. Вкладка не выбрана — открыта ПЕРВАЯ вкладка ряда в порядке модели
//     (у спринта модель ставит первыми задачи). На десктопе — по-прежнему обзор.
//  3. CSS: у дока на телефоне нет рамки и полей шире ~12 px, «×» не сужает
//     запись, заголовок не крупнее --fs-lg.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import { NARROW_QUERY } from '../core/narrow';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: { goal: 'цель' } });
const sprint = r('SPRINT_X', 'sprint', 'Спринт');
const records = [sprint, r('T-1', 'task', 'Задача 1'), r('T-2', 'task', 'Задача 2')];
const edges = [
  { from: 'SPRINT_X', to: 'T-1', type: 'HAS_TASK' },
  { from: 'SPRINT_X', to: 'T-2', type: 'HAS_TASK' },
];
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'scroll-quill',
      fields: [{ key: 'goal', title: 'Цель', type: 'text' }],
      tabs: [{ key: 'tasks', title: 'Задачи', render: () => 'таблица задач' }],
      relations: [{ key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'HAS_TASK', dir: 'out' }],
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};
const ctx: KitCtx = {
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
};
// Порядок модели для спринта — как у сервера (LorePassportSurface: tasks, content, …).
const order: PassportOrder = {
  decided: true, notes: [],
  sections: [
    { key: 'tasks', source: 'part', ref: 'tasks', order: 0, slot: 'own', group: null },
    { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
  ],
};

let narrow = false;
const w = window as unknown as { matchMedia?: unknown };
const orig = w.matchMedia;
beforeEach(() => {
  w.matchMedia = (q: string) => ({ matches: q === NARROW_QUERY ? narrow : false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); w.matchMedia = orig; narrow = false; });

const view = (tab: string, placement: 'right' | 'bottom' | 'full' = 'right') =>
  render(<RecordView record={sprint} ctx={ctx} tab={tab} onTab={() => {}} placement={placement} sections={order} />);
const label = (el: Element) => (el.textContent ?? '').replace(/[◆◇⇢▷△]/g, '').replace(/\d+$/, '').trim();
/** Все разделы ряда: видимые вкладки и то, что под «Ещё». */
const reachable = (): string[] => {
  const more = document.querySelector('.sk-tabs__more-btn');
  if (more) fireEvent.click(more);
  const tabs = screen.getAllByRole('tab').filter(t => !t.classList.contains('sk-tabs__more-btn')).map(label);
  const menu = screen.queryAllByRole('menuitem').map(label);
  return [...tabs, ...menu];
};

describe('S4-MOBILE-COMPARE · паспорт на телефоне — один ряд вкладок', () => {
  it('положительный контроль (десктоп, панель справа): сегмент видов есть, как прежде', () => {
    view('overview');
    expect(document.querySelector('.sk-rec__modes')).not.toBeNull();
  });

  it('телефон: сегмента видов нет, ряд вкладок один', () => {
    narrow = true;
    view('overview');
    expect(document.querySelector('.sk-rec__modes')).toBeNull();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('телефон: всё, что было под сегментом, достижимо из того же ряда', () => {
    narrow = true;
    view('overview');
    const all = reachable();
    for (const name of ['Задачи', 'Контент', 'Свойства', 'Связи', 'Граф', 'Журнал']) expect(all).toContain(name);
  });
});

describe('S4-MOBILE-COMPARE · у спринта на телефоне первой открыта вкладка «Задачи»', () => {
  it('положительный контроль (десктоп): без выбранной вкладки — обзор', () => {
    view('');
    // «Контент» — имя сегмента видов, во вкладках его нет (сегмент и означает контент).
    expect(within(screen.getByRole('group', { name: 'Вид паспорта' })).getByRole('button', { pressed: true }).textContent).toBe('Контент');
  });

  it('телефон: без выбранной вкладки — первая по модели, «Задачи»', () => {
    narrow = true;
    view('');
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Задачи');
    expect(screen.getByText('таблица задач')).toBeTruthy();
  });

  it('телефон: выбранный «Контент» остаётся контентом — выбор человека главнее', () => {
    narrow = true;
    view('overview');
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Контент');
  });
});

describe('S4-MOBILE-COMPARE · CSS паспорта на телефоне', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  /** Тела всех блоков @media (max-width: 720px), склеенные. */
  const narrowCss = (() => {
    const out: string[] = [];
    let at = css.indexOf('@media (max-width: 720px)');
    while (at >= 0) {
      let i = css.indexOf('{', at) + 1;
      let depth = 1;
      const start = i;
      while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
      out.push(css.slice(start, i - 1));
      at = css.indexOf('@media (max-width: 720px)', i);
    }
    return out.join('\n');
  })();
  const ruleIn = (src: string, sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Все правила с этим селектором, склеенные: у одного селектора их бывает несколько.
    const re = new RegExp(`(^|[\\n}])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g');
    return [...src.matchAll(re)].map(m => m[2]).join(';');
  };

  it('положительный контроль: десктопные поля дока на месте', () => {
    expect(ruleIn(css, '.sk-dock__panel')).toMatch(/padding:\s*12px 14px/);
    expect(ruleIn(css, '.sk-rec-head__title')).toMatch(/font-size:\s*var\(--fs-xl\)/);
  });

  it('телефон: у дока нет рамки и скругления', () => {
    const rule = ruleIn(narrowCss, '.sk-dock[data-placement]');
    expect(rule).toMatch(/border:\s*0/);
    expect(rule).toMatch(/border-radius:\s*0/);
  });

  it('телефон: поля панели — внутренний отступ 12 px, не больше', () => {
    expect(ruleIn(narrowCss, '.sk-dock[data-placement] .sk-dock__panel')).toMatch(/padding:\s*8px 12px/);
  });

  it('телефон: «×» не сужает запись (поле обтекания у плавающей кнопки снято)', () => {
    expect(ruleIn(narrowCss, '.sk-dock[data-placement] .sk-dock__close')).toMatch(/margin-bottom:\s*calc\(-1 \*/);
  });

  it('телефон: заголовок записи не крупнее --fs-lg', () => {
    expect(ruleIn(narrowCss, '.sk-rec-head__title')).toMatch(/font-size:\s*var\(--fs-lg\)/);
  });
});
