// Объект паспорта lore.record/1 (SPEC-LORE-UXR-RECORD-CONTRACT, ADR-LORE-047 — PROPOSED).
// Демо-проверка контракта до решения по ADR: фасад /lore/record ЭМУЛИРУЕТСЯ на клиенте
// из существующих слайсов (toLoreRecord), а kit рисует только то, что пришло в объекте
// (fromLoreRecord). Когда фасад появится на бэкенде, toLoreRecord уходит, fromLoreRecord остаётся.
// Честность: эмуляция помечена в meta.facade; упавший блок — meta.sources[].state='error', не «пусто».
import { createElement } from 'react';
import type { KitConfig, KitCtx, KitData, KitEdge, KitLang, KitRecord, KitRelation } from '@seidr/kit';
import { appT } from '../i18n';
import { baseConfig, type PassportLoad } from './passportAdapters';
import { SPRINT_FACTS } from './loreRecord';
import { ADR_BODY_READONLY, EDITABLE_BODY } from './passportSave';

export type FieldKind = 'text' | 'md' | 'enum' | 'ref' | 'date' | 'number';
export interface LoreField {
  key: string; label: string; kind: FieldKind;
  required: boolean; editable: boolean; multi?: boolean;
  group: 'head' | 'body' | 'props';
  /** Раздел внутри «Свойств» (S4-36): «Планирование», «Модули». */
  section?: string;
}
export interface LoreTab { key: string; label: string; zone: 'record' | 'around'; rel?: string; dir?: 'out' | 'in'; count?: number }
/** Связь типа по виду UML (D-2026-LORE-RECORD-RELATION-UML) — kit рисует и управляет по виду. */
export interface LoreRelation { key: string; label: string; relation: KitRelation; rel: string; dir: 'out' | 'in'; count: number }
export interface LoreLink { rel: string; dir: 'out' | 'in'; id: string; type: string; title: string; status: string }
export interface LoreSource { block: string; state: 'ok' | 'forbidden' | 'error' | 'truncated'; code?: number; reason?: string; shown?: number; total?: number }
export interface LoreRecord1 {
  contract: 'lore.record/1';
  record: { type: string; id: string; title: string; status: string; version: number | null; updated_at: string | null; updated_by: string | null };
  schema: { type: string; label: string; icon: string; fields: LoreField[]; tabs: LoreTab[]; relations: LoreRelation[] };
  values: Record<string, unknown>;
  links: LoreLink[];
  facts: { tasks?: { done: number; total: number } | { error: string }; due?: string | null } | null;
  perms: { can_edit: boolean; can_status: boolean; can_create: boolean; status_next: string[]; reason: string | null };
  meta: { loaded_at: string; facade: 'server' | 'client-emulated'; sources: LoreSource[] };
}

/**
 * Без чего запись не сохранить — по обязательным параметрам MCP-инструментов *_new
 * (task_new: sprint_id, title; sprint_new/adr_new/spec_new: id и название).
 * ВРЕМЕННО, до реестра полей на бэкенде (ADR-LORE-047 §1).
 */
const REQUIRED: Record<string, string[]> = { task: ['sprint'] };
/** Поля текста записи, идущие разделами (ADR: контекст / решение / следствия, как в v1). */
export const BODY_FIELDS = ['context_md', 'decision_md', 'consequences_md'];

/** Вкладки-связи типа: какое ребро они показывают. */
const TAB_REL: Record<string, { rel: string; dir: 'out' | 'in' }> = {
  tasks: { rel: 'HAS_TASK', dir: 'out' },
  decisions: { rel: 'DECIDED_IN', dir: 'in' },
};

/** Право править (ADR-LORE-047 п. 14.1): текст спринта, задачи, спеки — существующими путями записи; ADR — пока нет. */
function permsOf(type: string, lang: KitLang): LoreRecord1['perms'] {
  const canEdit = (EDITABLE_BODY as readonly string[]).includes(type);
  return {
    can_edit: canEdit, can_status: false, can_create: false, status_next: [],
    reason: canEdit ? appT(lang, 'pp.contract.editNoVersion') : type === 'adr' ? ADR_BODY_READONLY : appT(lang, 'pp.contract.readonly'),
  };
}

/** Эмуляция фасада: загрузка из слайсов → объект контракта (только данные, без функций). */
export function toLoreRecord(load: PassportLoad, loadedAt: string, lang: KitLang = 'ru'): LoreRecord1 {
  const { record: r, data, config } = load;
  const type = r.kind.toLowerCase();
  const kind = config.kinds[r.kind];
  const req = REQUIRED[type] ?? [];
  const all = kind?.fields ?? [];
  const bodyDefs = all.filter(f => BODY_FIELDS.includes(f.key));
  const props: LoreField[] = all.filter(f => !BODY_FIELDS.includes(f.key)).map(f => ({
    key: f.key, label: f.title, kind: f.type, required: req.includes(f.key), editable: true,
    ...(f.type === 'ref' && Array.isArray(r.fields[f.key]) ? { multi: true } : {}),
    ...(f.section ? { section: f.section } : {}),
    group: 'props' as const,
  }));
  props.sort((a, b) => Number(b.required) - Number(a.required));
  const byId = new Map(data.records.map(x => [x.id, x]));
  const links: LoreLink[] = data.edges.flatMap(e => {
    const out = e.from === r.id;
    if (!out && e.to !== r.id) return [];
    const other = byId.get(out ? e.to : e.from);
    return [{ rel: e.type, dir: out ? 'out' as const : 'in' as const, id: out ? e.to : e.from, type: other?.kind ?? 'ref', title: other?.title ?? (out ? e.to : e.from), status: other?.status ?? '' }];
  });
  const tabs: LoreTab[] = (kind?.tabs ?? []).map(t => {
    const rel = TAB_REL[t.key];
    return { key: t.key, label: t.title, zone: 'record' as const, ...(rel ? { ...rel, count: links.filter(l => l.rel === rel.rel && l.dir === rel.dir).length } : {}) };
  });
  const errors = data.meta.errors ?? [];
  const tasksErr = errors.find(e => e.block === 'tasks');
  const taskLinks = links.filter(l => l.rel === 'HAS_TASK' && l.dir === 'out');
  const facts = load.facts
    ? { tasks: tasksErr ? { error: tasksErr.reason } : { done: taskLinks.filter(l => l.status === 'done').length, total: taskLinks.length }, due: (r.fields.planned_end_date as string | null) ?? null }
    : null;
  const values: Record<string, unknown> = { title: r.title, body_md: r.body_md ?? null, ...r.fields };
  return {
    contract: 'lore.record/1',
    record: { type, id: r.id, title: r.title, status: r.status, version: null, updated_at: r.updated_at ?? null, updated_by: null },
    schema: {
      type, label: kind?.title ?? type, icon: kind?.icon ?? 'help',
      fields: [
        { key: 'title', label: appT(lang, 'pp.field.title'), kind: 'text', required: true, editable: true, group: 'head' },
        ...(bodyDefs.length
          ? bodyDefs.map(f => ({ key: f.key, label: f.title, kind: 'md' as const, required: false, editable: true, group: 'body' as const }))
          : [{ key: 'body_md', label: appT(lang, 'pp.field.body'), kind: 'md' as const, required: false, editable: true, group: 'body' as const }]),
        ...props,
      ],
      tabs,
      relations: (kind?.relations ?? []).map(d => ({ ...d, count: links.filter(l => l.rel === d.rel && l.dir === d.dir).length })),
    },
    values: JSON.parse(JSON.stringify(values)) as Record<string, unknown>,
    links,
    facts,
    perms: permsOf(type, lang),
    meta: {
      loaded_at: loadedAt,
      facade: 'client-emulated',
      sources: [{ block: 'record', state: 'ok' }, ...errors.map(e => ({ block: e.block, state: 'error' as const, reason: e.reason }))],
    },
  };
}

/** Объект контракта → входы kit. Kit не знает полей типа — всё отсюда. */
export function fromLoreRecord(c: LoreRecord1, lang: KitLang): PassportLoad {
  const { type, id } = c.record;
  const { title, body_md, ...fields } = c.values;
  const record: KitRecord = {
    id, kind: type, title: typeof title === 'string' && title ? title : id, status: c.record.status,
    body_md: typeof body_md === 'string' && body_md ? body_md : undefined, updated_at: c.record.updated_at ?? undefined, fields,
  };
  const edges: KitEdge[] = c.links.map(l => (l.dir === 'out' ? { from: id, to: l.id, type: l.rel } : { from: l.id, to: id, type: l.rel }));
  const others: KitRecord[] = c.links.filter((l, i, a) => a.findIndex(x => x.id === l.id) === i)
    .map(l => ({ id: l.id, kind: l.type, title: l.title, status: l.status, fields: {} }));
  const errors = c.meta.sources.filter(s => s.state !== 'ok').map(s => ({ block: s.block, reason: s.reason ?? s.state }));
  const props = c.schema.fields.filter(f => f.group === 'props');
  const sections = c.schema.fields.filter(f => f.group === 'body' && f.key !== 'body_md');
  // Разделы текста — блоками с подписью, как в v1 (ADR: Контекст / Решение / Следствия); пустые не рисуем.
  const overview = sections.length
    ? (r: KitRecord, ctx: KitCtx) => createElement('div', { className: 'sk-rec-sections' }, ...sections
      .filter(s => typeof r.fields[s.key] === 'string' && (r.fields[s.key] as string).trim())
      .map(s => createElement('section', { key: s.key, className: 'sk-rec-fields__sec', 'aria-label': s.label },
        createElement('h2', { className: 'sk-rec-fields__sechead' }, s.label), ctx.md(r.fields[s.key] as string))))
    : undefined;
  const tabs = c.schema.tabs.filter(t => t.zone === 'record' && t.rel).map(t => ({
    key: t.key, title: t.label,
    render: () => c.links.filter(l => l.rel === t.rel && l.dir === t.dir).map(l => l.title).join(' · ') || appT(lang, 'pp.contract.noLinks'),
  }));
  const config0: KitConfig = baseConfig(lang, {
    [type]: { title: c.schema.label, icon: c.schema.icon, ...(overview ? { overview } : {}), relations: c.schema.relations.map(({ count: _n, ...d }) => d), fields: props.map(f => ({ key: f.key, title: f.label, type: f.kind, ...(f.section ? { section: f.section } : {}) })), ...(tabs.length ? { tabs } : {}) },
  });
  const config: KitConfig = { ...config0, roles: { reader: { canEdit: c.perms.can_edit, canStatus: c.perms.can_status } } };
  const data: KitData = { records: [record, ...others], edges, journal: [], meta: { generated_at: c.meta.loaded_at, ...(errors.length ? { errors } : {}) } };
  return { record, data, config, ...(c.facts?.tasks ? { facts: SPRINT_FACTS } : {}) };
}
