// Раздел тела записи — ОДИН блок на паспорт и на ленту.
//
// Владелица 11.11.2026: «лента — это лента паспортов», «принудительно с показом
// раздела „Контекст“». Тело записи в ленте — тот же раздел, что в паспорте:
// та же подпись и та же рамка. Второй похожий блок разъехался бы с первым
// первой же правкой, поэтому и паспорт (Overview), и лента (ListView) рисуют
// раздел этим компонентом.
import type { ReactNode } from 'react';

export interface RecordSectionProps {
  /** Подпись раздела — от приложения (K-14): kit не знает, какие разделы бывают. */
  title: string;
  children: ReactNode;
}

export function RecordSection({ title, children }: RecordSectionProps) {
  return (
    <section className="sk-rec-fields__sec" aria-label={title}>
      <h2 className="sk-rec-fields__sechead">{title}</h2>
      {children}
    </section>
  );
}
