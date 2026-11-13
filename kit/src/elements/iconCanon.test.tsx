// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-25 — канон иконок по выбору владелицы (SPEC-LORE-UXR-ICONS, 08.11).
// Правило: иконки — из старого UI (v1), где у v1 два набора: game-icons и lucide.
// Один словарь (ICON_CANON) на весь kit и v2; компоненты берут иконку отсюда,
// а не пишут слаг на месте. Тест сверяет словарь с выбором и сторожит, чтобы
// заменённые слаги не вернулись в код строкой.
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { GameIcon, SECTION_ICONS, hasGameIcon, registerGameIcons } from './GameIcon';
import { ICON_CANON } from './iconCanon';
import { validateKitConfig } from '../core/validate';

beforeAll(() => { registerGameIcons(gameIcons); });

/** Выбор владелицы 08.11 — дословно её итог (пункты 1–36), null — «без иконки». */
const CHOICE: Record<keyof typeof ICON_CANON, string | null> = {
  sectionTask: 'lucide:list-checks', sectionNews: 'lucide:megaphone', sectionSettings: 'cog',
  segFilter: 'lucide:filter', segGroup: 'lucide:group', segSort: 'lucide:list-ordered',
  viewList: 'lucide:list', viewBoard: 'lucide:columns-3',
  statusDraft: 'quill-ink', statusDeprecated: 'broken-tablet', statusUnknown: 'help',
  myViews: 'lucide:star', saveView: 'lucide:save', recent: 'lucide:history', scopeAll: 'lucide:layers',
  commands: 'lucide:command', views: 'lucide:eye', team: null,
  quickNoRelease: null, quickNoDecisions: 'lucide:file-question',
  newsReady: 'wave-crest', newsCancelled: 'lucide:circle-x', newsVersion: 'upgrade', newsReactivated: 'lucide:undo-2',
  prioP0: 'lucide:flame', prioP1: 'lucide:chevron-up', prioP2: 'lucide:equal', prioP3: 'lucide:chevron-down',
  fieldProject: 'castle',
  ctlMenu: 'lucide:menu', ctlDelete: 'lucide:trash-2', ctlTreeToggle: 'lucide:chevron-right', ctlEdit: 'lucide:pencil', ctlReading: 'lucide:book-open',
  // Выбор владелицы 09.11.2026 (S4-30, мини-версия зоны «только иконками»): на
  // предложение «Свойства — sliders-horizontal, Граф — share-2, Аналитика —
  // bar-chart-3» ответила «три». Третья в lucide 1.70 называется chart-column —
  // то же изображение, переименовано вверх по течению.
  recProps: 'lucide:sliders-horizontal', recGraph: 'lucide:share-2', recAnalytics: 'lucide:chart-column',
};

describe('ICON_CANON = выбор владелицы', () => {
  it('словарь совпадает с выбором пункт в пункт', () => {
    expect(ICON_CANON).toEqual(CHOICE);
  });
  it('каждая иконка словаря есть в зарегистрированных наборах (game-icons + вшитый lucide)', () => {
    for (const [k, v] of Object.entries(ICON_CANON)) if (v) expect(hasGameIcon(v), `${k}: ${v}`).toBe(true);
  });
  it('lucide рисуется офлайн, а не заглушкой «нет иконки»', () => {
    const { container } = render(<GameIcon slug="lucide:list-checks" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-missing]')).toBeNull();
  });
  it('разделы и приложения (SECTION_ICONS) — из словаря; у «Командных» иконки нет', () => {
    expect(SECTION_ICONS.news).toBe(ICON_CANON.sectionNews);
    expect(SECTION_ICONS.filter).toBe(ICON_CANON.segFilter);
    expect(SECTION_ICONS.commands).toBe(ICON_CANON.commands);
    expect(SECTION_ICONS.views).toBe(ICON_CANON.views);
    expect('team' in SECTION_ICONS).toBe(false);
  });
  it('контракт: слаг lucide:… проходит проверку конфига, мусор — нет', () => {
    const cfg = (icon: string) => ({ modules: [{ id: 'm', title: 'M', icon }], menu: { groups: [] }, kinds: {}, statuses: { items: [] } });
    const iconErr = (icon: string) => validateKitConfig(cfg(icon)).errors.some(e => e.code === 'icon-slug');
    expect(iconErr('lucide:list-checks')).toBe(false);
    expect(iconErr('Lucide: bad')).toBe(true);
  });
});

describe('сторож: заменённые слаги не вернулись строкой в код kit и web-next', () => {
  const REPLACED = ['checklist', 'newspaper', 'funnel', 'histogram', 'round-star', 'back-forth', 'lightning-trio', 'three-friends',
    'rocket', 'cancel', 'backward-time', 'fire', 'arrow-flights', 'plain-arrow', 'stone-tower', 'hamburger-menu', 'trash-can',
    'play-button', 'eye-target', 'laurel-crown'];
  const roots = [resolve(process.cwd(), 'src'), resolve(process.cwd(), '../web-next/src')];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\.|lucideIcons\.ts$|iconCanon\.ts$|statusMeta\.ts$|fixture/.test(n)) files.push(p);
    }
  };
  for (const r of roots) walk(r);

  it('положительный контроль: файлы найдены', () => {
    expect(files.length).toBeGreaterThan(50);
  });
  it.each(REPLACED)('«%s» не стоит иконкой в коде', slug => {
    const re = new RegExp(`(icon|slug|Icon)[^\\n]{0,40}['"]${slug}['"]|['"]${slug}['"][^\\n]{0,20}(icon|Icon)`);
    const hits = files.filter(f => readFileSync(f, 'utf8').split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && re.test(l)));
    expect(hits).toEqual([]);
  });
});
