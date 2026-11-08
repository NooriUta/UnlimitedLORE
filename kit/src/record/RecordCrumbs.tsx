// Крошки записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28): «← Раздел · контекст фильтра / ID».
// Прототип v4: паспорт — продолжение списка, а не отдельное приложение.
// Крошка ведёт обратно в список с тем же фильтром: адрес возврата и текст
// контекста задаёт приложение (оно знает, откуда пришли). Текущая запись —
// aria-current="page". На телефоне контекст фильтра скрывается (CSS),
// остаётся «← ID».
import type { ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';

export interface RecordCrumbsBack {
  /** Подпись раздела: «Спринты», «Спеки». */
  label: ReactNode;
  /** Адрес списка с фильтром; есть — крошка ссылка (открывается и в новой вкладке). */
  href?: string;
  /** Возврат обработчиком приложения (без href — кнопка). */
  onClick?: () => void;
}

export interface RecordCrumbsProps {
  back: RecordCrumbsBack;
  /** Описание фильтра списка, из которого пришли: «Категория: wip». */
  context?: ReactNode;
  /** ID текущей записи. */
  current: ReactNode;
  className?: string;
}

export function RecordCrumbs({ back, context, current, className }: RecordCrumbsProps) {
  const lang = useKitLang();
  const inner = (
    <>
      <span aria-hidden="true">← </span>
      <span>{back.label}</span>
      {context && <span className="sk-crumbs__ctx"> · {context}</span>}
    </>
  );
  return (
    <nav className={['sk-crumbs', className].filter(Boolean).join(' ')} aria-label={kitT(lang, 'kit.record.crumbs.label')}>
      {back.href
        ? <a className="sk-crumbs__back" href={back.href} onClick={back.onClick}>{inner}</a>
        : <button type="button" className="sk-crumbs__back" onClick={back.onClick}>{inner}</button>}
      <span className="sk-crumbs__sep" aria-hidden="true">/</span>
      <span className="sk-crumbs__cur" aria-current="page">{current}</span>
    </nav>
  );
}
