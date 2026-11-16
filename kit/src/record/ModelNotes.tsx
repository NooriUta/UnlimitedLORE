// Оговорки разбора модели в паспорте — шевроном «⚠ N» (B14 ревью владелицы
// 10.11.2026: «Панель предупреждений перекрывает шапку паспорта… перенести в
// поток или в шеврон „⚠ N“ с выпадением; показывать владельцам модели»).
//
// Что перекрывало. Полоса оговорок (`<ul className="sk-model-note">`) —
// ПЕРВЫЙ блок внутри `.sk-dock__panel`, и сама она в потоке: ни position, ни
// z-index у неё нет. Поверх её правого верхнего угла ложится кнопка закрытия
// дока `.sk-dock__close` — `position: sticky; float: right; z-index: 1`
// (kit/src/styles/seidr.css:5340, рисует RecordDock.tsx:116). Флоат вынут из
// потока, поэтому следующие БЛОЧНЫЕ боксы — сначала полоса оговорок, за ней
// шапка записи — верстаются как будто его нет, и он закрывает им угол.
// Отсюда две части лечения: шеврон (одна строка вместо полосы на всю ширину)
// и явно отданный кнопке угол (margin-right в ListPassport.css).
//
// Почему шеврон, а не «просто в поток». В потоке панель и так была, и это не
// помогло: мешала не позиция, а то, что развёрнутый список оговорок занимал
// верх паспорта целиком — ровно там, где человек ищет шапку записи. Шеврон
// оставляет на этом месте одну строку и ничего не прячет: содержимое
// раскрывается щелчком, а не уезжает из разметки.
//
// «Показывать владельцам модели» — НЕ СДЕЛАНО, и не выдумано: надёжного
// признака роли у клиента нет. Вход выключен — все запросы уходят с
// `X-Seer-Role: admin` (web-next/src/auth/session.ts, devHeaders), вход включён — профиль
// сессии отдаёт только name/sub/expiresAt (kit/src/auth/session.ts:141-148),
// роли остаются в токене и наверх не поднимаются; `perms.can_edit` фасада —
// право на ЗАПИСЬ, а не на модель. Поэтому панель остаётся видна всем, но в
// свёрнутом виде. Свёрнутая она НЕ МОЛЧИТ: число оговорок и слово о том, что
// это оговорки модели, стоят в самом шевроне — «свёрнуто» не должно читаться
// как «предупреждений нет».
//
// Перенесено из web-next в kit (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 4): экран
// «список + паспорт» переезжает в kit по частям; классы — sk-model-note*, строки — kit.record.modelNotes.*.
import { useMemo } from 'react';
import { TechGate } from '../resilience/techGate';
import { kitT, useKitLang } from '../i18n';
import { useWarningsSource, type WarningItem } from './warnings';

export interface RecordModelNotesProps {
  /** Оговорки разбора модели: порядок разделов, словарь статусов, причины отката. */
  notes: string[];
}

export function RecordModelNotes({ notes }: RecordModelNotesProps) {
  const lang = useKitLang();
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  // MP2-08 (владелица 13.11.2026): оговорки модели — технические сообщения,
  // их место под общим значком warnings, а не полосой/чипом в компоновке.
  // Сборщик экрана собирает их вместе с состоянием данных и замечаниями
  // графа в один список; без сборщика (витрина, тесты) — прежний шеврон.
  const items = useMemo<WarningItem[]>(
    () => notes.map(n => ({ source: t('kit.record.modelNotes.kind'), label: t('kit.record.modelNotes.kind'), text: n, tone: 'wrn' })),
    [notes, lang],
  );
  const collected = useWarningsSource('model', items);
  if (collected) return null;
  // Оговорок нет — и панели нет. «Не проверяли» и «модель не прочиталась» сюда
  // приходят СТРОКАМИ (passportOrder.ts, passportStatuses.ts), то есть тоже
  // оговорками: пустой список значит именно «модель ответила, спорить не о чем».
  if (notes.length === 0) return null;
  // S4-TECH-NOTES (владелица 11.11.2026): оговорки разбора модели — сведения
  // для разработчика, человек с ними ничего сделать не может. Скрыты, пока не
  // включена личная настройка или кнопка «тех.» на месте. Неполноты данных они
  // не означают (паспорт показан целиком, меняется только порядок/словарь
  // умолчания), поэтому про неполноту заменяющей строки нет: у кнопки —
  // только сводка «⚠ N», само число оговорок.
  return (
    // TechGate скрывает содержимое целиком: пока оговорки не раскрыты, число
    // «⚠ N» остаётся у кнопки (hiddenNote) — свёрнутое не читается как «всё
    // чисто». Подпись «тех. модели» отличает кнопку от одноимённой у блока
    // «Состояние данных» (kit), иначе два чипа «тех.» неотличимы.
    <TechGate
      className="sk-model-note__tech"
      label={t('kit.record.modelNotes.tech')}
      hiddenNote={t('kit.record.modelNotes.badge', { n: notes.length })}
    >
      <div className="sk-model-note" role="status">
        <details className="sk-model-note__box">
          <summary className="sk-model-note__sum">
            <span aria-hidden="true">⚠</span>{' '}
            {t('kit.record.modelNotes.count', { n: notes.length })}
          </summary>
          <ul className="sk-model-note__list">
            {notes.map(n => <li key={n}>{n}</li>)}
          </ul>
        </details>
      </div>
    </TechGate>
  );
}

