// @vitest-environment jsdom
// K4-MENTION-LOOK (SPRINT_UXR_S13_KIT4): упоминание чужого объекта везде одинаково —
// значок и цвет его вида + ссылка. Владелица 11.11.2026: «все упоминания в объектах
// чужих объектов имели иконки и расцветку соответствующего канонического объекта и
// ссылку на него».
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { ObjectMention, mentionColor, mentionLook } from './ObjectMention';
import { registerGameIcons } from './GameIcon';
import { RecordRef } from '../record/fmt';
import { RecordLinks } from '../record/RecordLinks';
import { ValueChips } from '../record/ValueChips';
import { RelationField } from '../record/RelationField';
import { MartProse } from '../content/MartProse';

registerGameIcons({ prefix: 'game-icons', icons: { 'scroll-quill': { body: '<path d="M0 0h1"/>' }, cog: { body: '<path d="M1 1h1"/>' }, 'open-folder': { body: '<path d="M2 2h1"/>' } }, width: 512, height: 512 });

const kinds: KitConfig['kinds'] = {
  adr: { title: 'ADR', icon: 'scroll-quill', color: 'var(--type-adrs)' },
  component: { title: 'Компонент', icon: 'cog', color: 'var(--type-components)' },
  project: { title: 'Проект', icon: 'open-folder' },
};
const config: KitConfig = { modules: [], menu: { groups: [] }, kinds, statuses: { items: [] } };
const ctxOf = (records: KitRecord[], extra: Partial<KitConfig> = {}): KitCtx => ({
  config: { ...config, ...extra },
  data: { records, edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
});
const adr: KitRecord = { id: 'ADR-LORE-050', kind: 'adr', title: 'Ссылки в MD', status: '', fields: {} };

/** Упоминание окрашено цветом своего вида и несёт его значок. */
function expectLook(el: Element | null, kind: string, color: string) {
  expect(el, `упоминание вида ${kind}`).toBeTruthy();
  const m = el!.closest('[data-mention]') ?? el!.querySelector('[data-mention]');
  expect(m, 'элемент упоминания').toBeTruthy();
  expect(m!.getAttribute('data-kind')).toBe(kind);
  expect((m as HTMLElement).style.getPropertyValue('--mention-c')).toBe(color);
  const icon = m!.querySelector('.sk-mention__icon') as HTMLElement | null;
  expect(icon).toBeTruthy();
  // Значок окрашен цветом вида: инлайн-цвет GameIcon (currentColor) перебил бы класс.
  expect(icon!.style.color === '' || icon!.style.color === 'var(--mention-c)', `цвет значка: ${icon!.style.color}`).toBe(true);
}

describe('ObjectMention — один элемент упоминания', () => {
  it('значок и цвет вида + ссылка', () => {
    const { container } = render(<ObjectMention id="ADR-LORE-050" kind="adr" title="Ссылки в MD" href="#ADR-LORE-050" kinds={kinds} />);
    const a = container.querySelector('a[data-mention]')!;
    expect(a.getAttribute('href')).toBe('#ADR-LORE-050');
    expectLook(a, 'adr', 'var(--type-adrs)');
    expect(a.textContent).toContain('Ссылки в MD');
    expect(a.getAttribute('title')).toBe('ADR: ADR-LORE-050');
  });
  it('нет адреса — текст без ссылки, а не ссылка в никуда', () => {
    const { container } = render(<ObjectMention id="X-1" kind="adr" kinds={kinds} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-nolink]')).toBeTruthy();
  });
  it('вид без цвета — значок есть, цвета нет (не выдумываем)', () => {
    const { container } = render(<ObjectMention id="p" kind="project" href="#p" kinds={kinds} />);
    const a = container.querySelector('a')!;
    expect(a.querySelector('.sk-mention__icon')).toBeTruthy();
    expect(a.style.getPropertyValue('--mention-c')).toBe('');
    expect(a.hasAttribute('data-tinted')).toBe(false);
  });
  it('вид неизвестен — нейтрально, без значка', () => {
    const { container } = render(<ObjectMention id="q" kind="nope" href="#q" kinds={kinds} />);
    expect(container.querySelector('.sk-mention__icon')).toBeNull();
  });
  it('код печатается один раз, если название и есть код', () => {
    const { container } = render(<ObjectMention id="NooriUta/X" title="nooriuta/x" href="#" kinds={kinds} showId />);
    expect(container.querySelectorAll('.sk-pill--id').length).toBe(0);
  });
  it('цвет: токен как есть, имя токена — var()', () => {
    expect(mentionColor('var(--type-adrs)')).toBe('var(--type-adrs)');
    expect(mentionColor('--type-adrs')).toBe('var(--type-adrs)');
    expect(mentionColor('type-adrs')).toBe('var(--type-adrs)');
    expect(mentionColor('')).toBeUndefined();
    expect(mentionLook(kinds, 'ADR')?.icon).toBe('scroll-quill');
  });
});

describe('места упоминаний идут через ObjectMention', () => {
  it('RecordRef (свойства, связи строкой)', () => {
    const { container } = render(<RecordRef id="ADR-LORE-050" ctx={ctxOf([adr])} />);
    expectLook(container.querySelector('a'), 'adr', 'var(--type-adrs)');
  });
  it('RecordLinks (вкладка «Связи» списком)', () => {
    const ctx = ctxOf([adr], {});
    ctx.data.edges = [{ from: 'D-1', to: 'ADR-LORE-050', type: 'DECIDED_IN' }];
    const { container } = render(<RecordLinks record={{ id: 'D-1', kind: 'decision', title: 'Д', status: '', fields: {} }} ctx={ctx} lang="ru" />);
    expectLook(container.querySelector('.sk-rec-links__item a'), 'adr', 'var(--type-adrs)');
  });
  it('ValueChips: вид поля (refKind) красит чипы', () => {
    const { container } = render(<ValueChips value={[{ id: 'FORSETI', label: 'Forseti' }]} href={id => `#${id}`} kind="component" kinds={kinds} />);
    expectLook(container.querySelector('.sk-rec-chips__item a'), 'component', 'var(--type-components)');
  });
  it('ValueChips: вид, названный самим чипом, главнее вида поля', () => {
    const { container } = render(<ValueChips value={[{ id: 'ADR-1', label: 'A', kind: 'adr' }]} href={id => `#${id}`} kind="component" kinds={kinds} />);
    expectLook(container.querySelector('.sk-rec-chips__item a'), 'adr', 'var(--type-adrs)');
  });
  it('RelationField: чипы правимой связи', () => {
    const ctx = ctxOf([], { hooks: { onRelation: async () => {} }, roles: { reader: { canEdit: true, canStatus: false } } });
    const { container } = render(<RelationField record={{ id: 'T-1', kind: 'task', title: 'T', status: '', fields: {} }} ctx={ctx} lang="ru" label="Компоненты"
      value={[{ id: 'FORSETI', label: 'Forseti' }]} rel="BELONGS_TO" dir="out" refKind="component" view={null} />);
    expectLook(container.querySelector('.sk-relfield__chip a'), 'component', 'var(--type-components)');
  });
  it('MD: [[тип:код]] в чтении получает значок и цвет вида', () => {
    const { container } = render(<MartProse text="см. [[adr:ADR-LORE-050]]" refHref={r => `#${r.id}`}
      refLook={r => mentionLook(kinds, r.type)} />);
    const ref = container.querySelector('.sk-wref')!;
    expect(ref.tagName).toBe('A');
    expect(ref.getAttribute('data-kind')).toBe('adr');
    expect((ref as HTMLElement).style.getPropertyValue('--mention-c')).toBe('var(--type-adrs)');
    expect(ref.querySelector('svg.sk-mention__icon')).toBeTruthy();
    expect(ref.textContent).toContain('ADR-LORE-050');
  });
  it('MD: без облика — рамка как была, без значка', () => {
    const { container } = render(<MartProse text="см. [[ADR-LORE-050]]" refHref={r => `#${r.id}`} refLook={() => null} />);
    expect(container.querySelector('.sk-wref svg')).toBeNull();
  });
});

describe('тема: токены цвета видов и правило упоминания', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  it('токены --type-* канона объявлены темой', () => {
    for (const t of ['adrs', 'components', 'decisions', 'features', 'milestones', 'releases', 'sprints', 'tech']) {
      expect(css, `--type-${t}`).toMatch(new RegExp(`--type-${t}\\s*:`));
    }
  });
  it('значок упоминания окрашен цветом вида', () => {
    expect(css).toMatch(/\.sk-mention__icon\s*\{[^}]*var\(--mention-c/);
  });
});
