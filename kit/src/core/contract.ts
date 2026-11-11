// КОНТРАКТ ЯДРА Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-01, D-2026-UXR-KIT-REACT).
// Общий для всех задач спринта: K-01 реализует ядро по нему, остальные пишут
// против него. Файл — дословная копия контракта; менять только согласованно
// (батч-поставка сливает одинаковые копии). Схема, валидатор и примеры — рядом:
// schema/*.schema.json, validate.ts, kit/demo/*.config.ts.
import type * as React from 'react';
import type { LoreStatusCategory } from './statusAxis';

/** S4-27: закрытые (категории done/cancelled) — внизу свёрнуто / все / за 30 дней / скрыть. */
export type KitShowClosed = 'below' | 'all' | 'days30' | 'hide';
export interface KitConfig { modules: {id:string; title:string; icon:string; status?:'planned'|'active'}[]; menu: {groups:{id:string; title:string; tone?:string; /** S4-MENU-STATES: группа идёт ВЫШЕ «Моих видов» и «Недавних» — порядок называет приложение (владелица 09.11: «новости должны стоять до моих видов и недавних»). */ pinTop?:boolean; items:{id:string; title:string; icon?:string; view?:string}[]}[]; myViews?:boolean; recent?:boolean}; kinds: Record<string, KindConfig>; edges?: Record<string,{label:string; color:string; layer?:'structural'}>; graph?: {depth:1|2|3; limit:number; colorBy?:'verdict'|'type'; /** GC-03: вид вкладки «Граф» по умолчанию — у LORE личная настройка человека; выбор в адресе (gview) главнее. */ view?:'graph'|'links'|'force'|'obsidian'; /** GC-03: карточка выбранного узла в видах Force/Обсидиан — Peek приложения (владелица 11.11: «подключить к графу свой peek»). Нет — строка с названием и «Открыть». */ peek?:(id:string)=>React.ReactNode}; statuses: {items:{code:string; title:string; category:KitStatusCategoryInput; icon:string; color:string; hotkey?:string; allow?:string[]}[]; selfApprove?:boolean; undo?:boolean; bulk?:boolean}; roles?: Record<string,{canEdit:boolean; canStatus:boolean}>; verdict?: (r:KitRecord, ctx:KitCtx)=>KitVerdict; list?: {views:('list'|'cards'|'board'|'tree'|'feed'|'timeline'|'calendar')[]; /** Вид «Таймлайн» (S4-22): поля даты начала и конца (ключи fields). */ timeline?:{start:string; end?:string}; /** Вид «Календарь» (K2-VIEW-CALENDAR): какое поле — дата (ключ fields или updated_at). */ calendar?:{date:string}; quick?:{id:string; title:string; filter:KitFilter}[]; filters?:string[]; groupings?:string[]; /** K4-FACET-LABELS: подписи полей ВНЕ kind.fields — вычисляемых сервером или приложением («quality» → «Качество»). Ключ — имя поля, с приставкой «fields.» или без. Фасет или разрез без подписи валидатор называет (facet-without-label), а kit показывает ключ строчными с подсказкой, а не выдаёт ключ за подпись. */ fieldLabels?:Record<string,string>; /** S9-02: разрезы, у которых группы свёрнуты при первом показе (у LORE — релиз и спринт: групп всегда много). */ collapsedGroupings?:string[]; /** Вид «Лента» (K2-FEED-VIEW): поля, которые НАЗЫВАЕТ приложение — по какому полю время, какие поля несут суть, какие связи объясняют повод. Без `timeField` ленту не предлагаем: kit не угадывает, где у записи время (K-14). */ feed?:{timeField:string; lead?:string[]; because?:string[]; /** Двухуровневая лента (K2-FEED-TWO-LEVEL): `title` — подпись НИЖНЕГО уровня словом приложения («задачи», «решения»). Без неё двух уровней нет: kit не выдумает, чем он наполнен, а «Ещё 7» неизвестно чего читать нельзя (K-14). Сам состав нижнего уровня приходит пропсом `feedUnder` и грузится ПРИ РАСКРЫТИИ (слово владелицы 10.11.2026). */ under?:{title:string}}; columns?:string[]; /** S4-35 / ADR-LORE-049: показ колонки из модели (`display` поля): приоритет 1..4 (1 не прячется никогда, 4 — первой), шаг ширины, переполнение. Ключ — колонка или имя поля без «fields.». */ columnDisplay?:Record<string,{priority?:number; width?:'xs'|'s'|'m'|'l'|'fill'; overflow?:'none'|'ellipsis'|'more'}>; /** K4-FRESHNESS: пороги свежести для колонки `fresh:<поле>` — в минутах; ключ — имя поля. С warnAfter — тон «предупреждение», со staleAfter — «устарело». Порогов нет — тона нет: что считать «давно», решает приложение. `perRecord` — имена полей записи с минутами ЭТОЙ строки (S7B-ACT-1: у каждой машины своё окно активности); число в поле главнее порога колонки. */ fresh?:Record<string,{warnAfter?:number; staleAfter?:number; perRecord?:{warnAfter?:string; staleAfter?:string}}>; tree?:{parent:string; order:string; rollup?:'verdict'|'status'}; showClosed?:KitShowClosed}; palette?: {commands?:{id:string; title:string; run:(ctx:KitCtx)=>void}[]}; hooks?: KitHooks }
/**
 * Категория статуса в конфигурации (S4-STATUS-AXIS-CONFIG).
 *
 * Принимаем ось владелицы (D-2026-UXR-STATUS-AXIS, шесть значений) и прежние
 * четыре значения kit — конфиги, написанные до решения, должны продолжать
 * работать. К оси приводит `normalizeAxisCategory`; сужать её нельзя, иначе
 * «действует» молча станет «завершено».
 */
export type KitStatusCategoryInput = LoreStatusCategory | 'todo' | 'active' | 'done' | 'cancelled';

/**
 * Статья справочника LORE (срез `dictionary`, S4-36). `task_type` даёт иконку
 * и цвет, `work_class` — код и цвет. Своих иконок и цветов kit не выдумывает
 * (правило S4-25): чего нет в справочнике, показывается честно исходным кодом.
 */
export interface KitDictItem { code:string; title:string; icon?:string; color?:string }

/** Вид связи по UML (D-2026-LORE-RECORD-RELATION-UML). */
export type KitRelation = 'composition'|'aggregation'|'association'|'attribute'|'realization'|'generalization';
/** Связь типа: ребро, направление и вид — kit рисует и управляет по виду, типов записей не зная. */
/**
 * Связь типа. `manageable` — есть ли у приложения путь привязки ИМЕННО для
 * этой связи; задан — он главнее вида UML, потому что про свои пути знает
 * только сервер (у LORE это `LoreRecordRelationRoutes`). Не задан — остаётся
 * прежнее правило по виду UML, чтобы конфиги без этого признака не потеряли
 * управление связями.
 */
export interface KitRelationDef { key:string; label:string; relation:KitRelation; rel:string; dir:'out'|'in'; manageable?:boolean }
export interface KindConfig { title:string; icon:string; relations?:KitRelationDef[];
  /**
   * Разделы тела записи — ДАННЫМИ (S5-06, S5-09). Список «ключ поля + подпись»;
   * рисует их kit, поэтому у каждого раздела сразу есть ✎, черновик и честное
   * пустое состояние.
   *
   * Данные ГЛАВНЕЕ `overview`: своя функция рисования тихо отняла правку
   * заметки задачи (дефект прода v1.17.7 — «нет ни ✎, ни „Править"»), потому
   * что kit отдавал ей весь обзор и редактор до тела не доходил.
   */
  bodySections?:{key:string; title:string; /** Раздел можно писать. false — только чтение даже при праве правки: путь записи для него сервер не даёт (schema.fields[].editable). */ editable?:boolean}[];
  overview?:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string; tabs?:{key:string; title:string; /** Сколько элементов (B13): число — счёт, `null` — «не смогли посчитать», поля нет — считать нечего. Рисуется тем же TabCount, что у вкладок связей. */ count?:number|null; render:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string}[]; fields?:{key:string; title:string; /** `sum` (S4-09) — сумма с охватом (KitSumInput), та же ячейка, что `sum:` в списке. */ type:'text'|'md'|'enum'|'ref'|'date'|'number'|'sum'; /** Подзаголовок раздела в «Свойствах» (S4-36, как блоки v1 «Планирование», «Модули»). */ section?:string; /** S4-24: поле правится на месте (✎ → FieldEditor). Право и путь записи называет приложение; без него — только чтение. */ editable?:boolean; /** Варианты для enum (значение или пара «значение + подпись»). Нет вариантов — enum не правится: выбирать не из чего. */ options?:(string|{value:string; label:string})[]; /** Обязательность (D-2026-LORE-RECORD-FIELD-REQUIRED). */ required?:'block'|'warn'}[] }
export interface KitRecord { id:string; kind:string; title:string; status:string; fields:Record<string,unknown>; body_md?:string; updated_at?:string; /** S7B-28: доп. текст для поиска списка (логин, проекты, агенты…) — называет приложение; kit ищет по id, названию и ему. */ search?:string }
export interface KitEdge { from:string; to:string; type:string }
export interface KitJournalEntry { at:string; who:string; is_agent?:boolean; record_id:string; field:string; from:unknown; to:unknown; approved_by?:string }
export interface KitMeta { generated_at:string; scope?:string; total?:number; returned?:number; truncated?:boolean; errors?:{block:string; reason:string;
  /** Отказ по ПРАВАМ, а не сбой (K2-FEED-VIEW §6): «нет прав» ≠ «не смогли проверить», и по тексту причины это не угадывается — признак называет приложение. */
  forbidden?:boolean;
  /** Когда пропуск случился — чтобы в ленте он стоял на своём месте по времени, а не притворялся свежим. Не названо — строка идёт в «без времени». */
  at?:string;
  /** Кому строка (S4-TECH-NOTES): 'tech' — диагностика, скрыта, пока её не включили; без тега — 'user'. Ставит тот, кто строку рождает. */
  audience?:'user'|'tech'}[] }
export interface KitData { records:KitRecord[]; edges:KitEdge[]; journal:KitJournalEntry[]; meta:KitMeta }
export interface KitVerdict { score:number; max:number; failed:string[]; hints:string[] }
export type KitFilter = Record<string, string|string[]>;
export interface KitHooks { /** Привязать / отвязать связь (агрегация, ассоциация-«зависимость»). */ onRelation?:(c:{type:string; id:string; rel:string; dir:'out'|'in'; target:string; action:'add'|'remove'})=>Promise<void>; onSave?:(c:{type:string; id:string; field:string; from:unknown; to:unknown})=>Promise<void>; onActivate?:(v:string)=>Promise<void>; onRollback?:(v:string)=>Promise<void> }
export interface KitCtx { data:KitData; config:KitConfig; role?:string; user?:string; href:(id:string)=>string; esc:(s:string)=>string; md:(s:string)=>React.ReactNode }
