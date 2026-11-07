// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04): шапка, строка
// вердикта, вкладки (Обзор · вкладки вида из config.kinds · Связи · Граф ·
// Журнал). Пишется против контракта ядра (core/contract.ts): запись, данные
// (X_DATA) и конфиг приходят через KitCtx, тело — Markdown через ctx.md
// (рендер чтения kit: MartProse + KaTeX + mermaid).
//
// Вкладка — управляемая (tab/onTab): состояние живёт в URL у экрана
// (useRecordTab), а не внутри компонента. Исключение в overview/render
// вкладки/вердикте конфига ломает только свой блок (BlockBoundary).
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { KindConfig, KitCtx, KitRecord } from '../core/contract';
import { Tabs, type TabItem } from '../shell/Tabs';
import { EmptyState } from '../states/StateViews';
import { useKitLang, kitT, type KitLang } from '../i18n';
import { BlockBoundary } from './BlockBoundary';
import { RecordHead, RecordVerdict } from './RecordHead';
import { RecordLinks, recordLinks } from './RecordLinks';
import { RecordGraph } from './RecordGraph';
import { RecordJournal, recordJournal } from './RecordJournal';
import { RecordRef, renderOut, valueText } from './fmt';

export const RECORD_TABS = { overview: 'overview', links: 'links', graph: 'graph', journal: 'journal' } as const;

export interface RecordViewProps {
  record: KitRecord;
  ctx: KitCtx;
  /** Выбранная вкладка (из URL); неизвестная — обзор. */
  tab: string;
  onTab: (tab: string) => void;
  className?: string;
}

function FieldValue({ type, value, ctx }: { type: string; value: unknown; ctx: KitCtx }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="sk-rec-fields__none">—</span>;
  if (type === 'md') return ctx.md(valueText(value));
  if (type === 'ref') {
    const ids = (Array.isArray(value) ? value : [value]).map(v => valueText(v));
    return <span className="sk-rec-fields__refs">{ids.map(id => <RecordRef key={id} id={id} ctx={ctx} />)}</span>;
  }
  if (type === 'enum') return <span className="sk-pill sk-pill--value">{valueText(value)}</span>;
  if (type === 'number' || type === 'date') return <span className="sk-rec-fields__mono">{valueText(value)}</span>;
  return <span>{valueText(value)}</span>;
}

function Fields({ record, kind, ctx, lang }: { record: KitRecord; kind: KindConfig; ctx: KitCtx; lang: KitLang }) {
  const fields = kind.fields ?? [];
  if (fields.length === 0) return null;
  return (
    <section className="sk-rec-fields" aria-label={kitT(lang, 'kit.record.fields')}>
      <dl data-testid="kit-fields">
        {fields.map(f => (
          <div key={f.key} className="sk-rec-fields__row" data-type={f.type}>
            <dt>{f.title}</dt>
            <dd><FieldValue type={f.type} value={record.fields[f.key]} ctx={ctx} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Overview({ record, kind, ctx, lang }: { record: KitRecord; kind: KindConfig | undefined; ctx: KitCtx; lang: KitLang }) {
  if (kind?.overview) return <>{renderOut(kind.overview(record, ctx), ctx)}</>;
  if (record.body_md?.trim()) return <>{ctx.md(record.body_md)}</>;
  return <EmptyState compact title={kitT(lang, 'kit.record.body.empty')} hint={kitT(lang, 'kit.record.body.emptyHint')} />;
}

/** Рендер вкладки вида — отдельным компонентом, чтобы исключение поймал BlockBoundary. */
function KindTab({ render, record, ctx }: { render: NonNullable<KindConfig['tabs']>[number]['render']; record: KitRecord; ctx: KitCtx }) {
  return <>{renderOut(render(record, ctx), ctx)}</>;
}

export function RecordView({ record, ctx, tab, onTab, className }: RecordViewProps) {
  const lang = useKitLang();
  const titleId = useId();
  const kind = ctx.config.kinds[record.kind];
  const kindTabs = kind?.tabs ?? [];
  const items: TabItem[] = [
    { id: RECORD_TABS.overview, label: kitT(lang, 'kit.record.tab.overview') },
    ...kindTabs.map(t => ({ id: t.key, label: t.title })),
    { id: RECORD_TABS.links, label: kitT(lang, 'kit.record.tab.links'), count: recordLinks(record.id, ctx.data.edges).length },
    { id: RECORD_TABS.graph, label: kitT(lang, 'kit.record.tab.graph') },
    { id: RECORD_TABS.journal, label: kitT(lang, 'kit.record.tab.journal'), count: recordJournal(record.id, ctx.data.journal).length },
  ];
  const current = items.some(i => i.id === tab) ? tab : RECORD_TABS.overview;
  const reset = `${record.id}:${current}`;
  const custom = kindTabs.find(t => t.key === current);

  let panel: ReactNode;
  if (current === RECORD_TABS.overview) {
    panel = (
      <div className="sk-rec-overview">
        <BlockBoundary block="overview" label={kitT(lang, 'kit.record.tab.overview')} lang={lang} resetKey={reset}>
          <Overview record={record} kind={kind} ctx={ctx} lang={lang} />
        </BlockBoundary>
        {kind && (
          <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={reset}>
            <Fields record={record} kind={kind} ctx={ctx} lang={lang} />
          </BlockBoundary>
        )}
      </div>
    );
  } else if (custom) {
    panel = (
      <BlockBoundary block={`tab:${custom.key}`} label={custom.title} lang={lang} resetKey={reset}>
        <KindTab render={custom.render} record={record} ctx={ctx} />
      </BlockBoundary>
    );
  } else {
    const Body = current === RECORD_TABS.links ? RecordLinks : current === RECORD_TABS.graph ? RecordGraph : RecordJournal;
    panel = (
      <BlockBoundary block={current} label={items.find(i => i.id === current)?.label} lang={lang} resetKey={reset}>
        <Body record={record} ctx={ctx} lang={lang} />
      </BlockBoundary>
    );
  }

  return (
    <article className={['sk-rec', className].filter(Boolean).join(' ')} aria-labelledby={titleId} data-kind={record.kind}>
      <RecordHead record={record} ctx={ctx} lang={lang} titleId={titleId} />
      <BlockBoundary block="verdict" label={kitT(lang, 'kit.record.verdict')} lang={lang} resetKey={record.id}>
        <RecordVerdict record={record} ctx={ctx} lang={lang} />
      </BlockBoundary>
      <Tabs items={items} value={current} onChange={onTab} label={kitT(lang, 'kit.record.tabs')}>
        {panel}
      </Tabs>
    </article>
  );
}
