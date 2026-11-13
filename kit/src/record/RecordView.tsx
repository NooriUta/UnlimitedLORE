// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04): шапка, строка
// вердикта, вкладки (Обзор · вкладки вида из config.kinds · Связи · Граф ·
// Журнал). Пишется против контракта ядра (core/contract.ts): запись, данные
// (X_DATA) и конфиг приходят через KitCtx, тело — Markdown через ctx.md
// (рендер чтения kit: MartProse + KaTeX + mermaid).
//
// Вкладка — управляемая (tab/onTab): состояние живёт в URL у экрана
// (useRecordTab), а не внутри компонента. Исключение в overview/render
// вкладки/вердикте конфига ломает только свой блок (BlockBoundary).
import { RecordSection } from './RecordSection';
import { EditableField } from './EditableField';
import { SumCell } from '../list/sum';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { rolePerms } from '../approval/approval';
import type { KindConfig, KitCtx, KitRecord } from '../core/contract';
import { Tabs, TabCount, type TabItem } from '../shell/Tabs';
import { mergeTabs } from '../shell/tabRow';
import { ResizeBorder, zoneSize } from '../shell/ResizeBorder';
import { createSafeStorage } from '../resilience/safeStorage';
import type { WidthStore } from '../list/columnWidths';
import { applySections, gluedSections, sectionGroups, type PassportOrder } from '../model/surfaces';
import { isChipList } from '../core/chipValue';
import { ValueChips } from './ValueChips';
import { GluedBlock } from './GluedBlock';
import { Segmented } from '../elements/Segmented';
import { IconButton } from '../elements/IconButton';
import { ICON_CANON } from '../elements/iconCanon';
import { EmptyState } from '../states/StateViews';
import { useKitLang, kitT, type KitLang } from '../i18n';
import { useNarrow } from '../core/narrow';
import { BlockBoundary } from './BlockBoundary';
import { DataStateWarnings } from './DataStateWarnings';
import { RecordHead, RecordLoaded, RecordVerdict } from './RecordHead';
import { KIT_NEW_ID, RecordCreate, type RecordCreateSpec } from './RecordCreate';
import { RelationField } from './RelationField';
export { KIT_NEW_ID, type RecordCreateSpec };
import { RecordLinks, recordLinks } from './RecordLinks';
import { dataStateOf } from './dataState';
import { RecordGraph } from './RecordGraph';
import { RecordJournal, recordJournal } from './RecordJournal';
import { RecordRef, renderOut, valueText } from './fmt';
import { RecordFacts } from './RecordFacts';
import type { RecordFactsSpec } from './facts';
import { RecordHistory, historyCount, type RecordHistorySource } from './RecordHistory';
import { OWN_TAB, RELATION_MARK, RecordRelations, RelationLines, SHARED_TAB, relationName, relationTargets } from './RecordRelations';
import type { MdDraftSlot } from '../content/MdInlineEdit';
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
  /**
   * Черновик ЭТОГО поля на сервере (S5-09). Слот даёт приложение: адрес и
   * версия записи — его забота, kit про API не знает.
   */
  drafts?: MdDraftSlot;
  /**
   * Показывать подсказку «как править». Подсказка — свойство ЗАПИСИ, а не
   * каждого поля: когда разделы тела стали править по отдельности, она
   * размножилась по числу разделов, и запись стала похожа на форму (слова
   * владелицы 09.11.2026: «верни типтап редактирование, вы ухудшили user
   * experience»). Поэтому её показывает только ПЕРВЫЙ редактор записи.
   */
  hint?: boolean;
}

export interface RecordViewProps {
  record: KitRecord;
  ctx: KitCtx;
  /**
   * Выбранная вкладка (из URL); неизвестная (или пустая — «не выбрана») — обзор,
   * а на узком экране — ПЕРВАЯ вкладка ряда в порядке модели (S4-MOBILE-COMPARE,
   * D-2026-UXR-MOBILE-FOLLOWS-V1: у спринта на телефоне первыми — задачи, как в v1).
   */
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
  /**
   * Черновик по ключу поля (S5-09): вернул слот — у поля появится
   * «Восстановить черновик от ЧЧ:ММ» и автосохранение. Не передан — поля
   * работают как раньше, без единого вызова.
   */
  mdDrafts?: (field: string) => MdDraftSlot | undefined;
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
   * S4-30: «Свойства» в режиме «на весь экран» — открыты или свёрнуты.
   *
   * `defaultPropsOpen` — умолчание для неуправляемого режима (настройка
   * приложения). `propsOpen` + `onPropsOpenChange` — управляемый режим, когда
   * выбор хранит приложение: kit сам ничего не хранит.
   */
  propsOpen?: boolean;
  defaultPropsOpen?: boolean;
  onPropsOpenChange?: (open: boolean) => void;
  /**
   * Куда идёт вычисляемое (связи, граф, журнал, история). 'tabs' (по умолчанию,
   * владелица 08.11: «пока как в MVP») — вкладками основного блока в любом месте;
   * 'column' — колонкой слева при bottom/full (раскладка S4-33, отложена, не удалена).
   */
  aroundAs?: 'tabs' | 'column';
  /**
   * Порядок и места разделов паспорта — ДАННЫМИ приложения (S4-29).
   *
   * Просьба владелицы 09.11: «ты должен определять порядок например Спринт
   * первое как ни странно задачи потом уже контент… а зависимости и прочее
   * можно скрыть под море». У LORE это умолчание модели
   * (`surfaces.passport.<type>.sections`), разобранное `passportSections`.
   *
   * Нет или `decided: false` — kit держит свой порядок, группирует связи как
   * прежде и НИЧЕГО не прячет. «Сервер не решал» не превращается в «решил».
   */
  sections?: PassportOrder | null;
  /**
   * Хранилище личных размеров зон (S4-30). Не передано — своё, с откатом в
   * память.
   *
   * Да, рядом сказано «kit сам ничего не хранит» — про то, РАСКРЫТЫ ли
   * свойства: это состояние приложения. Размер зоны — другое: он личный, как
   * ширина колонки списка («ширина личная, набор командный», решение
   * владелицы 08.11), в адрес не идёт и приложению про него знать нечего.
   */
  widthStore?: WidthStore;
  /**
   * Узкий экран (S4-MOBILE-COMPARE). Не задан — по общему порогу kit
   * (`useNarrow`, NARROW_QUERY); задан — без matchMedia (тесты, встройка).
   * На узком: один ряд вкладок без сегмента видов, вкладка по умолчанию — первая
   * по модели. Десктоп от этого не меняется.
   */
  narrow?: boolean;
  /** S4-24: режим «создание» для записи `_new` — поля, «создано», «отмена». */
  create?: RecordCreateSpec;
}

/**
 * Колонка свойств: умолчание, пределы и порог рейки (S4-30).
 *
 * 280 — середина прежнего `minmax(240, 320)` из seidr.css: пока границу не
 * тянули, вид не меняется. 240 — оттуда же: уже этого пара «поле — значение»
 * ломается в две строки, поэтому ниже порога подписи не сжимаются, а честно
 * исчезают — остаются иконки. 56 — ширина рейки, как у левого меню.
 */
const PROPS_W = { def: 280, min: 240, max: 520, rail: 200, railW: 56, hide: 96 };

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
type FieldSaver = ((field: string, from: unknown) => (to: unknown) => Promise<void>) | undefined;

function fieldSaver(record: KitRecord, ctx: KitCtx): FieldSaver {
  const onSave = ctx.config.hooks?.onSave;
  if (!onSave || !rolePerms(ctx.config, ctx.role).canEdit) return undefined;
  return (field, from) => to => onSave({ type: record.kind, id: record.id, field, from, to });
}

interface EditSlot { Editor: ComponentType<MdEditorSlotProps>; save: NonNullable<FieldSaver>; drafts?: (field: string) => MdDraftSlot | undefined }


function FieldValue({ type, value, ctx, edit, fieldKey, title }: { type: string; value: unknown; ctx: KitCtx; edit?: EditSlot; fieldKey?: string; title?: string }): ReactNode {
  if (type === 'md' && edit && fieldKey) {
    const text = value === null || value === undefined ? '' : valueText(value);
    return <edit.Editor value={text} label={title ?? fieldKey} onSave={edit.save(fieldKey, value ?? null)} drafts={edit.drafts?.(fieldKey)} />;
  }
  // Сумма с охватом (S4-09): та же ячейка, что `sum:` в списке — число,
  // «у 9 из 14», «не заполнено» вместо нуля, «?» с причиной. Одно число — один вид.
  if (type === 'sum') return <SumCell value={value} />;
  if (value === null || value === undefined || value === '') return <span className="sk-rec-fields__none">—</span>;
  if (type === 'md') return ctx.md(valueText(value));
  if (type === 'ref') {
    // Значения пришли чипами (S4-29) — ряд чипов со свёрткой; строки — прежний
    // путь. Проверяем форму ДАННЫХ, а не тип поля: сервер сменил форму у
    // существующих полей, и тип поля об этом не знает.
    if (isChipList(value)) return <ValueChips value={value} href={ctx.href} />;
    const ids = (Array.isArray(value) ? value : [value]).map(v => valueText(v));
    return <span className="sk-rec-fields__refs">{ids.map(id => <RecordRef key={id} id={id} ctx={ctx} />)}</span>;
  }
  if (type === 'enum') return <span className="sk-pill sk-pill--value">{valueText(value)}</span>;
  if (type === 'number' || type === 'date') return <span className="sk-rec-fields__mono">{valueText(value)}</span>;
  return <span>{valueText(value)}</span>;
}

/** Виды, которые правятся на месте FieldEditor'ом. ref и md идут своими путями (связи, MD-редактор). */
const INLINE_KINDS = new Set(['text', 'number', 'date', 'enum']);

function Fields({ record, kind, ctx, lang, edit, fieldSave }: { record: KitRecord; kind: KindConfig; ctx: KitCtx; lang: KitLang; edit?: EditSlot; fieldSave?: FieldSaver }) {
  const fields = kind.fields ?? [];
  if (fields.length === 0) return null;
  const row = (f: (typeof fields)[number]) => (
    <div key={f.key} className="sk-rec-fields__row" data-type={f.type}>
      <dt>{f.title}</dt>
      <dd>{(() => {
        const view = <FieldValue type={f.type} value={record.fields[f.key]} ctx={ctx} edit={edit} fieldKey={f.key} title={f.title} />;
        // S4-24: поле-связь (компоненты, проекты) — чипы с «Отвязать» и выбор с поиском.
        if (f.type === 'ref' && f.relation) return <RelationField record={record} ctx={ctx} lang={lang} label={f.title} value={record.fields[f.key]} rel={f.relation.rel} dir={f.relation.dir} view={view} />;
        // S4-24: ✎ — только у поля, которое приложение назвало правимым, при праве и пути записи;
        // enum без вариантов не правится — выбирать не из чего.
        // S4-24: варианты не загрузились — причина словами и «Повторить», а не свободный ввод.
        if (f.type === 'enum' && f.editable && !(f.options?.length) && f.optionsError) {
          return (
            <>
              {view}
              <span className="sk-rec-fields__opterr" role="status">{kitT(lang, 'kit.field.optionsFailed', { reason: f.optionsError })}</span>
              {f.onOptionsRetry && <button type="button" className="sk-btn sk-rec-fields__retry" onClick={f.onOptionsRetry}>{kitT(lang, 'kit.state.error.retry')}</button>}
            </>
          );
        }
        const can = fieldSave && f.editable && INLINE_KINDS.has(f.type) && (f.type !== 'enum' || (f.options?.length ?? 0) > 0);
        if (!can) return view;
        const from = record.fields[f.key];
        return <EditableField def={{ key: f.key, label: f.title, kind: f.type, options: f.options, required: f.required }} value={from ?? null} view={view} onSave={to => fieldSave(f.key, from ?? null)(to)} />;
      })()}</dd>
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
  // Разделы тела ДАННЫМИ (S5-06): рисует kit, поэтому у каждого есть ✎ и
  // черновик. Проверяется ПЕРВЫМ — данные главнее своей функции рисования:
  // именно `overview` тихо отнял правку заметки задачи на проде v1.17.7
  // (приложение задавало его всегда, когда у типа есть поля группы «тело»).
  const sections = kind?.bodySections ?? [];
  if (sections.length) {
    // Подсказка «как править» — ОДНА на запись (слова владелицы 09.11.2026:
    // «верни типтап редактирование, вы ухудшили user experience»): когда она
    // шла у каждого раздела, у ADR их становилось три, и документ выглядел
    // формой. Её показывает первый раздел, которому редактор действительно
    // достался (раздел «только чтение» его не получает).
    const hintAt = edit ? sections.findIndex(s => s.editable !== false) : -1;
    return (
      <div className="sk-rec-sections">
        {/* ТЕЛО ОТДЕЛЬНЫМ БЛОКОМ ЗДЕСЬ НЕ РИСУЕТСЯ — и это правило, а не
            упущение.
            Находка прода v1.17.8 (серверная сессия): у задачи заметка
            показывалась ДВАЖДЫ — разделом «Текст» и разделом «Заметка», оба с
            ✎. Корень на стыке: сервер отдаёт `body_md` КОПИЕЙ одного из
            разделов для старых клиентов (у задачи это `note_md`, у спринта
            `context_md`, у спеки `content_md`), а kit рисовал непустое
            `body_md` ещё и своим блоком.
            Поэтому: есть разделы тела — `body_md` это копия, и показывать её
            второй раз нельзя. Типы, у которых тело и ЕСТЬ `body_md`, разделов
            не присылают (приложение их отфильтровывает) и идут прежним путём
            ниже. */}
        {sections.map((s, si) => {
          const raw = record.fields[s.key];
          const text = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : valueText(raw);
          // Раздел может быть только для чтения САМ ПО СЕБЕ: сервер не даёт
          // пути записи именно для него (`schema.fields[].editable: false`).
          // Право правки записи этого не отменяет: ✎ у такого раздела обещал
          // бы сохранение, которого некуда отправить.
          const may = edit && s.editable !== false ? edit : undefined;
          // Без права правки пустой раздел не рисуем: подпись без содержимого
          // ничего не сообщает. С правом — рисуем, иначе в пустой раздел
          // нечем написать, и это тупик без способа начать.
          if (!text.trim() && !may) return null;
          return (
            <RecordSection key={s.key} title={s.title}>
              {may
                ? <may.Editor value={text} label={s.title} onSave={may.save(s.key, raw ?? null)} drafts={may.drafts?.(s.key)} hint={si === hintAt} />
                : <>{ctx.md(text)}</>}
            </RecordSection>
          );
        })}
      </div>
    );
  }
  if (kind?.overview) return <>{renderOut(kind.overview(record, ctx), ctx)}</>;
  // Тело с правом на правку: тот же рендер чтения + ✎; пустое — «Текста нет»
  // и ✎, а не тупик без способа написать.
  if (edit) {
    return <edit.Editor value={record.body_md ?? ''} label={kitT(lang, 'kit.record.body')} onSave={edit.save('body_md', record.body_md ?? null)} drafts={edit.drafts?.('body_md')} />;
  }
  if (record.body_md?.trim()) return <>{ctx.md(record.body_md)}</>;
  return <EmptyState compact title={kitT(lang, 'kit.record.body.empty')} hint={kitT(lang, 'kit.record.body.emptyHint')} />;
}

/** Рендер вкладки вида — отдельным компонентом, чтобы исключение поймал BlockBoundary. */
function KindTab({ render, record, ctx }: { render: NonNullable<KindConfig['tabs']>[number]['render']; record: KitRecord; ctx: KitCtx }) {
  return <>{renderOut(render(record, ctx), ctx)}</>;
}

type RecWidth = 's' | 'm' | 'l' | 'f';
const WIDTHS: readonly RecWidth[] = ['s', 'm', 'l', 'f'];
const WIDTH_KEY = 'seidr-kit:rec-width';
function readWidth(): RecWidth {
  try { const v = localStorage.getItem(WIDTH_KEY); return v === 's' || v === 'l' || v === 'f' ? v : 'm'; } catch { return 'm'; }
}

/** Свёртка «Свойства · …» (v4): непустые значения полей одной строкой. */
function propsSummary(record: KitRecord, kind: KindConfig): string {
  return (kind.fields ?? [])
    .map(f => record.fields[f.key])
    .filter(x => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && x.length === 0))
    .map(x => (Array.isArray(x) ? x.map(valueText).join(', ') : valueText(x)))
    .join(' · ');
}

/**
 * Паспорт записи. Запись `_new` при заданном `create` — режим «создание» (S4-24):
 * та же точка входа и то же место, что у «Читать целиком», пустая и в правке.
 */
export function RecordView(props: RecordViewProps) {
  return props.create && props.record.id === KIT_NEW_ID
    ? <RecordCreate record={props.record} ctx={props.ctx} spec={props.create} className={props.className} />
    : <RecordViewBody {...props} />;
}

function RecordViewBody({ record, ctx, tab, onTab, className, facts, mdEditor, mdDrafts, history, loadedAt, onReload, now: nowProp, placement, aroundAs = 'tabs', propsOpen: propsOpenControlled, defaultPropsOpen, onPropsOpenChange, sections, widthStore, narrow: narrowProp }: RecordViewProps) {
  const lang = useKitLang();
  const narrow = useNarrow(narrowProp);
  const clock = useMinuteClock(loadedAt !== undefined && nowProp === undefined);
  const loaded = loadedAt ? <RecordLoaded loadedAt={loadedAt} now={nowProp ?? clock} onReload={onReload} lang={lang} /> : null;
  const saver = mdEditor ? fieldSaver(record, ctx) : undefined;
  // Правка характеристик (S4-24) не зависит от MD-редактора: право и путь записи — те же.
  const fieldSave = fieldSaver(record, ctx);
  const edit: EditSlot | undefined = mdEditor && saver ? { Editor: mdEditor, save: saver, drafts: mdDrafts } : undefined;
  const titleId = useId();
  const kind = ctx.config.kinds[record.kind];
  const kindTabs = kind?.tabs ?? [];
  // Связи по видам UML: композиция и агрегация — своя вкладка; зависимости (и ассоциация) —
  // одна вкладка; реализация — одна; обобщение — строкой в шапке.
  const rels: KitRelationDef[] = kind?.relations ?? [];
  // Решил ли порядок разделов сервер. `false` — всё как прежде: группировка
  // связей, порядок по данным, и это ПОМЕЧЕНО как умолчание, а не выдано за
  // решение модели (D-2026-LORE-MODEL-COLUMN-LAYERS, честные состояния).
  const named = sections?.decided === true;
  const relTabs: { id: string; label: string; relation: string; defs: KitRelationDef[] }[] = [];
  for (const d of rels) {
    // Модель назвала разделы по отдельности — НЕ группируем (S4-29).
    //
    // kit сводит связи-ассоциации в одну вкладку «Зависимости» (`SHARED_TAB`),
    // и это было разумным умолчанием, пока порядок разделов решал конструктор.
    // Но модель называет их поимённо (`dependsOn`, `blocks`), и при группировке
    // ключи модели ни с чем не совпадут: раздел, которому велели быть в хвосте
    // тела, остался бы вкладкой — молча. Поэтому при `decided` группировка
    // отключается: что считать разделом, решает приложение, а не конструктор.
    if (named || OWN_TAB.includes(d.relation)) {
      // Ключ связи — ключ вкладки, и две связи с одним ключом дали бы два
      // одинаковых раздела (B13: «дублирующиеся вкладки»). Совпал — связи
      // идут в одну вкладку, а не во вторую такую же.
      const same = relTabs.find(x => x.id === d.key);
      if (same) same.defs.push(d); else relTabs.push({ id: d.key, label: d.label, relation: d.relation, defs: [d] });
      continue;
    }
    const sh = SHARED_TAB[d.relation];
    if (!sh) continue;
    const ex = relTabs.find(x => x.id === sh.id);
    if (ex) ex.defs.push(d); else relTabs.push({ id: sh.id, label: kitT(lang, sh.label), relation: d.relation, defs: [d] });
  }
  const relCount = (defs: KitRelationDef[]) => defs.reduce((n, d) => n + relationTargets(record, ctx, d).length, 0);
  // Счётчик раздела — ОДНИМ правилом (B13: «счётчики то есть, то нет»).
  //
  // Число считается по рёбрам выборки, а блок рёбер этого раздела мог не
  // прочитаться — тогда ноль был бы ЛОЖНЫМ. Поэтому у раздела, про который
  // meta.data_state (или meta.errors) говорит «сбой» или «нет прав», счётчик
  // неизвестен: `null`, то есть «?» с подсказкой, а не 0 и не пустота.
  const failed = useMemo(() => {
    const s = dataStateOf(ctx.data.meta);
    // Имя блока сервер пишет как «источник» или «источник · часть» — поэтому
    // сверяем и целиком, и по части: иначе честное состояние пришло бы, а до
    // счётчика не дошло.
    const names = [...s.failed, ...s.forbidden].map(f => f.block);
    return new Set(names.flatMap(n => [n, ...n.split(' · ')]));
  }, [ctx.data.meta]);
  const tabCount = (id: string, defs: KitRelationDef[]): number | null => (failed.has(id) ? null : relCount(defs));
  const zoned = placement !== undefined;
  const hasProps = zoned && (kind?.fields?.length ?? 0) > 0;
  // Снизу и на весь экран свойства — колонкой справа рядом с контентом (владелица 08.11):
  // читать и заполнять текст и свойства сразу, без переключений. Панелью справа (узко) — вкладкой.
  // Снизу — свойства колонкой справа; во весь экран — свёрткой под шапкой и рейкой у края, как v4 (S4-CONTENT-V4).
  // S4-30: «Свойства» в режиме «на весь экран» — свёрнутая строка под шапкой.
  // Раньше она всегда стартовала свёрнутой; теперь это настройка. Образец —
  // тот же, что у BurnChart: неуправляемый режим с умолчанием плюс
  // управляемый, когда выбор хранит приложение. kit сам ничего не хранит.
  //
  // Находка P1 аудита 08.11: в доке панель свойств была постоянной, а во весь
  // экран — свёрткой, то есть одна запись вела себя двумя способами. Теперь
  // свойства сворачиваются везде; умолчание сохраняет прежний вид каждого
  // режима: в доке раскрыто, во весь экран свёрнуто — молча ничего не прячем.
  const [propsOpenInner, setPropsOpenInner] = useState(defaultPropsOpen ?? placement === 'bottom');
  const propsOpen = propsOpenControlled ?? propsOpenInner;
  const propsSide = hasProps && placement === 'bottom' && propsOpen;
  const propsRow = hasProps && (placement === 'full' || (placement === 'bottom' && !propsOpen));
  // S4-30: ширина колонки свойств — личная и с пределами. 280 — середина
  // прежнего minmax(240, 320) из seidr.css: пока границу не тянули, вид не
  // меняется. Минимум 240 — оттуда же: уже этого пара «поле — значение»
  // ломается в две строки.
  const widths = useMemo(() => widthStore ?? createSafeStorage(), [widthStore]);
  const [propsW, setPropsW] = useState(() => zoneSize(widths, 'rec.props', PROPS_W.def, { min: PROPS_W.railW, max: PROPS_W.max }));
  // S4-30, уточнение владелицы 09.11: «не только при полном развороте — это
  // промежуточное состояние resizable состояния». Состояние колонки НЕ
  // хранится отдельно от размера: две правды о том, «что сейчас с колонкой»,
  // разошлись бы первой же правкой. Узкий размер и ЕСТЬ рейка.
  const propsRail = propsW < PROPS_W.rail;
  /** Вернуть колонку из рейки: размер ниже порога и ЕСТЬ рейка, поэтому возвращаем размер. */
  const openProps = (): void => { setPropsW(w => (w < PROPS_W.min ? PROPS_W.def : w)); setPropsOpen(true); };
  // <details> меняет своё open сам, и React не возвращает его обратно, если
  // проп не менялся. В управляемом режиме это сделало бы управление обманом:
  // человек щёлкнул, приложение не сохранило, а строка осталась раскрытой.
  // Поэтому в управляемом режиме состояние элемента приводим к пропу.
  const propsRowRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (propsOpenControlled === undefined) return;
    const el = propsRowRef.current;
    if (el && el.open !== propsOpenControlled) el.open = propsOpenControlled;
  });
  const setPropsOpen = (open: boolean) => {
    // В управляемом режиме своё состояние не двигаем: пока приложение не
    // ответило новым значением, интерфейс показывает то, что оно задало —
    // иначе вид и настройка разойдутся.
    if (propsOpenControlled === undefined) setPropsOpenInner(open);
    onPropsOpenChange?.(open);
  };
  // Ширина текста во весь экран — настройка наверху (владелица 08.11), запоминается в браузере.
  const [width, setWidthState] = useState<RecWidth>(() => readWidth());
  const setWidth = (w: RecWidth) => { setWidthState(w); try { localStorage.setItem(WIDTH_KEY, w); } catch { /* приватный режим — живём в памяти */ } };
  // Ряд вкладок записи. Вкладки вида идут РАНЬШЕ вкладок связей: при совпадении
  // ключа mergeTabs оставляет первую (её объявило приложение — там настоящая
  // таблица), добирая у связи счётчик и значок вида UML. До этой сверки один
  // раздел занимал в ряду два места (B13).
  const modes = placement === 'right' && !narrow;
  const recordItems: TabItem[] = mergeTabs([
    // В правом доке сегмент видов уже означает «Контент» — вкладка-дубль в ряд не идёт.
    ...(modes ? [] : [{ id: RECORD_TABS.overview, label: kitT(lang, zoned ? 'kit.record.tab.text' : 'kit.record.tab.overview'), zone: zoned ? 'record' as const : undefined }]),
    ...(hasProps && !propsSide && !propsRow ? [{ id: RECORD_TABS.props, label: kitT(lang, 'kit.record.tab.props'), zone: 'record' as const }] : []),
    // Счётчик у вкладки приложения — по тому же правилу, что у вкладок связей
    // (B13): вкладка без числа рядом с вкладками с числом читается как «тут
    // считать нечего», а у частей считать есть что.
    ...kindTabs.map(t => ({ id: t.key, label: t.title, count: t.count, zone: zoned ? 'record' as const : undefined })),
    ...relTabs.map(rt => ({ id: rt.id, label: rt.label, count: tabCount(rt.id, rt.defs), relation: rt.relation, mark: RELATION_MARK[rt.relation as keyof typeof RELATION_MARK], markTitle: relationName(lang, rt.relation), zone: zoned ? 'record' as const : undefined })),
  ]);
  // Счётчики служебного — тем же правилом: блок не прочитался, значит число
  // неизвестно («?»), а не ноль. Имена блоков рёбер и журнала у kit свои.
  const aroundItems: TabItem[] = [
    { id: RECORD_TABS.links, label: kitT(lang, 'kit.record.tab.links'), count: failed.has('edges') ? null : recordLinks(record.id, ctx.data.edges).length },
    { id: RECORD_TABS.graph, label: kitT(lang, 'kit.record.tab.graph') },
    { id: RECORD_TABS.journal, label: kitT(lang, 'kit.record.tab.journal'), count: failed.has('journal') ? null : recordJournal(record.id, ctx.data.journal).length },
    ...(history ? [{ id: RECORD_TABS.history, label: kitT(lang, 'kit.record.tab.history'), count: historyCount(history) }] : []),
  ].map(i => (zoned ? { ...i, zone: 'around' as const } : i));
  // По умолчанию всё вкладками; колонка слева — только aroundAs='column' при bottom/full.
  const aside = aroundAs === 'column' && (placement === 'bottom' || placement === 'full');
  // Разделы, которые модель велела вклеить в хвост тела, — только те, которые
  // я УМЕЮ там нарисовать (связи). Если модель вклеивает что-то другое (часть,
  // своя вкладка вида), раздел остаётся вкладкой: показать его не там, где
  // просили, — полбеды, а не показать вовсе — потеря данных с экрана.
  const glueable = new Set(relTabs.map(rt => rt.id));
  const order: PassportOrder | null | undefined = sections?.decided
    ? { decided: true, notes: sections.notes, sections: sections.sections.map(s => (s.slot === 'content' && !glueable.has(s.key) ? { ...s, slot: 'own' as const } : s)) }
    : sections;
  const glued = gluedSections(order)
    .map(s => relTabs.find(rt => rt.id === s.key))
    .filter((rt): rt is NonNullable<typeof rt> => !!rt)
    // Пустой блок не рисуется: иначе у ADR под текстом вылезет семь пустых
    // заголовков. «Не смогли прочитать» — другое утверждение: такой раздел
    // ОСТАЁТСЯ (со счётчиком «?»), а его причину печатает блок «Состояние
    // данных» по meta.data_state. Ложный ноль прятал бы и то, и другое.
    .filter(rt => tabCount(rt.id, rt.defs) !== 0);
  // Ряд: ключи уникальны (ключ связи мог совпасть и со служебным), а ПОРЯДОК —
  // от модели через applySections. Своего приоритета kit не придумывает: у
  // типа, которому сервер порядок задал, выдуманное правило разошлось бы с
  // моделью молча, а у типа с `decided: false` выдало бы догадку за решение
  // сервера. Порядок не решён — ряд остаётся как есть, и приложение ГОВОРИТ об
  // этом строкой (у LORE — notes из passportOrder), а не подменяет его тихо.
  //
  // А «ЧТО ПОД ЕЩЁ» РЕШАЕТ РЯД, а не модель (паспорта v3, 10.11.2026): это
  // вопрос ширины экрана и потолка в семь вкладок, и знает их только тот, кто
  // рисует (shell/tabRow.ts). Прежнее `slot: more` было решением о чужом
  // экране вслепую — сервер не знал ни ширины, ни того, сколько вкладок у
  // записи набралось вместе со служебными.
  const row = mergeTabs(aside ? recordItems : [...recordItems, ...aroundItems]);
  const ordered: TabItem[] = applySections(row, order);
  // ГРУППЫ: несколько родственных разделов — ОДНА вкладка с подписью группы
  // (шестой ключ модели). Склеиваются только разделы-связи: их рисует kit, и
  // внутри вкладки они становятся подзаголовками. Раздел, который kit внутри
  // нарисовать не умеет (вкладка вида от приложения), в группу не идёт и
  // остаётся своей вкладкой — показать его не там, где просили, полбеды, а не
  // показать вовсе — потеря данных с экрана (то же правило, что у `glueable`).
  const groupTabs = sectionGroups(order)
    .map(run => ({
      key: run.group.key,
      label: run.group.label,
      members: run.keys.map(k => relTabs.find(rt => rt.id === k)).filter((rt): rt is NonNullable<typeof rt> => !!rt),
    }))
    .filter(g => g.members.length > 0);
  const groupOf = new Map(groupTabs.flatMap(g => g.members.map(m => [m.id, g] as const)));
  // Счётчик группы — СУММА счётчиков разделов, и один непроверенный раздел
  // делает неизвестной ВСЮ сумму. Частичная сумма выглядит точной: вкладка
  // сказала бы «2» там, где на самом деле «2 и неизвестно сколько ещё».
  const groupCount = (g: (typeof groupTabs)[number]): number | null => {
    const counts = g.members.map(m => tabCount(m.id, m.defs));
    if (counts.some(c => c === null)) return null;
    return counts.reduce<number>((n, c) => n + (c ?? 0), 0);
  };
  const foldGroups = (list: readonly TabItem[]): TabItem[] => {
    if (groupTabs.length === 0) return [...list];
    const out: TabItem[] = [];
    const placed = new Set<string>();
    for (const it of list) {
      const g = groupOf.get(it.id);
      if (!g) { out.push(it); continue; }
      if (placed.has(g.key)) continue;
      placed.add(g.key);
      out.push({ id: g.key, label: g.label, count: groupCount(g), zone: zoned ? 'record' : undefined });
    }
    return out;
  };
  const items: TabItem[] = foldGroups(ordered);
  // Адрес мог быть сохранён до того, как разделы сгруппировали. Увести человека
  // по старой ссылке на обзор — то же, что сломать ссылку, поэтому ключ раздела
  // приводится к ключу его группы.
  const asked = groupOf.get(tab)?.key ?? tab;
  // Вкладка не выбрана (или устарела): на десктопе — обзор, как прежде; на
  // телефоне — первая вкладка ряда, то есть первая по модели (v1: у спринта
  // первыми задачи, D-2026-UXR-MOBILE-FOLLOWS-V1). Выбор человека главнее:
  // явный «Контент» остаётся контентом.
  const fallbackTab = narrow && items.length > 0 ? items[0].id : RECORD_TABS.overview;
  const current = items.some(i => i.id === asked) ? asked : fallbackTab;
  // Панелью справа (узко) — переключатель видов над шапкой, как «таблица / доска» (владелица 08.11):
  // Контент (текст и вкладки типа) · Свойства · Аналитика (связи, граф, журнал, история).
  //
  // НА ТЕЛЕФОНЕ СЕГМЕНТА НЕТ (S4-MOBILE-COMPARE): сегмент и вкладки вида давали
  // ДВА ряда управления («Контент · Свойства · Аналитика» и под ним «Контент ·
  // Ещё 8»), а задачи спринта уезжали под «Ещё». Один ряд, как в v1: всё, что
  // было под сегментом, — вкладками того же ряда (лишнее — под «Ещё»), ничего
  // не пропадает.
  type Mode = 'content' | 'props' | 'analytics';
  const mode: Mode = current === RECORD_TABS.props ? 'props' : aroundItems.some(i => i.id === current) ? 'analytics' : 'content';
  const contentItems = foldGroups(recordItems.filter(i => i.id !== RECORD_TABS.props));
  const shown: TabItem[] = !modes ? items : mode === 'analytics' ? aroundItems : mode === 'content' ? contentItems : [];
  const firstOf: Record<Mode, string> = { content: RECORD_TABS.overview, props: RECORD_TABS.props, analytics: aroundItems[0].id };
  const switcher = modes ? (
    <div className="sk-rec__modes sk-rec__modes--mini">
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
  const groupTab = groupTabs.find(g => g.key === current);
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
            <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} fieldSave={fieldSave} />
          </BlockBoundary>
        )}
        {/*
          Разделы со `slot: "content"` — блоками в хвосте тела, как было в v1 у
          зависимостей спринта и у списка решений ADR (слова владелицы 09.11,
          подтверждено её CJM). Заголовок со СЧЁТЧИКОМ обязателен: вкладки у
          раздела больше нет, и без счётчика число исчезло бы с экрана совсем.
        */}
        {glued.map(rt => (
          <GluedBlock key={rt.id} id={rt.id} label={rt.label} count={tabCount(rt.id, rt.defs)} lang={lang}>
            <BlockBoundary block={`rel:${rt.id}`} label={rt.label} lang={lang} resetKey={reset}>
              <RecordRelations record={record} ctx={ctx} defs={rt.defs} lang={lang} />
            </BlockBoundary>
          </GluedBlock>
        ))}
      </div>
    );
  } else if (current === RECORD_TABS.props && kind && !propsSide) {
    panel = (
      <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={reset}>
        <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} fieldSave={fieldSave} />
      </BlockBoundary>
    );
  } else if (current === RECORD_TABS.history && history) {
    panel = (
      <BlockBoundary block="history" label={kitT(lang, 'kit.record.tab.history')} lang={lang} resetKey={reset}>
        <RecordHistory record={record} source={history} lang={lang} />
      </BlockBoundary>
    );
  } else if (custom) {
    // Вкладка вида — РАНЬШЕ связи с тем же ключом (B13). Раньше связь шла
    // первой, и это тихо отнимало функцию: у спринта вместо настоящей таблицы
    // задач (группировка по фазам, смена статуса в строке, строка сгорания)
    // рисовался общий список связей. Приложение объявило вкладку намеренно —
    // его рисовальщик и главнее; число и значок вида связи при слиянии
    // остались у чипа.
    panel = (
      <BlockBoundary block={`tab:${custom.key}`} label={custom.title} lang={lang} resetKey={reset}>
        <KindTab render={custom.render} record={record} ctx={ctx} />
      </BlockBoundary>
    );
  } else if (groupTab) {
    // Вкладка группы: разделы ПОДЗАГОЛОВКАМИ внутри одной вкладки, в порядке
    // модели. Счётчик у каждого свой — сумма на вкладке не должна прятать, из
    // чего она собрана, а «не проверено» у одного раздела обязано быть видно
    // именно у него, а не размазываться по всей группе.
    panel = (
      <div className="sk-rec-group">
        {groupTab.members.map(rt => (
          <section key={rt.id} className="sk-rec-group__sec" aria-label={rt.label}>
            {/* h2, а не h3: в панели вкладки это ПЕРВЫЙ заголовок после
                заголовка записи, и h3 оставлял бы дыру в уровнях — axe ловит
                это правилом heading-order, а скринридер по списку заголовков
                читает как «пропущен раздел». У вклеенного в хвост текста блока
                (.sk-rec-glue__head) уровень третий по делу: над ним уже стоят
                h2 разделов тела. */}
            <h2 className="sk-rec-group__head">
              <span>{rt.label}</span>
              <TabCount count={tabCount(rt.id, rt.defs)} lang={lang} />
            </h2>
            <BlockBoundary block={`rel:${rt.id}`} label={rt.label} lang={lang} resetKey={reset}>
              <RecordRelations record={record} ctx={ctx} defs={rt.defs} lang={lang} />
            </BlockBoundary>
          </section>
        ))}
      </div>
    );
  } else if (relTab) {
    panel = (
      <BlockBoundary block={`rel:${relTab.id}`} label={relTab.label} lang={lang} resetKey={reset}>
        <RecordRelations record={record} ctx={ctx} defs={relTab.defs} lang={lang} />
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
  // Рейка зоны: те же три действия, что у рейки полного экрана, только
  // иконками. Выбор иконок — владелицы 09.11 (ICON_CANON.recProps/recGraph/
  // recAnalytics); подпись остаётся именем для скринридера и подсказкой.
  const zoneRail = (
    <>
      <IconButton icon={ICON_CANON.recProps} label={kitT(lang, 'kit.record.tab.props')} onClick={() => openProps()} />
      <IconButton icon={ICON_CANON.recGraph} label={kitT(lang, 'kit.record.tab.graph')} onClick={() => onTab(RECORD_TABS.graph)} />
      <IconButton icon={ICON_CANON.recAnalytics} label={kitT(lang, 'kit.record.rail.analytics')} onClick={() => onTab(RECORD_TABS.links)} />
    </>
  );
  const propsAside = propsSide && kind ? (
    <aside
      className={['sk-rec__props', propsRail ? 'sk-rec__props--rail' : ''].filter(Boolean).join(' ')}
      data-zone="props"
      aria-label={kitT(lang, 'kit.record.tab.props')}
    >
      {propsRail ? zoneRail : (
        <>
          {/* Заголовок зоны — кнопка свёртки: то же действие, что «▸ Свойства» во
              весь экран (находка P1 аудита 08.11 про два поведения). */}
          <button type="button" className="sk-rec__zone sk-rec__zone--fold" aria-expanded="true" onClick={() => setPropsOpen(false)}>
            {kitT(lang, 'kit.record.tab.props')}
          </button>
          <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={record.id}>
            <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} fieldSave={fieldSave} />
          </BlockBoundary>
        </>
      )}
    </aside>
  ) : null;
  const mainBlock = (
    <>
        {placement === 'full' && (
          <div className="sk-rec-widthbar">
            <div role="radiogroup" aria-label={kitT(lang, 'kit.record.width')} className="sk-rec-widthbar__seg">
              {WIDTHS.map(w => (
                <button key={w} type="button" role="radio" aria-checked={width === w} className="sk-rec-widthbar__opt" onClick={() => setWidth(w)}>
                  {kitT(lang, `kit.record.width.${w}` as 'kit.record.width.s')}
                </button>
              ))}
            </div>
          </div>
        )}
        <RecordHead record={record} ctx={ctx} lang={lang} titleId={titleId} withStatus={!facts} tail={facts ? undefined : loaded} />
        {/* Виды записи — под заголовком мини-кнопками (владелица 13.11.2026: «вынеси в лево мини
            кнопками или под Заголовок»): над шапкой рейка стояла первой строкой паспорта и
            спорила с заголовком. */}
        {switcher}
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
        {/*
          S4-30 / MP2-08: что проверено, что не смогли, что обрезано. Источник —
          meta той же выдачи, из которой нарисована запись, поэтому подключать
          это экранам вручную не нужно (и нельзя: однажды забудут).
          Сообщения уходят в общий значок warnings над записью (сборщик экрана);
          без сборщика — прежний блок над содержимым, чтобы не молчать.
        */}
        <DataStateWarnings meta={ctx.data.meta} />
        {propsRow && kind && (
          <details ref={propsRowRef} className="sk-rec-propsrow" open={propsOpen} onToggle={e => setPropsOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary className="sk-rec-propsrow__sum">
              <span className="sk-rec-propsrow__label">{kitT(lang, 'kit.record.tab.props')}</span>
              {propsSummary(record, kind) && <span className="sk-rec-propsrow__vals"> · {propsSummary(record, kind)}</span>}
            </summary>
            <BlockBoundary block="fields" label={kitT(lang, 'kit.record.fields')} lang={lang} resetKey={record.id}>
              <Fields record={record} kind={kind} ctx={ctx} lang={lang} edit={edit} fieldSave={fieldSave} />
            </BlockBoundary>
          </details>
        )}
        {propsAside ? (
          <div
            className="sk-rec__body"
            style={{ '--props-w': `${propsRail ? PROPS_W.railW : propsW}px` } as CSSProperties}
          >
            <div className="sk-rec__content">{tabsBlock}</div>
            {/* Граница содержимого и свойств (S4-30). Зона — СПРАВА от неё,
                поэтому side="after": тянуть влево значит расширять свойства.
                Минимум — ширина рейки, а не колонки: сжатая колонка с
                обрезанными подписями не состояние, а поломка, поэтому ниже
                порога подписи честно исчезают и остаются иконки. */}
            <ResizeBorder
              zone="rec.props"
              className="sk-rec__resize"
              side="after"
              size={propsW}
              min={PROPS_W.railW}
              max={PROPS_W.max}
              levels={{
                rail: PROPS_W.rail,
                hide: PROPS_W.hide,
                // Рейку рисует сам размер (propsRail), поэтому здесь нужен
                // только уход колонки. И размер при уходе возвращается к
                // умолчанию: иначе человек раскроет свойства и получит рейку,
                // которую не просил.
                onLevel: level => {
                  if (level !== 'hidden') return;
                  setPropsW(PROPS_W.def);
                  setPropsOpen(false);
                },
              }}
              store={widths}
              onSize={setPropsW}
              label={kitT(lang, 'kit.record.propsWidth')}
            />
            {propsAside}
          </div>
        ) : tabsBlock}
        {/* Рейка во весь экран — та же мини-версия зоны, что и у узкой колонки:
            только иконками (владелица 09.11, «три»). Подписи вертикальным
            текстом ушли: в одной оболочке два вида одной рейки человек читает
            как два разных элемента. */}
        {placement === 'full' && (
          <nav className="sk-rec-rail" aria-label={kitT(lang, 'kit.record.rail')}>
            {hasProps && (
              <IconButton icon={ICON_CANON.recProps} label={kitT(lang, 'kit.record.tab.props')} onClick={() => setPropsOpen(true)} />
            )}
            <IconButton icon={ICON_CANON.recGraph} label={kitT(lang, 'kit.record.tab.graph')} onClick={() => onTab(RECORD_TABS.graph)} />
            <IconButton icon={ICON_CANON.recAnalytics} label={kitT(lang, 'kit.record.rail.analytics')} onClick={() => onTab(RECORD_TABS.links)} />
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
            <h2 className="sk-rec__around-head">{i.label}<TabCount count={i.count} lang={lang} /></h2>
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
    <article className={cls} aria-labelledby={titleId} data-kind={record.kind} data-placement={placement} data-width={placement === 'full' ? width : undefined}>
      {cols ? (<>{around}<div className="sk-rec__main">{mainBlock}</div></>) : mainBlock}
    </article>
  );
}

// Тело паспорта БЕЗ шапки и вкладок — для вложенного блока вида
// (S4-TREE-NESTED: «зависимый объект показывается вложенным блоком своего вида:
// тот же рендер, что у его паспорта или строки»).
//
// Именно РЕЭКСПОРТ, а не копия: второй рендер тела разошёлся бы с этим на
// первой же правке (разделы данными, ✎ у раздела, «Текста нет» вместо тупика),
// и вложенный блок начал бы показывать запись иначе, чем её паспорт.
export { Overview as RecordBodyOverview, Fields as RecordBodyFields };
