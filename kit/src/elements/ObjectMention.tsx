// Упоминание чужого объекта — один элемент на весь kit (SPRINT_UXR_S13_KIT4/K4-MENTION-LOOK).
//
// Повод — владелица 11.11.2026: «все упоминания в объектах чужих объектов имели
// иконки и расцветку соответствующего канонического объекта и ссылку на него».
// До этого каждое место рисовало ссылку на запись своей разметкой: чипы
// проектов, «Связи», Peek, ссылки [[…]] в MD — без значка и без цвета типа, и
// у каждого места была своя манера показать «записи нет».
//
// Что элемент знает: вид записи (kind) и облик вида из конфига приложения —
// значок `icon` и цвет `color` (токен темы). Чего НЕ знает: что это за виды и
// какого они цвета — это называет приложение (K-14). Вида нет или он не описан —
// упоминание нейтральное, без выдуманного значка.
//
// Нет адреса — честный текст той же формы, а не ссылка в никуда.
import type { CSSProperties, ReactNode } from 'react';
import type { KindConfig } from '../core/contract';
import { GameIcon } from './GameIcon';

/** Облик вида для упоминания: значок, цвет (токен) и подпись вида. */
export interface MentionLook { icon?: string; color?: string; title?: string }

/**
 * Цвет из конфига — в значение CSS. Токен (`var(--x)`) — как есть; имя токена
 * (`--x` или `x`) — `var(--x)`; пусто — нет цвета (нейтральный вид).
 */
export function mentionColor(c: string | undefined | null): string | undefined {
  const v = (c ?? '').trim();
  if (!v) return undefined;
  if (v.startsWith('var(')) return v;
  if (v.startsWith('--')) return `var(${v})`;
  if (/^[a-z][a-z0-9_-]*$/i.test(v)) return `var(--${v})`;
  return v;
}

/** Облик вида из конфига приложения; вида нет — null (упоминание нейтральное). */
export function mentionLook(kinds: Record<string, KindConfig> | undefined, kind: string | null | undefined): MentionLook | null {
  if (!kind) return null;
  const k = kinds?.[kind] ?? kinds?.[kind.toLowerCase()];
  if (!k) return null;
  return { icon: k.icon || undefined, color: k.color || undefined, title: k.title || undefined };
}

export interface ObjectMentionProps {
  /** Код записи — по нему ссылка и подпись, если названия нет. */
  id: string;
  /** Вид записи; неизвестен — упоминание без значка и цвета. */
  kind?: string | null;
  /** Название записи; нет или совпадает с кодом — печатается код один раз. */
  title?: string | null;
  /** Адрес записи; нет — текст без ссылки (data-nolink). */
  href?: string | null;
  /** Виды приложения (config.kinds) — откуда облик. */
  kinds?: Record<string, KindConfig>;
  /** Облик напрямую — когда вида в конфиге нет, а приложение его знает. Главнее kinds. */
  look?: MentionLook | null;
  /** Записи нет среди загруженных — серым, но ссылка остаётся. */
  missing?: boolean;
  /** Показать код пилюлей рядом с названием. */
  showId?: boolean;
  className?: string;
  nameClassName?: string;
  /** Подпись вместо названия (например, «от спринта» рядом — снаружи). */
  children?: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Подсказка; нет — «Вид: код». */
  hint?: string;
}

export function ObjectMention({ id, kind, title, href, kinds, look: given, missing, showId, className, nameClassName, children, onClick, hint }: ObjectMentionProps) {
  const look = given ?? mentionLook(kinds, kind);
  const name = title?.trim();
  const same = !!name && name.toLocaleLowerCase() === id.trim().toLocaleLowerCase();
  const head = name && !same ? name : id;
  const color = mentionColor(look?.color);
  const style = color ? ({ '--mention-c': color } as CSSProperties) : undefined;
  const cls = ['sk-mention', className].filter(Boolean).join(' ');
  const body = (
    <>
      {/* Цвет значка — инлайном через --mention-c: GameIcon ставит свой color инлайном, класс его не перебьёт. */}
      {look?.icon && <GameIcon slug={look.icon} size={12} className="sk-mention__icon" color={color ? 'var(--mention-c)' : undefined} />}
      <span className={['sk-mention__name', nameClassName].filter(Boolean).join(' ')}>{children ?? head}</span>
      {showId && name && !same && <span className="sk-pill sk-pill--id">{id}</span>}
    </>
  );
  const common = {
    className: cls,
    style,
    'data-mention': '',
    'data-kind': kind || undefined,
    'data-tinted': color ? 'true' : undefined,
    'data-missing': missing ? 'true' : undefined,
    title: hint ?? (look?.title ? `${look.title}: ${id}` : undefined),
  };
  return href
    ? <a {...common} href={href} onClick={onClick}>{body}</a>
    : <span {...common} data-nolink="">{body}</span>;
}
