// Лицо человека (AP-07 «аватары доделать», владелица 15.11.2026, SPRINT_LORE_ADMIN_POLISH/AP-07):
// одно на весь kit — меню аватара, автор в лентах, карточки людей. Есть картинка — картинка;
// нет или не загрузилась — инициалы; нет и имени — значок «человек». Откуда картинка (с токеном,
// из кэша) — забота приложения: kit получает готовый src.
import { useEffect, useState } from 'react';
import { GameIcon } from '../elements/GameIcon';

/** Инициалы: первые буквы двух первых слов имени, заглавные; пусто — ''. */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => Array.from(w)[0] ?? '').join('').toLocaleUpperCase();
}

export interface PersonFaceProps {
  /** Имя — подпись картинки и источник инициалов. */
  name?: string | null;
  /** Готовый адрес картинки (blob:, data:, относительный); нет — инициалы. */
  src?: string | null;
  /** Размер: 'sm' — строка ленты, 'md' — кнопка шапки, 'lg' — шапка листа. */
  size?: 'sm' | 'md' | 'lg';
  /** Картинка только украшает (имя рядом уже написано) — без подписи для чтения. */
  decorative?: boolean;
  className?: string;
}

const ICON_PX = { sm: 10, md: 14, lg: 18 } as const;

export function PersonFace({ name, src, size = 'md', decorative, className }: PersonFaceProps) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const who = name?.trim() || '';
  const initials = avatarInitials(who);
  const cls = ['sk-face', `sk-face--${size}`, className].filter(Boolean).join(' ');
  if (src && !broken) {
    return (
      <span className={cls}>
        <img className="sk-face__img" src={src} alt={decorative ? '' : who} onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={cls} {...(decorative || !who ? { 'aria-hidden': true } : { role: 'img', 'aria-label': who })}>
      {initials ? <span className="sk-avatar__initials">{initials}</span> : <GameIcon slug="person" size={ICON_PX[size]} />}
    </span>
  );
}
