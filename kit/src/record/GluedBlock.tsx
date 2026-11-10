// Вклеенный блок: заголовок со СЧЁТЧИКОМ и содержимое под ним
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29 — хвост тела паспорта;
// SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-BODY-MORE — запись с телом в ленте).
//
// Вынесено ОДНИМ кодом, а не повторено похожей вёрсткой, намеренно. Паспорт и
// лента показывают одно и то же утверждение — «к этой записи относится столько
// вот этого», — и у него три тонких правила, которые при копировании
// разъезжаются первой же правкой:
//   • счётчик обязателен: вкладки у вклеенного раздела нет, и без числа оно
//     исчезает с экрана совсем;
//   • «не проверено» — это НЕ ноль: `count: null` рисуется тем же «?», что у
//     вкладок (TabCount), одним «неизвестно» на весь kit;
//   • пустой блок не рисует ВЫЗЫВАЮЩИЙ: решение «показывать или нет» зависит
//     от того, чем блок наполнен, и принимается там, где это известно.
//
// Уровень заголовка здесь третий по делу: блок стоит в хвосте тела, где над ним
// уже есть заголовки разделов второго уровня. В панели вкладки группы заголовок
// первый после заголовка записи, поэтому там свой блок с h2
// (.sk-rec-group__head) — axe ловит пропуск уровня правилом heading-order.
import type { ReactNode } from 'react';
import { TabCount } from '../shell/Tabs';
import type { KitLang } from '../i18n';

export interface GluedBlockProps {
  /** Ключ раздела — в разметку, чтобы блок можно было найти по имени. */
  id: string;
  label: ReactNode;
  /** Число элементов: `null` — «не смогли посчитать», `undefined` — считать нечего. */
  count?: number | null;
  lang: KitLang;
  children: ReactNode;
}

export function GluedBlock({ id, label, count, lang, children }: GluedBlockProps) {
  return (
    <section className="sk-rec-glue" data-glued={id}>
      <h3 className="sk-rec-glue__head">
        <span>{label}</span>
        <TabCount count={count} lang={lang} />
      </h3>
      {children}
    </section>
  );
}
