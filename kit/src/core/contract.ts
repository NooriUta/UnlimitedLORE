// КОНТРАКТ ЯДРА Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT, D-2026-UXR-KIT-REACT,
// D-2026-UXR-KIT-FOUNDATION). Общий для всех задач K-*: K-01 реализует ядро,
// остальные пишут против этого файла. Править — только синхронно со всеми.
import type * as React from 'react';

export interface KitConfig { modules: {id:string; title:string; icon:string; status?:'planned'|'active'}[]; menu: {groups:{id:string; title:string; tone?:string; items:{id:string; title:string; icon?:string; view?:string}[]}[]; myViews?:boolean; recent?:boolean}; kinds: Record<string, KindConfig>; edges?: Record<string,{label:string; color:string}>; graph?: {depth:1|2|3; limit:number; colorBy?:'verdict'|'type'}; statuses: {items:{code:string; title:string; category:'todo'|'active'|'done'|'cancelled'; icon:string; color:string; hotkey?:string; allow?:string[]}[]; selfApprove?:boolean; undo?:boolean; bulk?:boolean}; roles?: Record<string,{canEdit:boolean; canStatus:boolean}>; verdict?: (r:KitRecord, ctx:KitCtx)=>KitVerdict; list?: {views:('list'|'board'|'tree')[]; quick?:{id:string; title:string; filter:KitFilter}[]; filters?:string[]; groupings?:string[]; columns?:string[]; tree?:{parent:string; order:string; rollup?:'verdict'|'status'}}; palette?: {commands?:{id:string; title:string; run:(ctx:KitCtx)=>void}[]}; hooks?: KitHooks }
export interface KindConfig { title:string; icon:string; overview?:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string; tabs?:{key:string; title:string; render:(r:KitRecord, ctx:KitCtx)=>React.ReactNode|string}[]; fields?:{key:string; title:string; type:'text'|'md'|'enum'|'ref'|'date'|'number'}[] }
export interface KitRecord { id:string; kind:string; title:string; status:string; fields:Record<string,unknown>; body_md?:string; updated_at?:string }
export interface KitEdge { from:string; to:string; type:string }
export interface KitJournalEntry { at:string; who:string; is_agent?:boolean; record_id:string; field:string; from:unknown; to:unknown; approved_by?:string }
export interface KitMeta { generated_at:string; scope?:string; total?:number; returned?:number; truncated?:boolean; errors?:{block:string; reason:string}[] }
export interface KitData { records:KitRecord[]; edges:KitEdge[]; journal:KitJournalEntry[]; meta:KitMeta }
export interface KitVerdict { score:number; max:number; failed:string[]; hints:string[] }
export type KitFilter = Record<string, string|string[]>;
export interface KitHooks { onSave?:(c:{type:string; id:string; field:string; from:unknown; to:unknown})=>Promise<void>; onActivate?:(v:string)=>Promise<void>; onRollback?:(v:string)=>Promise<void> }
export interface KitCtx { data:KitData; config:KitConfig; role?:string; user?:string; href:(id:string)=>string; esc:(s:string)=>string; md:(s:string)=>React.ReactNode }
