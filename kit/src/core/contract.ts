// КОНТРАКТ ЯДРА Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-01, D-2026-UXR-KIT-REACT).
// Общий для всех задач спринта: K-01 реализует ядро по нему, остальные пишут
// против него. Файл — дословная копия контракта; менять только согласованно
// (батч-поставка сливает одинаковые копии). Схема, валидатор и примеры — рядом:
// schema/*.schema.json, validate.ts, kit/demo/*.config.ts.
import type * as React from 'react';
import type { LoreStatusCategory } from './statusAxis';

/** S4-27: закрытые (категории done/cancelled) — внизу свёрнуто / все / за 30 дней / скрыть. */
export type KitShowClosed = 'below' | 'all' | 'days30' | 'hide';
export interface KitConfig { modules: {id:string; title:string; icon:string; status?:'planned'|'active'}[]; menu: {groups:{id:string; title:string; tone?:string; /** S4-MENU-STATES: группа идёт ВЫШЕ «Моих видов» и «Недавних» — порядок называет приложение (владелица 09.11: «новости должны стоять до моих видов и недавних»). */ pinTop?:boolean; items:{id:string; title:string; icon?:string; view?:string}[]}[]; myViews?:boolean; recent?:boolean}; kinds: Record<string, KindConfig>; edges?: Record<string,{label:string; color:string; layer?:'structural'}>; graph?: {depth:1|2|3; limit:number; colorBy?:'verdict'|'type'}; statuses: {items:{code:string; title:string; category:KitStatusCategoryInput; icon:string; color:string; hotkey?:string; allow?:string[]}[]; selfApprove?:boolean; undo?:boolean; bulk?:boolean}; roles?: Record<string,{canEdit:boolean; canStatus:boolean}>; verdict?: (r:KitRecord, ctx:KitCtx)=>KitVerdict; list?: {views:('list'|'cards'|'board'|'tree'|'feed'|'timeline')[]; /** Вид «Таймлайн» (S4-22): поля даты начала и конца (ключи fields). */ timeline?:{start:string; end?:string}; quick?:{id:string; title:string; filter:KitFilter}[]; filters?:string[]; groupings?:string[]; /** S9-02: разрезы, у которых группы свёрнуты при первом показе (у LORE — релиз и спринт: групп всегда много). */ collapsedGroupings?:string[]; columns?:string[]; tree?:{parent:string; order:string; rollup?:'verdict'|'status'}; showClosed?:KitShowClosed}; palette?: {commands?:{id:string; title:string; run:(ctx:KitCtx)=>void}[]}; hooks?: KitHooks }
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
export interface KindConfig { title:string; icon:string; relations?:KitRelationDef[]; overview?:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string; tabs?:{key:string; title:string; render:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string}[]; fields?:{key:string; title:string; type:'text'|'md'|'enum'|'ref'|'date'|'number'; /** Подзаголовок раздела в «Свойствах» (S4-36, как блоки v1 «Планирование», «Модули»). */ section?:string}[] }
export interface KitRecord { id:string; kind:string; title:string; status:string; fields:Record<string,unknown>; body_md?:string; updated_at?:string }
export interface KitEdge { from:string; to:string; type:string }
export interface KitJournalEntry { at:string; who:string; is_agent?:boolean; record_id:string; field:string; from:unknown; to:unknown; approved_by?:string }
export interface KitMeta { generated_at:string; scope?:string; total?:number; returned?:number; truncated?:boolean; errors?:{block:string; reason:string}[] }
export interface KitData { records:KitRecord[]; edges:KitEdge[]; journal:KitJournalEntry[]; meta:KitMeta }
export interface KitVerdict { score:number; max:number; failed:string[]; hints:string[] }
export type KitFilter = Record<string, string|string[]>;
export interface KitHooks { /** Привязать / отвязать связь (агрегация, ассоциация-«зависимость»). */ onRelation?:(c:{type:string; id:string; rel:string; dir:'out'|'in'; target:string; action:'add'|'remove'})=>Promise<void>; onSave?:(c:{type:string; id:string; field:string; from:unknown; to:unknown})=>Promise<void>; onActivate?:(v:string)=>Promise<void>; onRollback?:(v:string)=>Promise<void> }
export interface KitCtx { data:KitData; config:KitConfig; role?:string; user?:string; href:(id:string)=>string; esc:(s:string)=>string; md:(s:string)=>React.ReactNode }
