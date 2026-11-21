// 1.18, владелица 21.11.2026: «код, краткое название, полное название, описание» (ru/en/pl). Проект везде подписан
// кратким названием на языке интерфейса, а не кодом «владелец/репозиторий». Откат: перевод → русское краткое →
// полное → ключ (slug). Полное название — так же: перевод → русское (name) → ключ.
import type { KitLang } from '@seidr/kit';

export interface ProjectNames {
  slug?: unknown;
  name?: unknown;
  short_title?: unknown;
  short_title_en?: unknown;
  short_title_pl?: unknown;
  title_en?: unknown;
  title_pl?: unknown;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const byLang = (row: Record<string, unknown>, base: string, lang: KitLang): string =>
  lang === 'ru' ? '' : s(row[`${base}_${lang}`]);

/** Краткое название проекта на языке интерфейса (откат — русское, полное, ключ). */
export function projectShortTitle(row: ProjectNames, lang: KitLang = 'ru'): string {
  const r = row as Record<string, unknown>;
  return byLang(r, 'short_title', lang) || s(r.short_title) || s(r.name) || s(r.slug);
}

/** Полное название проекта на языке интерфейса (откат — русское полное, ключ). */
export function projectFullTitle(row: ProjectNames, lang: KitLang = 'ru'): string {
  const r = row as Record<string, unknown>;
  return byLang(r, 'title', lang) || s(r.name) || s(r.slug);
}
