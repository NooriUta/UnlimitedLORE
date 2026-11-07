import { describe, expect, it } from 'vitest';
import { sourceOf } from '../test/sourceOf';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10 (хвосты) · тап-цели и кликабельность вне админки.
 *
 * Админка получила тап-цели 40px (tapMin), а остальной интерфейс — нет: кнопки
 * шапки ~22px, тулбар TipTap 22px, «+ новый спринт» 20px, а ✕ поиска и
 * навигация календаря BRAGI были вообще <span> — ни фокуса, ни Enter, ни
 * подписи для экранного диктора. Точечная починка забывается, поэтому:
 *   1) общее правило в tokens.css — токены --tap / --tap-main и классы
 *      .lore-tap / .lore-tap-main (32px / 40px на узком экране);
 *   2) гвард по исходникам: в перечисленных файлах элемент с onClick — это
 *      <button> (или span/div с role="button" через a11yClick), а не голый span/div;
 *   3) стрелка-приглашение «→ …» без обработчика — мёртвая ссылка.
 */
const css = import.meta.glob('./tokens.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// SPRINT_UXR_S0_SAFETY/S0-07: исходник ищется по объявленному компоненту, а не по
// пути — перенос файла в другую папку гвард не роняет (src/test/sourceOf.ts).
// Что тулбар TipTap реально рисует кнопки .lore-tap — рендер-тест
// TipTapField.tapTargets.render.test.tsx, а не поиск строки.
const src = sourceOf;

/** Открывающие теги <span …>/<div …> (с учётом `=>` и `{…}` внутри атрибутов). */
function openTags(source: string, tags: string[]): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(${tags.join('|')})\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    out.push(source.slice(m.index, i + 1));
  }
  return out;
}

/** span/div с onClick, но без role="button" — кликабельный не-контрол. */
export function clickableNonButtons(source: string): string[] {
  return openTags(source, ['span', 'div']).filter(tag =>
    /\bonClick=/.test(tag)
    && !/\brole=["']button["']/.test(tag)
    && !/\{\.\.\.a11yClick\(/.test(tag)
    // контейнер, который только гасит всплытие, — не контрол
    && !/onClick=\{\s*\(?e\)?\s*=>\s*e\.stopPropagation\(\)\s*\}/.test(tag));
}

/** <span>, чей текст — стрелка-приглашение «→ …», но обработчика нет. */
export function deadArrowLinks(source: string): string[] {
  const re = /<span\b([^>]*)>\s*\{t\('[^']+',\s*'[^']*→[^']*'/g;
  return [...source.matchAll(re)].filter(m => !/onClick=/.test(m[1])).map(m => m[0]);
}

// Компоненты, где элемент с onClick обязан быть контролом (ищутся по имени, не по пути).
const CLICK_COMPONENTS = [
  'AppShell',
  'TipTapField',
  'LorePage',
  'LoreBragiPlan',
  'LoreBragiScreen',
  'LoreBragiInsights',
  'LoreReleasesBoard',
  'LoreBragiPublications',
];

describe('AH-10 · общее правило тап-целей в tokens.css', () => {
  const tokens = Object.values(css)[0] ?? '';
  it('токены --tap/--tap-main: на десктопе 0, на узком 32px / 40px', () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*--tap:\s*0px;[^}]*--tap-main:\s*0px;/);
    expect(tokens).toMatch(/@media \(max-width: 768px\)\s*\{\s*:root\s*\{\s*--tap:\s*32px;\s*--tap-main:\s*40px;/);
  });
  it('классы .lore-tap и .lore-tap-main берут min-размеры из токенов', () => {
    expect(tokens).toMatch(/\.lore-tap\s*\{[^}]*min-height:\s*var\(--tap\);[^}]*min-width:\s*var\(--tap\);/);
    expect(tokens).toMatch(/\.lore-tap-main\s*\{[^}]*min-height:\s*var\(--tap-main\);[^}]*min-width:\s*var\(--tap-main\);/);
  });
});

describe('AH-10 · мелкие контролы вне админки подключены к правилу', () => {
  // TipTapField (класс + отсутствие инлайна 22px) — рендером, см. шапку файла.
  const USES: [string, RegExp][] = [
    ['AppShell', /className="lore-tap"/],
    ['LorePage', /className="lore-tap-main"/],
    ['LoreBragiPlan', /className="lore-tap"/],
  ];
  for (const [name, re] of USES) it(name, () => { expect(src(name)).toMatch(re); });
});

describe('AH-10 · кликабельный span/div — только с role="button"', () => {
  for (const name of CLICK_COMPONENTS) {
    it(name, () => { expect(clickableNonButtons(src(name))).toEqual([]); });
  }
  it('детектор ловит нарушение и пропускает разрешённое', () => {
    expect(clickableNonButtons('<span style={S.x} onClick={() => go(a > b)}>✕</span>')).toHaveLength(1);
    expect(clickableNonButtons('<div onClick={f}>x</div>')).toHaveLength(1);
    expect(clickableNonButtons('<span role="button" tabIndex={0} onClick={f}>x</span>')).toEqual([]);
    expect(clickableNonButtons('<span {...a11yClick(f)} style={s}>x</span>')).toEqual([]);
    expect(clickableNonButtons('<div style={S.d} onClick={e => e.stopPropagation()}>x</div>')).toEqual([]);
    expect(clickableNonButtons('<button onClick={f}>x</button>')).toEqual([]);
  });
});

describe('AH-10 · BRAGI: стрелка «→ …» без обработчика — мёртвая ссылка', () => {
  for (const name of ['LoreBragiScreen', 'LoreBragiInsights']) {
    it(name, () => { expect(deadArrowLinks(src(name))).toEqual([]); });
  }
  it('детектор', () => {
    expect(deadArrowLinks(`<span style={S.m}>{t('a.b', 'связи → Forseti')}</span>`)).toHaveLength(1);
    expect(deadArrowLinks(`<span style={S.m} onClick={go}>{t('a.b', '→ X')}</span>`)).toEqual([]);
    expect(deadArrowLinks(`<span style={S.m}>{t('a.b', 'просто текст')}</span>`)).toEqual([]);
  });
  it('чипы инсайтов ведут в паспорт через общую карту ссылок', () => {
    expect(src('LoreBragiInsights')).toMatch(/searchHitHref\('task'/);
    expect(src('LoreBragiInsights')).toMatch(/searchHitHref\('adr'/);
  });
});
