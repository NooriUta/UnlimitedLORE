// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04): шапка, строка
// вердикта, вкладки (Обзор · вкладки вида из config.kinds · Связи · Граф ·
// Журнал). Пишется против контракта ядра (core/contract.ts): запись, данные
// (X_DATA) и конфиг приходят через KitCtx, тело — Markdown через ctx.md
// (рендер чтения kit: MartProse + KaTeX + mermaid).
//
// Вкладка — управляемая (tab/onTab): состояние живёт в URL у экрана
// (useRecordTab), а не внутри компонента. Исключение в overview/render
// вкладки/вердикте конфига ломает только свой блок (BlockBoundary).
import { useEffect, useId, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { rolePerms } from '../approval/approval';
import type { KindConfig, KitCtx, KitRecord } from '../core/contract';
import { Tabs, type TabItem } from '../shell/Tabs';
import { EmptyState } from '../states/StateViews';
import { useKitLang, kitT, type KitLang } from '../i18n';
import { BlockBoundary } from './BlockBoundary';
import { RecordHead, RecordLoaded, RecordVerdict } from './RecordHead';
import { RecordLinks, recordLinks } from './RecordLinks';
import { RecordGraph } from './RecordGraph';
import { RecordJournal, recordJournal } from './RecordJournal';
import { RecordRef, renderOut, valueText } from './fmt';
import { RecordFacts } from './RecordFacts';
import type { RecordFactsSpec } from './facts';
import { RecordHistory, historyCount, type RecordHistorySource } from './RecordHistory';

export const RECORD_TABS = { overview: 'overview', props: 'props', links: 'links', graph: 'graph', journal: 'journal', history: 'history' } as const;

/**
 * Слот правки markdown на месте (S5-06): MdInlineEdit из `@seidr/kit/content`
 * или совместимый. Пропом, а не импортом: главная точка входа kit не тянет
 * TipTap экранам, где правки нет.
 */
export interface MdEditorSlotProps {
  value: string;
  label: string;
  onSave?: (markdown: string) => Promise<void> | void;
}

export interface RecordViewProps {
  record: KitRecord;
  ctx: KitCtx;
  /** Выбранная вкладка (из URL); неизвестная — обзор. */
  tab: string;
  onTab: (tab: string) => void;
  className?: string;
  /**
   * S5-01: строка-вердикт под заголовком — статус · задачи x/y · просрочено ·
   * свежесть. Не передан — строки нет (как в K-04).
   */
  facts?: RecordFactsSpec;
  /**
   * Правка MD на месте (S5-06). Кнопка ✎ появляется у тела и md-полей, только
   * если есть куда сохранять (config.hooks.onSave) и роль может править
   * (roles[role].canEdit; без roles — может). Иначе — чтение как прежде.
   */
  mdEditor?: ComponentType<MdEditorSlotProps>;
  /** Источник вкладки «История» (S5-11); нет — вкладки нет (истории у вида может не быть). */
  history?: RecordHistorySource;
  /** Когда экран получил данные (S4-29): «получено N мин» в строке статуса. */
  loadedAt?: string;
  /** Перезапросить данные — кнопка ↻ рядом с «получено». */
  onReload?: () => void;
  /** «Сейчас» для «получено N мин» (тесты); по умолчанию — часы с шагом в минуту. */
  now?: number;
  /**
   * Где открыт паспорт (S4-33, решение владелицы 08.11). Задан — раскладка по зонам:
   * «Текст» и «Свойства» — вкладки записи (без них изменения не сохранить);
   * связи, граф, журнал, история — вычисляемое: при bottom/full — колонкой
   * слева, при right (узко) — вкладками после вкладок записи. Не задан — прежний вид.
   */
  placement?: 'right' | 'bottom' | 'full';
}

/** Часы с шагом в минуту — для «получено N мин»; выключены — не тикают. */
function useMinuteClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/** Сохранение поля записи через hooks.onSave; undefined — правки нет. */
type FieldSaver = ((field: string, from: unknown) => (to: string) => Promise<void>) | undefined;

function fieldSaver(record: KitRecord, ctx: KitCtx): FieldSaver {
  const onSave = ctx.config.hooks?.onSave;
  if (!onSave || !rolePerms(ctx.config, ctx.role).canEdit) return undefined;
  return (field, from) => to => onSave({ type: record.kind, id: record.id, field, from, to });
}

interface EditSlot { Editor: ComponentType<MdEditorSlotProps>; save: NonNullable<FieldSaver> }

function FieldValue({ type, value, ctx, edit, fieldKey, title }: { type: string; value: unknown; ctx: KitCtx; edit?: EditSlot; fieldKey?: string; title?: string }): ReactNode {
  if (type === 'md' && edit && fieldKey) {
    const text = value === null || value === undefined ? '' : valueText(value);
    return <edit.Editor value={text} label={title ?? fieldKey} onSave={edit.save(fieldKey, value ?? null)} />;
  }
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

function Fields({ record, kind, ctx, lang, edit }: { record: KitRecord; kind: KindConfig; ctx: KitCtx; lang: KitLang; edit?: EditSlot }) {
  const fields = kind.fields ?? [];
  if (fields.length === 0) return null;
  return (
    <section className="sk-rec-fields" aria-label={kitT(lang, 'kit.record.fields')}>
      <dl data-testid="kit-fields">
        {fields.map(f => (
          <div key={f.key} className="sk-rec-fields__row" data-type={f.type}>
            <dt>{f.title}</dt>
            <dd><FieldValue type={f.type} value={record.fields[f.key]} ctx={ctx} edit={edit} fieldKey={f.key} title={f.title} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Overview({ record, kind, ctx, lang, edit }: { record: KitRecord; kind: KindConfig | undefined; ctx: KitCtx; lang: KitLang; edit?: EditSlot }) {
  if (kind?.overview) return <>{renderOut(kind.overview(record, ctx), ctx)}</>;
  // Тело с правом на правку: тот же рендер чтения + ✎; пустое — «Текста нет»
  // и ✎, а не тупик без способа написать.
  if (edit) {
    return <edit.Editor value={record.body_md ?? ''} label={kitT(lang, 'kit.record.body')} onSave={edit.save('body_md', record.body_md ?? null)} />;
  }
  if (record.body_md?.trim()) return <>{ctx.md(record.body_md)}</>;
  return <EmptyState compact title={kitT(lang, 'kit.record.body.empty')} hint={kitT(lang, 'kit.record.body.emptyHint')} />;
}

/** Рендер вкладки вида — отдельным компонентом, чтобы исключение поймал BlockBoundary. */
function KindTab({ render, record, ctx }: { render: NonNullable<KindConfig['tabs']>[number]['render']; record: KitRecord; ctx: KitCtx }) {
  return <>{renderOut(render(record, ctx), ctx)}</>;
}

export function RecordView({ record, ctx, tab, onTab, className, facts, mdEditor, history, loadedAt, onReload, now: nowProp, placement }: RecordViewProps) {
  const lang = useKitLang();
  const clock = useMinuteClock(loadedAt !== undefined && nowProp === undefined);
  const loaded = loadedAt ? <RecordLoaded loadedAt={loadedAt} now={nowProp ?? clock} onReload={onReload} lang={lang} /> : null;
  const saver = mdEditor ? fieldSaver(record, ctx) : undefined;
  const edit: EditSlot | undefined = mdEditor && saver ? { Editor: mdEditor, save: saver } : undefined;
  const titleId = useId();
  const kind = ctx.config.kinds[record.kind];
  const kindTabs = kind?.tabs ?? [];
  const zoned = placement !== undefined;
  const hasProps = zoned && (kind?.fields?.length ?? 0) > 0;
  const recordItems: TabItem[] = [
    { id: RECORD_TABS.overview, label: kitT(lang, zoned ? 'kit.record.tab.text' : 'kit.record.tab.overview'), zone: zoned ? 'record' : undefined },
    ...(hasProps ? [{ id: RECORD_TABS.props, label: kitT(lang, 'kit.record.tab.props'), zone: 'record' as const }] : []),
    ...kindTabs.map(t => ({ id: t.key, label: t.title, zone: zoned ? 'record' as const : undefined })),
  ];
  const aroundItems: TabItem[] = [
    { id: RECORD_TABS.links, label: kitT(lang, 'kit.record.tab.links'), count: recordLinks(record.id, ctx.data.edges).length },
    { id: RECORD_TABS.graph, label: kitT(lang, 'kit.record.tab.graph') },
    { id: RECORD_TABS.journal, label: kitT(lang, 'kit.record.tab.journal'), count: recordJournal(record.id, ctx.data.journal).length },
    ...(history ? [{ id: RECORD_TABS.history, label: kitT(lang, 'kit.record.tab.history'), count: historyCount(history) }] : []),
  ].map(i => (zoned ? { ...i, zone: 'around' as const } : i));
  // bottom/full — вычисляемое уходит в колонку слева; right и без placement — вкладками.
  const aside = placement === 'bottom' || placement === 'full';
  const items: TabItem[] = aside ? recordItems : [...recordItems, ...aroundItems];
  const current = items.some(i => i.id === tab) ? tab : RECORD_TABS.overview;
  const reset = `${record.id}:${current}`;
  const custom = kindTabs.find(t => t.key === current);

  let panel: ReactNode;
  if (current === RECORD_TABS.overview) {
    panel = (
      <div className="sk-rec-overview">
        <BlockBoundary block="overview" label={kitT(lang, 'kit.record.tab.overview')} lang={lang} resetKey={reset}>
          <Overview record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} />
        </BlockBoundary>
        {kind && !zoned && (
          <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={reset}>
            <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} />
          </BlockBoundary>
        )}
      </div>
    );
  } else if (current === RECORD_TABS.props && kind) {
    panel = (
      <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={reset}>
        <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} />
      </BlockBoundary>
    );
  } else if (current === RECORD_TABS.history && history) {
    panel = (
      <BlockBoundary block="history" label={kitT(lang, 'kit.record.tab.history')} lang={lang} resetKey={reset}>
        <RecordHistory record={record} source={history} lang={lang} />
      </BlockBoundary>
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

  const mainBlock = (
    <>
        <RecordHead record={record} ctx={ctx} lang={lang} titleId={titleId} withStatus={!facts} tail={facts ? undefined : loaded} />
        {facts && (
          <BlockBoundary block="facts" label={kitT(lang, 'kit.record.facts')} lang={lang} resetKey={record.id}>
            <RecordFacts record={record} ctx={ctx} spec={facts} lang={lang}
              onTasks={facts.tasksTab && kindTabs.some(t => t.key === facts.tasksTab) ? () => onTab(facts.tasksTab!) : undefined}
              tail={loaded} />
          </BlockBoundary>
        )}
        <BlockBoundary block="verdict" label={kitT(lang, 'kit.record.verdict')} lang={lang} resetKey={record.id}>
          <RecordVerdict record={record} ctx={ctx} lang={lang} />
        </BlockBoundary>
        <Tabs className="sk-rec__tabs" variant="underline" items={items} value={current} onChange={onTab} label={kitT(lang, 'kit.record.tabs')}>
          {panel}
        </Tabs>
    </>
  );
  const around = aside ? (
    <aside className="sk-rec__around" data-zone="around" aria-label={kitT(lang, 'kit.record.around')}>
      <p className="sk-rec__zone">{kitT(lang, 'kit.record.around')}</p>
      {aroundItems.map(i => {
        const Body = i.id === RECORD_TABS.links ? RecordLinks : i.id === RECORD_TABS.graph ? RecordGraph : i.id === RECORD_TABS.journal ? RecordJournal : null;
        return (
          <section key={i.id} className="sk-rec__around-block" data-block={i.id}>
            <h2 className="sk-rec__around-head">{i.label}{i.count !== undefined && <span className="sk-tab__count">{i.count}</span>}</h2>
            <BlockBoundary block={i.id} label={i.label} lang={lang} resetKey={record.id}>
              {Body ? <Body record={record} ctx={ctx} lang={lang} /> : history ? <RecordHistory record={record} source={history} lang={lang} /> : null}
            </BlockBoundary>
          </section>
        );
      })}
    </aside>
  ) : null;

  return (
    <article className={['sk-rec', aside ? 'sk-rec--zones' : '', className].filter(Boolean).join(' ')} aria-labelledby={titleId} data-kind={record.kind} data-placement={placement}>
      {aside ? (<>{around}<div className="sk-rec__main">{mainBlock}</div></>) : mainBlock}
    </article>
  );
}
