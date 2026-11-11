// Шапка карточки записи — ОДНА на ленту и на Peek (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10,
// D-2026-LORE-PEEK-ONE-CARD). Вид, ID-пилюля, название и — если вызывающий его дал — статус.
//
// Классы — те же, что были у строки ленты (sk-feed__*): карточка Peek и строка ленты
// выглядят одинаково по построению, а не потому, что кто-то повторил вёрстку.
// Лента статус в шапку не кладёт (он у неё в строке метаданных), Peek кладёт.
// Нет статуса у записи или у типа — нет и пустого места (K-14: kit не знает, у кого он есть).
import type { ReactNode } from 'react';
import { Pill } from '../elements/Pill';

export interface RecordCardHeadProps {
  /** Подпись вида записи — от приложения. */
  kind: string;
  id: string;
  /** Название: текстом или ссылкой — решает вызывающий. */
  title: ReactNode;
  /** Статус в строке шапки (Peek); нет — нет. */
  status?: ReactNode;
}

export function RecordCardHead({ kind, id, title, status }: RecordCardHeadProps) {
  return (
    <>
      <span className="sk-feed__head">
        <span className="sk-feed__kind">{kind}</span>
        <Pill variant="id">{id}</Pill>
        {status != null && <span className="sk-card__status">{status}</span>}
      </span>
      <span className="sk-feed__title">{title}</span>
    </>
  );
}
