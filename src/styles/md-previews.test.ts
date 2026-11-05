import { describe, expect, it } from 'vitest';
import { mdExcerpt } from '../components/lore/markdown';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10 (хвосты) · превью markdown — через MartProse.
 *
 * Превью описания релиза и main-текст/вариации публикаций BRAGI выводились
 * сырой строкой: на экране висели «##», «**» и «- [ ]» вместо разметки.
 * Гвард: поле `…_md` (и тексты вариаций) не подставляются в JSX голым `{…}`.
 */
const tsx = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (tail: string) => {
  const hit = Object.entries(tsx).find(([p]) => p.endsWith(tail));
  if (!hit) throw new Error(`исходник не найден: ${tail}`);
  return hit[1];
};

// `>{x.description_md.slice(…)}<` / `>{pub.main_text_md}<` / `>{pub.variant_texts[i]}<`
const RAW_MD_CHILD = />\s*\{[\w.?]*(?:_md|variant_texts\[\w+\])(?:\.slice\([^)]*\))?(?:\s*\?\?[^}]*)?\}\s*</g;

describe('AH-10 · превью markdown рендерится MartProse', () => {
  for (const file of ['/components/lore/LoreReleasesBoard.tsx', '/components/lore/LoreBragiPublications.tsx']) {
    it(file, () => {
      const s = src(file);
      expect(s.match(RAW_MD_CHILD) ?? []).toEqual([]);
      expect(s).toMatch(/<MartProse\b/);
    });
  }
  it('детектор', () => {
    expect('<span style={s}>{r.description_md.slice(0, 110)}</span>'.match(RAW_MD_CHILD)).not.toBeNull();
    expect('<div style={s}>{pub.main_text_md ?? t(\'a.b\', \'x\')}</div>'.match(RAW_MD_CHILD)).not.toBeNull();
    expect('<div style={s}>{pub.variant_texts[i]}</div>'.match(RAW_MD_CHILD)).not.toBeNull();
    expect('<MartProse text={pub.main_text_md} />'.match(RAW_MD_CHILD)).toBeNull();
  });
});

describe('mdExcerpt — короткое превью без разорванной разметки', () => {
  it('короткий текст — как есть', () => {
    expect(mdExcerpt('**жирный** текст', 110)).toBe('**жирный** текст');
  });
  it('длинный — режется по границе строки, а не посреди', () => {
    const md = '## Итоги\n\nпервая строка\nвторая строка, которая уже не влезает в лимит';
    expect(mdExcerpt(md, 30)).toBe('## Итоги\n\nпервая строка …');
  });
  it('одна длинная строка — по слову и с многоточием', () => {
    expect(mdExcerpt('слово слово слово слово', 12)).toBe('слово слово …');
  });
  it('пусто — пусто', () => {
    expect(mdExcerpt(null, 10)).toBe('');
    expect(mdExcerpt('   ', 10)).toBe('');
  });
});
