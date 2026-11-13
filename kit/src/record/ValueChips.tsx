// Ряд значений-чипов: первые три и «ещё N»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Вынесен из RecordView своим файлом по той же причине, что GluedBlock: это
// элемент, а не часть паспорта. Его просят и списки, и экраны администрирования
// — а второй такой же ряд разошёлся бы с первым на первой правке (потолок,
// подпись источника, поведение «ещё»).
//
// Что он знает: значение может прийти объектом с кодом и подписью, и подпись
// бывает унаследована. Чего НЕ знает: что это за проект или компонент, от кого
// наследуется и как это назвать словами — подписи приходят от приложения
// (водораздел K-14).
import { useState } from 'react';
import { VALUE_CHIPS_INLINE, chipLabel, toChips } from '../core/chipValue';
import { kitT, useKitLang } from '../i18n';

/**
 * Ряд значений-чипов: первые три и «ещё N» (S4-29).
 *
 * Почему свёртка нужна: у задачи проектов и компонентов бывает десяток —
 * свои плюс унаследованные от спринта, — и строка «Свойств» переносится на
 * четыре строки, выдавливая остальные поля вниз.
 *
 * Почему «ещё N» несёт ЧИСЛО: без числа свёрнутое читается как мелочь, а там
 * бывает большая часть. Раскрытие — на месте: уводить в другое окно значило бы
 * потерять связь с полем, у которого эти значения.
 *
 * Свёртка у каждого поля СВОЯ: «Проекты» и «Компоненты» стоят рядом, и общее
 * состояние раскрывало бы оба сразу — то есть ровно то, от чего свёртка.
 */
export interface ValueChipsProps {
  value: unknown;
  /** Ссылка на запись по коду чипа. Адреса знает приложение, не kit. */
  href: (id: string) => string;
  /** Подпись источника наследования по его виду словом приложения («от спринта»); нет — нейтрально (K-14). */
  fromLabel?: (type: string) => string | undefined;
}

export function ValueChips({ value, href, fromLabel }: ValueChipsProps) {
  const lang = useKitLang();
  const [open, setOpen] = useState(false);
  const all = toChips(value);
  if (all.length === 0) return <span className="sk-rec-fields__none">—</span>;
  const shown = open ? all : all.slice(0, VALUE_CHIPS_INLINE);
  const rest = all.length - shown.length;
  return (
    <span className="sk-rec-chips" data-chips-row="">
      {shown.map(c => {
        const from = c.inherited_from ?? null;
        // Подпись источника — словом приложения (K-14: виды записей kit не знает);
        // рядом всегда код источника: подпись без имени бесполезна. Подписи нет —
        // говорим о виде как есть, а не молчим.
        const kindWord = from
          ? (fromLabel?.(from.type) ?? kitT(lang, 'kit.chips.fromOther', { type: from.type || '—' }))
          : null;
        const title = from ? `${kindWord} ${from.id || '—'}`.trim() : undefined;
        return (
          <span
            key={c.id}
            className="sk-rec-chips__item"
            data-chip={c.id}
            data-inherited={from ? (from.type || 'unknown') : undefined}
            title={title}
          >
            <a className="sk-rec-chips__link" href={href(c.id)}>{chipLabel(c)}</a>
            {from && <span className="sk-rec-chips__from">{kindWord}</span>}
          </span>
        );
      })}
      {(rest > 0 || open) && (
        <button
          type="button"
          className="sk-btn sk-rec-chips__more"
          data-chips-more=""
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          {open ? kitT(lang, 'kit.chips.less') : kitT(lang, 'kit.list.more', { n: rest })}
        </button>
      )}
    </span>
  );
}
