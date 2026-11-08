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
import { Segmented } from '../elements/Segmented';
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
import { OWN_TAB, RELATION_MARK, RecordRelations, RelationLines, SHARED_TAB, relationTargets } from './RecordRelations';
import type { KitRelationDef } from '../core/contract';

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
  /**
   * Куда идёт вычисляемое (связи, граф, журнал, история). 'tabs' (по умолчанию,
   * владелица 08.11: «пока как в MVP») — вкладками основного блока в любом месте;
   * 'column' — колонкой слева при bottom/full (раскладка S4-33, отложена, не удалена).
   */
  aroundAs?: 'tabs' | 'column';
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
  const row = (f: (typeof fields)[number]) => (
    <div key={f.key} className="sk-rec-fields__row" data-type={f.type}>
      <dt>{f.title}</dt>
      <dd><FieldValue type={f.type} value={record.fields[f.key]} ctx={ctx} edit={edit} fieldKey={f.key} title={f.title} /></dd>
    </div>
  );
  // Поля без раздела — первыми; разделы (section) — подзаголовками в порядке появления (S4-36).
  const plain = fields.filter(f => !f.section);
  const sections = [...new Set(fields.map(f => f.section).filter((s): s is string => !!s))];
  return (
    <section className="sk-rec-fields" aria-label={kitT(lang, 'kit.record.fields')}>
      <dl data-testid="kit-fields">{plain.map(row)}</dl>
      {sections.map(s => (
        <div key={s} role="group" aria-label={s} className="sk-rec-fields__sec">
          <h3 className="sk-rec-fields__sechead">{s}</h3>
          <dl>{fields.filter(f => f.section === s).map(row)}</dl>
        </div>
      ))}
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

/** Свёртка «Свойства · …» (v4): непустые значения полей одной строкой. */
function propsSummary(record: KitRecord, kind: KindConfig): string {
  return (kind.fields ?? [])
    .map(f => record.fields[f.key])
    .filter(x => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && x.length === 0))
    .map(x => (Array.isArray(x) ? x.map(valueText).join(', ') : valueText(x)))
    .join(' · ');
}

export function RecordView({ record, ctx, tab, onTab, className, facts, mdEditor, history, loadedAt, onReload, now: nowProp, placement, aroundAs = 'tabs' }: RecordViewProps) {
  const lang = useKitLang();
  const clock = useMinuteClock(loadedAt !== undefined && nowProp === undefined);
  const loaded = loadedAt ? <RecordLoaded loadedAt={loadedAt} now={nowProp ?? clock} onReload={onReload} lang={lang} /> : null;
  const saver = mdEditor ? fieldSaver(record, ctx) : undefined;
  const edit: EditSlot | undefined = mdEditor && saver ? { Editor: mdEditor, save: saver } : undefined;
  const titleId = useId();
  const kind = ctx.config.kinds[record.kind];
  const kindTabs = kind?.tabs ?? [];
  // Связи по видам UML: композиция и агрегация — своя вкладка; зависимости (и ассоциация) —
  // одна вкладка; реализация — одна; обобщение — строкой в шапке.
  const rels: KitRelationDef[] = kind?.relations ?? [];
  const relTabs: { id: string; label: string; relation: string; defs: KitRelationDef[] }[] = [];
  for (const d of rels) {
    if (OWN_TAB.includes(d.relation)) { relTabs.push({ id: d.key, label: d.label, relation: d.relation, defs: [d] }); continue; }
    const sh = SHARED_TAB[d.relation];
    if (!sh) continue;
    const ex = relTabs.find(x => x.id === sh.id);
    if (ex) ex.defs.push(d); else relTabs.push({ id: sh.id, label: kitT(lang, sh.label), relation: d.relation, defs: [d] });
  }
  const relCount = (defs: KitRelationDef[]) => defs.reduce((n, d) => n + relationTargets(record, ctx, d).length, 0);
  const zoned = placement !== undefined;
  const hasProps = zoned && (kind?.fields?.length ?? 0) > 0;
  // Снизу и на весь экран свойства — колонкой справа рядом с контентом (владелица 08.11):
  // читать и заполнять текст и свойства сразу, без переключений. Панелью справа (узко) — вкладкой.
  // Снизу — свойства колонкой справа; во весь экран — свёрткой под шапкой и рейкой у края, как v4 (S4-CONTENT-V4).
  const propsSide = hasProps && placement === 'bottom';
  const propsRow = hasProps && placement === 'full';
  const [propsOpen, setPropsOpen] = useState(false);
  const recordItems: TabItem[] = [
    { id: RECORD_TABS.overview, label: kitT(lang, zoned ? 'kit.record.tab.text' : 'kit.record.tab.overview'), zone: zoned ? 'record' : undefined },
    ...(hasProps && !propsSide && !propsRow ? [{ id: RECORD_TABS.props, label: kitT(lang, 'kit.record.tab.props'), zone: 'record' as const }] : []),
    ...kindTabs.map(t => ({ id: t.key, label: t.title, zone: zoned ? 'record' as const : undefined })),
    ...relTabs.map(rt => ({ id: rt.id, label: rt.label, count: relCount(rt.defs), relation: rt.relation, mark: RELATION_MARK[rt.relation as keyof typeof RELATION_MARK], zone: zoned ? 'record' as const : undefined })),
  ];
  const aroundItems: TabItem[] = [
    { id: RECORD_TABS.links, label: kitT(lang, 'kit.record.tab.links'), count: recordLinks(record.id, ctx.data.edges).length },
    { id: RECORD_TABS.graph, label: kitT(lang, 'kit.record.tab.graph') },
    { id: RECORD_TABS.journal, label: kitT(lang, 'kit.record.tab.journal'), count: recordJournal(record.id, ctx.data.journal).length },
    ...(history ? [{ id: RECORD_TABS.history, label: kitT(lang, 'kit.record.tab.history'), count: historyCount(history) }] : []),
  ].map(i => (zoned ? { ...i, zone: 'around' as const } : i));
  // По умолчанию всё вкладками; колонка слева — только aroundAs='column' при bottom/full.
  const aside = aroundAs === 'column' && (placement === 'bottom' || placement === 'full');
  const items: TabItem[] = aside ? recordItems : [...recordItems, ...aroundItems];
  const current = items.some(i => i.id === tab) ? tab : RECORD_TABS.overview;
  // Панелью справа (узко) — переключатель видов над шапкой, как «таблица / доска» (владелица 08.11):
  // Контент (текст и вкладки типа) · Свойства · Аналитика (связи, граф, журнал, история).
  const modes = placement === 'right';
  type Mode = 'content' | 'props' | 'analytics';
  const mode: Mode = current === RECORD_TABS.props ? 'props' : aroundItems.some(i => i.id === current) ? 'analytics' : 'content';
  const contentItems = recordItems.filter(i => i.id !== RECORD_TABS.props);
  const shown: TabItem[] = !modes ? items : mode === 'analytics' ? aroundItems : mode === 'content' ? contentItems : [];
  const firstOf: Record<Mode, string> = { content: RECORD_TABS.overview, props: RECORD_TABS.props, analytics: aroundItems[0].id };
  const switcher = modes ? (
    <div className="sk-rec__modes">
      <Segmented<Mode> label={kitT(lang, 'kit.record.view')} value={mode} onChange={m => onTab(firstOf[m])}
        options={[
          { value: 'content', label: kitT(lang, 'kit.record.view.content') },
          ...(hasProps ? [{ value: 'props' as const, label: kitT(lang, 'kit.record.view.props') }] : []),
          { value: 'analytics', label: kitT(lang, 'kit.record.view.analytics') },
        ]} />
    </div>
  ) : null;
  const reset = `${record.id}:${current}`;
  const custom = kindTabs.find(t => t.key === current);
  const relTab = relTabs.find(rt => rt.id === current);

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
  } else if (current === RECORD_TABS.props && kind && !propsSide) {
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
  } else if (relTab) {
    panel = (
      <BlockBoundary block={`rel:${relTab.id}`} label={relTab.label} lang={lang} resetKey={reset}>
        <RecordRelations record={record} ctx={ctx} defs={relTab.defs} lang={lang} />
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

  const tabsBlock = shown.length > 1 ? (
    <Tabs className="sk-rec__tabs" variant="underline" items={shown} value={current} onChange={onTab} label={kitT(lang, 'kit.record.tabs')}>
      {panel}
    </Tabs>
  ) : <div className="sk-rec__panel">{panel}</div>;
  // Снизу / на весь экран: шапка на всю ширину, под ней в одном ряду вкладки и «Свойства» —
  // свойства начинаются вровень с контентом, а не с заголовком (владелица 08.11).
  const propsAside = propsSide && kind ? (
    <aside className="sk-rec__props" data-zone="props" aria-label={kitT(lang, 'kit.record.tab.props')}>
      <p className="sk-rec__zone">{kitT(lang, 'kit.record.tab.props')}</p>
      <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={record.id}>
        <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} />
      </BlockBoundary>
    </aside>
  ) : null;
  const mainBlock = (
    <>
        {switcher}
        <RecordHead record={record} ctx={ctx} lang={lang} titleId={titleId} withStatus={!facts} tail={facts ? undefined : loaded} />
        <RelationLines record={record} ctx={ctx} defs={rels} />
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
        {propsRow && kind && (
          <details className="sk-rec-propsrow" open={propsOpen} onToggle={e => setPropsOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary className="sk-rec-propsrow__sum">
              <span className="sk-rec-propsrow__label">{kitT(lang, 'kit.record.tab.props')}</span>
              {propsSummary(record, kind) && <span className="sk-rec-propsrow__vals"> · {propsSummary(record, kind)}</span>}
            </summary>
            <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={record.id}>
              <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} />
            </BlockBoundary>
          </details>
        )}
        {propsAside ? <div className="sk-rec__body"><div className="sk-rec__content">{tabsBlock}</div>{propsAside}</div> : tabsBlock}
        {placement === 'full' && (
          <nav className="sk-rec-rail" aria-label={kitT(lang, 'kit.record.rail')}>
            {hasProps && <button type="button" className="sk-rec-rail__btn" onClick={() => setPropsOpen(true)}>{kitT(lang, 'kit.record.tab.props')}</button>}
            <button type="button" className="sk-rec-rail__btn" onClick={() => onTab(RECORD_TABS.graph)}>{kitT(lang, 'kit.record.tab.graph')}</button>
            <button type="button" className="sk-rec-rail__btn" onClick={() => onTab(RECORD_TABS.links)}>{kitT(lang, 'kit.record.rail.analytics')}</button>
          </nav>
        )}
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

  const cols = aside;
  const cls = ['sk-rec', aside ? 'sk-rec--zones' : '', className].filter(Boolean).join(' ');
  return (
    <article className={cls} aria-labelledby={titleId} data-kind={record.kind} data-placement={placement}>
      {cols ? (<>{around}<div className="sk-rec__main">{mainBlock}</div></>) : mainBlock}
    </article>
  );
}
