// AvatarMenu (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02): кнопка-аватар в шапке
// оболочки, открывающая лист личного — настройки, «что помнит», сессия. Как
// в прототипе v4 (#me / .ava): круглая кнопка с инициалами, по нажатию —
// панель с шапкой «кто я» и содержимым от приложения. Содержимое (какие
// настройки и где они хранятся) — забота приложения, kit даёт каркас.
//
// Панель — Sheet справа: фокус внутрь, ловушка Tab, Esc и подложка закрывают,
// фокус возвращается на аватар (S4-00c). Пользователь не опознан — честно
// подписано и нарисована иконка, а не пустой кружок или «?».
import { useState } from 'react';
import type { ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { kitT, useKitLang } from '../i18n';
import { Sheet } from './Sheet';

/** Инициалы: первые буквы двух первых слов имени, заглавные; пусто — ''. */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => Array.from(w)[0] ?? '').join('').toLocaleUpperCase();
}

export interface AvatarMenuProps {
  /** Отображаемое имя пользователя; не задано — «пользователь не опознан». */
  name?: string | null;
  /** Строка под именем в шапке листа: роль, скоуп, сессия. */
  subtitle?: ReactNode;
  /** Заголовок листа; по умолчанию «Личные настройки». */
  title?: string;
  /** Управляемое открытие (тесты, открытие из палитры команд). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function AvatarMenu({ name, subtitle, title, open: openProp, onOpenChange, children }: AvatarMenuProps) {
  const lang = useKitLang();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  };
  const who = name?.trim() || '';
  const initials = avatarInitials(who);
  const sheetTitle = title ?? kitT(lang, 'kit.avatar.title');
  const label = who
    ? kitT(lang, 'kit.avatar.open', { name: who })
    : kitT(lang, 'kit.avatar.openAnon');

  const face = (big: boolean) => (
    <span className={['sk-avatar__face', big ? 'sk-avatar__face--big' : ''].filter(Boolean).join(' ')} aria-hidden="true">
      {initials
        ? <span className="sk-avatar__initials">{initials}</span>
        : <GameIcon slug="person" size={big ? 18 : 14} />}
    </span>
  );

  return (
    <>
      <button
        type="button"
        className="sk-avatar"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {face(false)}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={sheetTitle} side="right" className="sk-avatar-sheet">
        <div className="sk-avatar__who">
          {face(true)}
          <div className="sk-avatar__who-text">
            <b className="sk-avatar__name">{who || kitT(lang, 'kit.avatar.anon')}</b>
            {subtitle && <span className="sk-avatar__sub">{subtitle}</span>}
          </div>
        </div>
        {children}
      </Sheet>
    </>
  );
}
