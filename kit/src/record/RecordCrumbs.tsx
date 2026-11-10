// Крошки записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28): «← Раздел · контекст фильтра / ID».
// Прототип v4: паспорт — продолжение списка, а не отдельное приложение.
// Крошка ведёт обратно в список с тем же фильтром: адрес возврата и текст
// контекста задаёт приложение (оно знает, откуда пришли). Текущая запись —
// aria-current="page". На телефоне контекст фильтра скрывается (CSS),
// остаётся «← ID».
import type { ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { navClick } from '../core/navClick';

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
  // Подпись — один инлайновый узел внутри flex-бокса ссылки: подчёркивание
  // рисует он (на самом flex-контейнере линия ложится по базовой линии бокса
  // и проходит по глифам — крошка выглядела зачёркнутой, B7 ревью 10.11.2026),
  // и пробелы между «←», разделом и контекстом остаются на месте — у flex-
  // элементов они схлопывались («←Задачи· Категория»).
  const inner = (
    <span className="sk-crumbs__label">
      <span aria-hidden="true">← </span>
      <span>{back.label}</span>
      {context && <span className="sk-crumbs__ctx"> · {context}</span>}
    </span>
  );
  return (
    <nav className={['sk-crumbs', className].filter(Boolean).join(' ')} aria-label={kitT(lang, 'kit.record.crumbs.label')}>
      {back.href
        // Ссылка ведёт на список и щелчок обрабатывает приложение — но только
        // обычный: Ctrl/⌘/Shift/Alt и средняя кнопка уходят браузеру, иначе
        // «открыть в новой вкладке» снова не работает (находка P1 аудита 08.11).
        ? (
          <a className="sk-crumbs__back" href={back.href}
            onClick={back.onClick ? navClick(back.onClick) : undefined}>{inner}</a>
        )
        : <button type="button" className="sk-crumbs__back" onClick={back.onClick}>{inner}</button>}
      <span className="sk-crumbs__sep" aria-hidden="true">/</span>
      <span className="sk-crumbs__cur" aria-current="page">{current}</span>
    </nav>
  );
}
