// GameIcon (S4-00b): иконки game-icons через Iconify, только офлайн.
// Набор целиком регистрирует приложение (registerGameIcons) — CSP запрещает
// удалённую подгрузку, а `@iconify/react/offline` её и не пытается. kit сам
// набор не тянет: данные (~МБ JSON) — забота приложения, а не каждого импорта.
//
// Честно: неизвестный слаг (опечатка в данных, незарегистрированный набор) —
// это не «пусто», а заглушка того же размера с data-missing, видимая в DOM.
import type { CSSProperties } from 'react';
import { addCollection, Icon } from '@iconify/react/offline';
import type { IconifyJSON } from '@iconify/react/offline';
import { LUCIDE_ICONS } from './lucideIcons';
import { MATERIAL_SYMBOLS_ICONS, TABLER_ICONS } from './extraIcons';
import { ICON_CANON } from './iconCanon';

const known = new Set<string>();
/** Наборы по приставке ('' — game-icons): нужны разметке вне React (ссылки [[…]] в MD, K4-MENTION-LOOK). */
const sets = new Map<string, IconifyJSON>();

// S4-25: второй набор v1 — lucide. Вшиты только выбранные иконки (~9 КБ),
// поэтому kit регистрирует их сам; слаг — «lucide:имя».
addCollection(LUCIDE_ICONS);
sets.set('lucide:', LUCIDE_ICONS as IconifyJSON);
for (const name of [...Object.keys(LUCIDE_ICONS.icons), ...Object.keys(LUCIDE_ICONS.aliases ?? {})]) known.add(`lucide:${name}`);

// S4-32: четыре значка вне наборов v1 по выбору владелицы 14.11.2026 — тем же офлайн-способом.
for (const set of [MATERIAL_SYMBOLS_ICONS, TABLER_ICONS]) {
  addCollection(set);
  for (const name of Object.keys(set.icons)) known.add(`${set.prefix}:${name}`);
}

/**
 * Зарегистрировать набор Iconify офлайн. game-icons (`@iconify-json/game-icons/icons.json`)
 * — слаг без префикса; любой другой набор (S7B-22: официальные логотипы у
 * приложения) — слаг «префикс:имя», как вшитый lucide.
 */
export function registerGameIcons(data: unknown): void {
  const set = data as IconifyJSON;
  addCollection(set);
  const pre = set.prefix && set.prefix !== 'game-icons' ? `${set.prefix}:` : '';
  // Набор приложения ДОПОЛНЯЕТ набор kit с той же приставкой, а не вытесняет его (K4-MENTION-LOOK,
  // препрод 16.11: LORE регистрирует свой lucide, и [[task:…]] в тексте терял значок kit lucide:list-checks).
  const had = sets.get(pre);
  sets.set(pre, had ? { ...set, ...had, icons: { ...had.icons, ...set.icons }, aliases: { ...(had.aliases ?? {}), ...(set.aliases ?? {}) } } : set);
  for (const name of Object.keys(set.icons ?? {})) known.add(pre + name);
  for (const name of Object.keys(set.aliases ?? {})) known.add(pre + name);
}

/**
 * Значок строкой SVG — для разметки, которую рисует не React (ссылки [[…]] в
 * чтении MD). Только зарегистрированные наборы; слага нет — null, а не пустой
 * квадрат: вызывающий тогда оставляет ссылку без значка.
 */
export function gameIconSvg(slug: string, size = 12, className = 'sk-icon'): string | null {
  if (!known.has(slug)) return null;
  const i = slug.indexOf(':');
  const pre = i >= 0 ? slug.slice(0, i + 1) : '';
  const set = sets.get(pre);
  if (!set) return null;
  let name = i >= 0 ? slug.slice(i + 1) : slug;
  // Псевдоним — к родителю (повороты псевдонимов не применяем: в наборах слагов kit их нет).
  for (let n = 0; n < 4 && !set.icons[name] && set.aliases?.[name]; n++) name = set.aliases[name].parent;
  const icon = set.icons[name];
  if (!icon) return null;
  const w = icon.width ?? set.width ?? 16;
  const h = icon.height ?? set.height ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" aria-hidden="true" width="${size}" height="${size}" viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}" fill="currentColor">${icon.body}</svg>`;
}

/** Есть ли слаг в зарегистрированном наборе (game-icons без префикса или «lucide:имя»). */
export function hasGameIcon(slug: string): boolean {
  return known.has(slug);
}

/**
 * Канонические слаги разделов и приложений (как в v1: shellNav.ts,
 * forsetiChapters.ts) — экраны v2 берут иконку раздела отсюда, а не пишут свою.
 */
export const SECTION_ICONS = {
  projects: 'compass',
  research: 'raven',
  tyr: 'scales',
  bragi: 'harp',
  // v1 берёт 'town-crier', но в наборе game-icons такого слага нет — иконка
  // раздела «Новости» в v1 молча пустая. Выбор владелицы (S4-25) — из словаря.
  news: ICON_CANON.sectionNews,
  value: 'bullseye',
  tech: 'gears',
  control: 'checkered-flag',
  filter: ICON_CANON.segFilter,
  search: 'magnifying-glass',
  commands: ICON_CANON.commands,
  views: ICON_CANON.views,
  // «Командные» — без иконки (S4-25); подбор вне наборов — S4-32.
} as const satisfies Record<string, string>;

export interface GameIconProps {
  slug: string | null | undefined;
  /** Размер в px (ширина и высота иконки, не шрифт). */
  size?: number;
  /** Подпись: есть — role=img с именем; нет — иконка декоративная. */
  label?: string;
  /** Цвет — токеном, по умолчанию currentColor. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function GameIcon({ slug, size = 15, label, color, className, style }: GameIconProps) {
  const box: CSSProperties = { width: size, height: size, ...style };
  const cls = ['sk-icon', className].filter(Boolean).join(' ');
  if (!slug || !known.has(slug)) {
    return (
      <span
        className={`${cls} sk-icon--missing`}
        data-missing={slug ?? ''}
        style={box}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      />
    );
  }
  return (
    <Icon
      icon={slug.includes(':') ? slug : `game-icons:${slug}`}
      width={size}
      height={size}
      className={cls}
      style={{ color: color ?? 'currentColor', flexShrink: 0, ...style }}
      {...(label ? { role: 'img', 'aria-label': label, 'aria-hidden': false } : { 'aria-hidden': true })}
    />
  );
}
