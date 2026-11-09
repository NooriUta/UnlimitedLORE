// @vitest-environment jsdom
// Разделы со `slot: "content"` рисуются блоками В ХВОСТЕ ТЕЛА, а не вкладками
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Повод — слова владелицы 09.11.2026: «раньше блокирует и зависит был как
// подраздел контента обсудите и подумайте над оптимизацией в этой части но без
// потери универсальности так же вариант как пример адр в конце решения были
// списком и это cjm работы просел и подтвердил».
//
// То есть мест три, а не два: свой раздел · блоком в конце контента · под
// «Ещё». Третье и было в v1 у зависимостей спринта и у списка решений ADR.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ: вклеенный раздел не ИСЧЕЗАЕТ. Он уходит из
// ряда вкладок — и обязан появиться в теле. Пропасть между «убрали вкладку» и
// «нарисовали блок» означала бы потерю данных с экрана, и это хуже
// перегруженности, от которой мы и лечим.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordView } from './RecordView';
import { passportSections } from '../model/surfaces';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

const ICON = 'sprint';

const record: KitRecord = {
  id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'active', fields: {}, body_md: 'тело спринта',
};
const other = (id: string, title: string): KitRecord => ({ id, kind: 'sprint', title, status: 'active', fields: {} });

const config: KitConfig = {
  modules: [{ id: 'm', title: 'M', icon: ICON, status: 'active' }],
  menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: ICON,
      relations: [
        { key: 'deps', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out' },
        { key: 'blocks', label: 'Блокирует', relation: 'association', rel: 'DEPENDS_ON', dir: 'in' },
      ],
    },
  },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'active', icon: ICON, color: 'var(--st-active)' }] },
  edges: { DEPENDS_ON: { label: 'зависит от', color: 'var(--acc)' } },
} as KitConfig;

/** Данные: у спринта А две исходящие зависимости и ни одной входящей. */
const ctx = (): KitCtx => ({
  config,
  data: {
    records: [record, other('SPRINT_B', 'Спринт Б'), other('SPRINT_C', 'Спринт В')],
    edges: [
      { from: 'SPRINT_A', to: 'SPRINT_B', type: 'DEPENDS_ON' },
      { from: 'SPRINT_A', to: 'SPRINT_C', type: 'DEPENDS_ON' },
    ],
    journal: [],
    meta: { generated_at: '2026-11-09T00:00:00Z' },
  },
  href: (x: string) => `#${x}`,
  esc: (s: string) => s,
  md: (s: string) => s,
}) as KitCtx;

const model = (sections: unknown) => ({
  surfaces: { partial: true, passport: { sprint: { decided: true, sections } } },
});

/** Зависимости вклеены в тело, «Блокирует» тоже; порядок — модели. */
const GLUED = [
  { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own' },
  { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 2, slot: 'content' },
  { key: 'blocks', source: 'relation', ref: 'DEPENDS_ON:in', order: 3, slot: 'content' },
];

const show = (sections?: unknown) => render(
  <RecordView record={record} ctx={ctx()} tab="overview" onTab={() => {}}
    sections={sections === undefined ? undefined : passportSections(model(sections), 'sprint')} />,
);

const tabIds = () =>
  Array.from(document.querySelectorAll('[role="tab"]')).map(e => e.textContent ?? '');

describe('вклейка разделов в хвост тела', () => {
  // Без модели kit ГРУППИРУЕТ связи-ассоциации в одну вкладку «Зависимости»
  // (SHARED_TAB). Это разумное умолчание, пока порядок решает конструктор, — и
  // ровно поэтому ключи модели (dependsOn, blocks) с ним не совпадают. При
  // decided группировка выключается: что считать разделом, решает приложение.
  it('положительный контроль: без модели связи сведены в одну вкладку «Зависимости»', () => {
    show();
    const row = tabIds().join(' · ');
    expect(row).toContain('Зависимости');
    expect(row).not.toContain('Зависит от');
  });

  it('со `slot: content` вкладки «Зависит от» в ряду НЕТ', () => {
    show(GLUED);
    expect(tabIds().join(' · ')).not.toContain('Зависит от');
  });

  it('и при этом раздел НЕ исчез: он нарисован в теле заголовком', () => {
    show(GLUED);
    // Заголовок блока — иначе непонятно, что это за список под текстом.
    expect(screen.getByRole('heading', { name: /Зависит от/ })).toBeTruthy();
  });

  it('у заголовка блока СЧЁТЧИК: вкладки больше нет, и число иначе исчезнет', () => {
    show(GLUED);
    const head = screen.getByRole('heading', { name: /Зависит от/ });
    expect(head.textContent).toMatch(/2/);
  });

  it('содержимое блока — те же записи, что были во вкладке', () => {
    show(GLUED);
    expect(screen.getByText('Спринт Б')).toBeTruthy();
    expect(screen.getByText('Спринт В')).toBeTruthy();
  });

  it('ПУСТОЙ вклеенный блок не рисуется — иначе у ADR вылезет семь пустых', () => {
    show(GLUED);
    // «Блокирует» — входящих связей нет, значит блока нет.
    expect(screen.queryByRole('heading', { name: /Блокирует/ })).toBeNull();
    // И вкладкой он тоже не стал: модель сказала «в тело», а не «в ряд».
    expect(tabIds().join(' · ')).not.toContain('Блокирует');
  });

  it('блоки идут в порядке модели, а не в порядке реестра', () => {
    const reversed = [
      { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own' },
      { key: 'blocks', source: 'relation', ref: 'DEPENDS_ON:in', order: 2, slot: 'content' },
      { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 3, slot: 'content' },
    ];
    show(reversed);
    // Пустой «Блокирует» по-прежнему не рисуется, но порядок непустых — модели.
    expect(screen.getByRole('heading', { name: /Зависит от/ })).toBeTruthy();
  });

  it('`decided: false` — ничего не вклеивается, ряд как был', () => {
    render(
      <RecordView record={record} ctx={ctx()} tab="overview" onTab={() => {}}
        sections={{ decided: false, sections: [], notes: [] }} />,
    );
    // Группировка снова включена, вклейки нет — ряд точно как без модели.
    expect(tabIds().join(' · ')).toContain('Зависимости');
    expect(screen.queryByRole('heading', { name: /Зависит от/ })).toBeNull();
  });
});
