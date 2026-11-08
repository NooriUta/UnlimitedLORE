// Шапка экрана (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-22, S4-23): заголовок · виды · действие — одной строкой.
// В прототипе v4 виды стоят в строке заголовка справа: «что за экран» и «как
// смотреть» читаются вместе, а таблица начинается на полосу выше. Первичное
// действие («+ Создать», S4-24) — слот: экран сам решает, есть ли оно.
// Иконку заголовка и иконки видов передаёт приложение: по правилу S4-25 иконки
// берутся из канона LORE v1, kit своих не выдумывает.
import type { ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';

export interface ScreenHeadProps {
  title: ReactNode;
  /** id заголовка — для aria-labelledby раздела оболочки. */
  titleId?: string;
  /** Слаг game-icons рядом с заголовком; нет — заголовок без иконки. */
  icon?: string;
  /** Переключатель видов (radiogroup) — справа от заголовка. */
  views?: ReactNode;
  /** Первичное действие экрана — справа в конце строки. */
  actions?: ReactNode;
  className?: string;
}

export function ScreenHead({ title, titleId, icon, views, actions, className }: ScreenHeadProps) {
  return (
    <header className={['sk-shead', className].filter(Boolean).join(' ')} data-testid="kit-screenhead">
      <h1 id={titleId} className="sk-shead__title">
        {icon && <GameIcon slug={icon} size={18} />}
        <span>{title}</span>
      </h1>
      {views && <div className="sk-shead__views">{views}</div>}
      {actions && <div className="sk-shead__actions">{actions}</div>}
    </header>
  );
}
