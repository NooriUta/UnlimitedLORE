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

const known = new Set<string>();

/** Зарегистрировать набор game-icons (`@iconify-json/game-icons/icons.json`). */
export function registerGameIcons(data: unknown): void {
  const set = data as IconifyJSON;
  addCollection(set);
  for (const name of Object.keys(set.icons ?? {})) known.add(name);
  for (const name of Object.keys(set.aliases ?? {})) known.add(name);
}

/** Есть ли слаг в зарегистрированном наборе. */
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
  // раздела «Новости» в v1 молча пустая. Здесь — newspaper (как в прототипе v4).
  news: 'newspaper',
  value: 'bullseye',
  plan: 'sprint',
  knowledge: 'scroll-quill',
  tech: 'gears',
  control: 'checkered-flag',
  filter: 'funnel',
  search: 'magnifying-glass',
  commands: 'lightning-trio',
  views: 'round-star',
  team: 'three-friends',
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
      icon={`game-icons:${slug}`}
      width={size}
      height={size}
      className={cls}
      style={{ color: color ?? 'currentColor', flexShrink: 0, ...style }}
      {...(label ? { role: 'img', 'aria-label': label, 'aria-hidden': false } : { 'aria-hidden': true })}
    />
  );
}
