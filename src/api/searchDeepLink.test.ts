import { describe, expect, it } from 'vitest';
import { TYPE_SECTION, searchHitHref, readDeepLink } from './searchRoutes';

// Находка CICDGitHub по просьбе Völva (06.11.2026, переадресована 75be95c7):
// поиск открывал РАЗДЕЛ, но не ЗАПИСЬ у 4 типов из 15. searchHitHref отдавал
// passport=<id> всем, а читали его не все: решения — ?dec=, спеки — ?spec=,
// док и ранбук — passport вида «doc:<id>» (T19). searchRoutes.test проверял
// только форму ссылки и пропускал это.
//
// Правило: ссылка из поиска проходит туда-обратно — то, что строит
// searchHitHref, разбирает readDeepLink (его же читает страница), и получается
// id записи. Для КАЖДОГО типа каталога, а не для выборки.

const parse = (href: string) => new URL(href, 'http://x').searchParams;

describe('ссылка из поиска открывает запись, а не раздел — все типы', () => {
  for (const type of Object.keys(TYPE_SECTION)) {
    it(type, () => {
      const id = type === 'task' ? 'SPRINT_X/T-1' : `ID-${type.toUpperCase()}-1`;
      const link = readDeepLink(parse(searchHitHref(type, id)));
      expect(link, `${type}: ссылка не разбирается`).not.toBeNull();
      expect(link!.section).toBe(TYPE_SECTION[type]);
      // У задачи паспорта нет — она открывается в паспорте своего спринта.
      expect(link!.id).toBe(type === 'task' ? 'SPRINT_X' : id);
    });
  }

  it('знания несут вид записи — спека, док и ранбук различимы', () => {
    expect(readDeepLink(parse(searchHitHref('spec', 'SPEC-A')))!.kind).toBe('spec');
    expect(readDeepLink(parse(searchHitHref('doc', 'doc_a')))!.kind).toBe('doc');
    expect(readDeepLink(parse(searchHitHref('runbook', 'rb_a')))!.kind).toBe('runbook');
  });

  it('старые закладки читаются: ?spec=, ?kind=&art=, ?dec=', () => {
    expect(readDeepLink(parse('/lore?section=knowledge&spec=SPEC-A'))).toEqual({ section: 'knowledge', kind: 'spec', id: 'SPEC-A' });
    expect(readDeepLink(parse('/lore?section=knowledge&kind=doc&art=doc_a'))).toEqual({ section: 'knowledge', kind: 'doc', id: 'doc_a' });
    expect(readDeepLink(parse('/lore?section=decisions&dec=D-1'))).toEqual({ section: 'decisions', id: 'D-1' });
    expect(readDeepLink(parse('/lore?section=decisions&passport=D-2'))).toEqual({ section: 'decisions', id: 'D-2' });
  });

  it('раздел без выбора — null, а не выдуманный id', () => {
    expect(readDeepLink(parse('/lore?section=adrs'))).toBeNull();
    expect(readDeepLink(parse('/lore?section=knowledge'))).toBeNull();
  });
});
