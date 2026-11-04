import { describe, expect, it } from 'vitest';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10. Правило владельца: любое MD-поле в UI —
 * через TipTapField (MD + mermaid), не голая textarea. Нарушалось точечно:
 * тело решения в паспорте ADR, указание публикации и вариации BRAGI. Точечная
 * починка забывается — поэтому гвард: textarea, чьё value привязано к полю
 * Markdown (`…_md` / `…Md`), валит тест.
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// <textarea … value={…_md…} или value={…Md…} — в пределах одного тега.
const BARE_MD_TEXTAREA = /<textarea\b[^>]*?value=\{[^}]*?(?:_md|Md)\b[^}]*\}/gs;

describe('MD-поля — через TipTapField', () => {
  it('textarea не привязывается к полю Markdown', () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      const found = src.match(BARE_MD_TEXTAREA);
      if (found) offenders.push(`${path}: ${found.length}`);
    }
    expect(offenders, 'используйте TipTapField (enableImages/enableHtmlMode=false для коротких тел)').toEqual([]);
  });

  it('регулярка ловит нарушение и не ловит обычную textarea', () => {
    expect('<textarea style={x} value={form.body_md} onChange={f} />'.match(BARE_MD_TEXTAREA)).not.toBeNull();
    expect('<textarea value={annotationMd} />'.match(BARE_MD_TEXTAREA)).not.toBeNull();
    expect('<textarea value={comment} onChange={f} />'.match(BARE_MD_TEXTAREA)).toBeNull();
  });

  it('сам тест видит исходники', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });
});
