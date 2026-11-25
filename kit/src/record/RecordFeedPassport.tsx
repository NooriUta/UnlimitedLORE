// Паспорт записи в ленте (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Замечание владелицы 14.11.2026: «Лента содержит только контекст (облегченные
// лента паспартов а я думала полноценную ленту паспортов сделаешь)». Прототип
// docs/prototypes/bp-01-passport-feed.html принят 25.11.2026 как есть: зоны
// паспорта подряд — свойства → тело целиком → связи → история свёрткой.
//
// Зоны — ТЕ ЖЕ компоненты, что у паспорта (Fields, Overview, RecordLinks,
// RecordHistory): своя вёрстка «паспорта для ленты» разошлась бы с паспортом
// первой же правкой. Вкладок здесь нет: лента читается подряд, как серия
// записей, и вкладки в каждой записи превратили бы её в двенадцать экранов.
//
// Только чтение: правка — в паспорте записи (по названию в шапке строки).
//
// История — свёрткой и грузится ТОЛЬКО при раскрытии: в ленте до двенадцати
// паспортов, и двенадцать запросов истории на экран, который их не просил, —
// цена без пользы. Что грузить, решает приложение (`history.onOpen`): kit не
// знает, откуда у записи история (K-14).
import { useState } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { kitT, useKitLang } from '../i18n';
import { Skeleton } from '../states/StateViews';
import { RecordBodyFields, RecordBodyOverview } from './RecordView';
import { RecordLinks } from './RecordLinks';
import { RecordHistory, type RecordHistorySource } from './RecordHistory';

export interface RecordFeedPassportProps {
  record: KitRecord;
  /** Тот же контекст, что у паспорта записи: конфиг вида, данные (рёбра), md-рендер. */
  ctx: KitCtx;
  /**
   * История записи. Нет — у типа истории нет, и зоны нет. `onOpen` зовётся
   * при ПЕРВОМ раскрытии — тогда приложение и грузит; `source` — что пришло.
   */
  history?: { onOpen: () => void; source?: RecordHistorySource };
  className?: string;
}

export function RecordFeedPassport({ record, ctx, history, className }: RecordFeedPassportProps) {
  const lang = useKitLang();
  const kind = ctx.config.kinds[record.kind];
  const [histOpen, setHistOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const hasFields = (kind?.fields?.length ?? 0) > 0;
  return (
    <div className={`sk-feedpp${className ? ` ${className}` : ''}`} data-feed-passport={record.id}>
      {hasFields && kind && (
        <section className="sk-feedpp__zone" data-zone="props" aria-label={kitT(lang, 'kit.record.tab.props')}>
          <h3 className="sk-feedpp__head">{kitT(lang, 'kit.record.tab.props')}</h3>
          <RecordBodyFields record={record} kind={kind} ctx={ctx} lang={lang} />
        </section>
      )}
      <section className="sk-feedpp__zone" data-zone="body" aria-label={kitT(lang, 'kit.record.body')}>
        <RecordBodyOverview record={record} kind={kind} ctx={ctx} lang={lang} />
      </section>
      <section className="sk-feedpp__zone" data-zone="links" aria-label={kitT(lang, 'kit.record.tab.links')}>
        <h3 className="sk-feedpp__head">{kitT(lang, 'kit.record.tab.links')}</h3>
        <RecordLinks record={record} ctx={ctx} lang={lang} />
      </section>
      {history && (
        <section className="sk-feedpp__zone" data-zone="history" aria-label={kitT(lang, 'kit.record.tab.history')}>
          <details
            className="sk-feedpp__hist"
            onToggle={e => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setHistOpen(open);
              if (open && !asked) { setAsked(true); history.onOpen(); }
            }}
          >
            <summary className="sk-feedpp__head">
              {kitT(lang, 'kit.record.tab.history')}
              {!asked && <span className="sk-feedpp__hint">{kitT(lang, 'kit.record.feedpp.historyLazy')}</span>}
            </summary>
            {histOpen && (history.source
              ? <RecordHistory record={record} source={history.source} lang={lang} />
              : <Skeleton lines={3} label={kitT(lang, 'kit.state.loading')} />)}
          </details>
        </section>
      )}
    </div>
  );
}
