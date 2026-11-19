// Экран «Модель» админки v2 — данные (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
// Прототип: docs/prototypes/mc-06-model-screen.html (c20f9530).
//
// Двери сервера (MC-05, SPEC-LORE-MODEL-CONFIG-STORE §4–§5), своих экран не заводит:
//   • GET  /lore/model/config            — действующая версия: hash, источник, расхождение с файлом, тело;
//   • GET  /lore/model/config/{uid}      — тело версии (дифф и откат);
//   • PUT  /lore/model/config            — правка: dry_run → 200/422 MODEL_INCONSISTENT; запись — с reason
//                                          и expected_hash (чужая версия → 409); правит только человек-админ;
//   • срез model_config_history          — история версий (SCD2);
//   • GET  /lore/model                   — types.<тип>.fields[].property/property_type и unclassified:
//                                          свойство схемы (только чтение) и гигиена. Нет раздела types —
//                                          схема не прочиталась, и это «не смогли проверить», а не «чисто».
//
// Правка идёт по ВСЕЙ модели (JSON целиком): дифф считается по документу, а не по нарисованному, —
// иначе откат к старой версии показал бы видимое, а поменял бы всё.
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { getJson, type FetchOptions } from './actions';

export type ModelDoc = Record<string, unknown>;
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

// ── Чтение ───────────────────────────────────────────────────────────

export interface ModelConfig {
  hash: string | null;
  /** lore — модель из LORE; file — сервер работает по файлу репозитория (сбой чтения). */
  source: string | null;
  /** Действующая модель расходится с файлом репозитория (DRIFTED). */
  seedDrift: boolean;
  warning: string | null;
  doc: ModelDoc;
}

export function parseConfig(raw: unknown): ModelConfig {
  const b = obj(raw);
  const content = typeof b.content === 'string' ? b.content : null;
  if (content === null) throw new Error('malformed answer: content');
  return {
    hash: str(b.hash), source: str(b.source), seedDrift: b.seed_drift === true, warning: str(b.warning),
    doc: JSON.parse(content) as ModelDoc,
  };
}

export async function fetchModelConfig(opts: FetchOptions = {}): Promise<ModelConfig> {
  return parseConfig(await getJson('/lore/model/config', opts));
}

export async function fetchModelVersion(stateUid: string, opts: FetchOptions = {}): Promise<string> {
  const b = obj(await getJson(`/lore/model/config/${encodeURIComponent(stateUid)}`, opts));
  if (typeof b.content !== 'string') throw new Error('malformed answer: content');
  return b.content;
}

export interface ModelVersion {
  state_uid: string;
  valid_from: string | null;
  valid_to: string | null;
  content_hash: string | null;
  reason: string | null;
  changed_by: string | null;
}

export async function fetchModelHistory(opts: FetchOptions = {}): Promise<ModelVersion[]> {
  const b = await fetchSlice<unknown>('model_config_history', {}, opts);
  return b.rows.map(obj).filter(r => typeof r.state_uid === 'string').map(r => ({
    state_uid: r.state_uid as string, valid_from: str(r.valid_from), valid_to: str(r.valid_to),
    content_hash: str(r.content_hash), reason: str(r.reason), changed_by: str(r.changed_by),
  }));
}

export interface SchemaField { property: string | null; propertyType: string | null; source: string | null }
export interface SchemaInfo {
  /** null — схема не прочиталась; причина — в reason. */
  types: Record<string, { fields: Record<string, SchemaField>; unclassified: string[] }> | null;
  reason: string | null;
}

export function parseSchema(raw: unknown): SchemaInfo {
  const b = obj(raw);
  if (!b.types || typeof b.types !== 'object') {
    const missing = arr(b.missing).filter(x => typeof x === 'string');
    return { types: null, reason: missing.length ? `missing: ${missing.join(', ')}` : 'types' };
  }
  const types: NonNullable<SchemaInfo['types']> = {};
  for (const [t, v] of Object.entries(obj(b.types))) {
    const fields: Record<string, SchemaField> = {};
    for (const f of arr(obj(v).fields).map(obj))
      if (typeof f.key === 'string') fields[f.key] = { property: str(f.property), propertyType: str(f.property_type), source: str(f.source) };
    types[t] = { fields, unclassified: arr(obj(v).unclassified).filter((x): x is string => typeof x === 'string') };
  }
  return { types, reason: null };
}

export async function fetchModelSchema(opts: FetchOptions = {}): Promise<SchemaInfo> {
  return parseSchema(await getJson('/lore/model', opts));
}

// ── Запись ───────────────────────────────────────────────────────────

export interface SaveRequest { content: string; dry_run: boolean; reason?: string; expected_hash?: string }

export type SaveAnswer =
  | { kind: 'ok'; dryRun: boolean; hash: string | null; changed: boolean; typesChanged: string[] }
  | { kind: 'inconsistent'; problems: string[] }
  | { kind: 'conflict'; currentHash: string | null };

/** PUT /lore/model/config. 422 и 409 — ответы по существу; остальное (403, 400, 5xx) — ошибка. */
export async function saveModel(req: SaveRequest, fetchImpl: typeof fetch = loreFetch): Promise<SaveAnswer> {
  const res = await fetchImpl('/lore/model/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(req),
  });
  let b: Obj | null = null;
  try { b = obj(await res.json()); } catch { b = null; }
  if (b === null) throw new LoreHttpError(res.status, 'NON_JSON', res.statusText);
  if (res.status === 422) return { kind: 'inconsistent', problems: arr(b.problems).map(String) };
  if (res.status === 409) return { kind: 'conflict', currentHash: str(b.current_hash) };
  if (!res.ok) {
    const detail = str(b.detail) ?? arr(b.problems).map(String).join('; ');
    throw new LoreHttpError(res.status, String(b.error ?? ''), detail);
  }
  return {
    kind: 'ok', dryRun: b.dry_run === true, hash: str(b.hash), changed: b.changed === true,
    typesChanged: arr(b.types_changed).map(String),
  };
}

/**
 * Откат = новая версия с содержимым старой (история не переписывается). Тот же PUT: сначала
 * dry_run (старая версия может не сойтись с нынешней схемой → 422), запись — только с причиной.
 */
export function rollbackRequest(content: string, expectedHash: string | null, v: { when: string; why: string }, dryRun: boolean): SaveRequest {
  const why = v.why.trim();
  if (!dryRun && !why) throw new Error('откат без причины не записывается: «что и зачем» обязательно');
  const req: SaveRequest = { content, expected_hash: expectedHash ?? undefined, dry_run: dryRun, reason: `откат к версии ${v.when}${why ? `: ${why}` : ''}` };
  if (req.expected_hash === undefined) delete req.expected_hash;
  return req;
}

// ── Дифф ─────────────────────────────────────────────────────────────

export interface ModelChange { path: string; from: string; to: string }

const ID_KEYS = ['type', 'key', 'id', 'section'] as const;

/** Ключ личности элемента массива — у типов type, у полей key, у групп меню id, у пунктов section. */
function identityKey(items: unknown[]): string | null {
  if (items.length === 0 || !items.every(i => i && typeof i === 'object' && !Array.isArray(i))) return null;
  for (const k of ID_KEYS) {
    const ids = items.map(i => (i as Obj)[k]);
    if (ids.every(x => typeof x === 'string') && new Set(ids).size === ids.length) return k;
  }
  return null;
}

const show = (v: unknown): string => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function diffInto(out: ModelChange[], path: string, a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const k = identityKey(a.length ? a : b);
    if (k && (a.length === 0 || identityKey(a) === k) && (b.length === 0 || identityKey(b) === k)) {
      const idA = a.map(i => String((i as Obj)[k]));
      const idB = b.map(i => String((i as Obj)[k]));
      const common = idA.filter(id => idB.includes(id));
      const orderB = idB.filter(id => idA.includes(id));
      if (common.join('\u0000') !== orderB.join('\u0000')) out.push({ path: `${path}[order]`, from: idA.join(', '), to: idB.join(', ') });
      for (const id of idA) {
        const j = idB.indexOf(id);
        diffInto(out, `${path}[${id}]`, a[idA.indexOf(id)], j >= 0 ? b[j] : undefined);
      }
      for (const id of idB) if (!idA.includes(id)) diffInto(out, `${path}[${id}]`, undefined, b[idB.indexOf(id)]);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, from: show(a), to: show(b) });
    return;
  }
  const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = [...Object.keys(a as Obj), ...Object.keys(b as Obj).filter(x => !(x in (a as Obj)))];
    for (const key of keys) diffInto(out, path ? `${path}.${key}` : key, (a as Obj)[key], (b as Obj)[key]);
    return;
  }
  if (a === undefined && b === undefined) return;
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, from: show(a), to: show(b) });
}

/** Что изменится: строка на каждое изменённое значение; перестановка в массиве — строкой порядка. */
export function modelDiff(before: unknown, after: unknown): ModelChange[] {
  const out: ModelChange[] = [];
  diffInto(out, '', before, after);
  return out;
}

// ── Правки (без мутации исходника: «Сбросить» возвращает к нему) ──────

const TYPE_LISTS = ['types', 'child_only'] as const;

function withType(doc: ModelDoc, type: string, edit: (t: Obj) => void): ModelDoc {
  const next = structuredClone(doc);
  for (const list of TYPE_LISTS) {
    const t = arr(next[list]).map(obj).find(x => x.type === type);
    if (t) { edit(t); return next; }
  }
  return next;
}

export type EditableFieldProp = 'label' | 'group';

export function setFieldProp(doc: ModelDoc, type: string, key: string, prop: EditableFieldProp, value: string): ModelDoc {
  return withType(doc, type, t => {
    const f = arr(t.fields).map(obj).find(x => x.key === key);
    if (f) f[prop] = value;
  });
}

export function moveField(doc: ModelDoc, type: string, key: string, delta: number): ModelDoc {
  return withType(doc, type, t => {
    const fields = arr(t.fields);
    const i = fields.findIndex(x => obj(x).key === key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const [f] = fields.splice(i, 1);
    fields.splice(j, 0, f);
  });
}

export type Audience = 'everywhere' | 'admin';

export function setAudience(doc: ModelDoc, section: string, level: Audience): ModelDoc {
  const next = structuredClone(doc);
  next.audience = { ...obj(next.audience), [section]: level };
  return next;
}

// ── Списки для экрана ────────────────────────────────────────────────

export interface ModelType { type: string; label: string; icon: string | null; fields: Obj[]; childOnly: boolean }

export function modelTypes(doc: ModelDoc): ModelType[] {
  return TYPE_LISTS.flatMap(list => arr(doc[list]).map(obj).filter(t => typeof t.type === 'string').map(t => ({
    type: t.type as string, label: str(t.label) ?? (t.type as string), icon: str(t.icon),
    fields: arr(t.fields).map(obj), childOnly: list === 'child_only',
  })));
}

export interface TypeGroup { group: string | null; labelKey: string | null; types: string[] }

/** Типы по группам меню (nav); тип, которого в меню нет, — в группе «прочее» (group: null). */
export function typeList(doc: ModelDoc): TypeGroup[] {
  const all = modelTypes(doc).map(t => t.type);
  const seen = new Set<string>();
  const out: TypeGroup[] = [];
  for (const g of arr(doc.nav).map(obj)) {
    const types = arr(g.items).map(obj).map(i => String(i.section ?? '')).filter(s => all.includes(s) && !seen.has(s));
    types.forEach(s => seen.add(s));
    if (types.length) out.push({ group: str(g.id), labelKey: str(g.labelKey), types });
  }
  const rest = all.filter(s => !seen.has(s));
  if (rest.length) out.push({ group: null, labelKey: null, types: rest });
  return out;
}

export interface NavRow { group: string; labelKey: string | null; section: string; audience: Audience | null }

export function navRows(doc: ModelDoc): NavRow[] {
  const aud = obj(doc.audience);
  return arr(doc.nav).map(obj).flatMap(g => arr(g.items).map(obj).map(i => {
    const section = String(i.section ?? '');
    const a = aud[section];
    return { group: String(g.id ?? ''), labelKey: str(g.labelKey), section, audience: a === 'admin' || a === 'everywhere' ? a : null };
  }));
}

// ── Гигиена ──────────────────────────────────────────────────────────

export type HygieneKind = 'unverified' | 'undeclared' | 'unclassified' | 'badGroup' | 'emptyNav' | 'drifted' | 'fileFallback';
export interface HygieneRow { kind: HygieneKind; where: string; detail?: string; type?: string }

export const FIELD_GROUPS = ['head', 'props', 'body'] as const;

/**
 * Замечания модели — долг, а не ошибки. Схема не прочиталась — строка «не смогли проверить» с причиной,
 * а правила, которым она нужна, не выдаются за «чисто».
 */
export function modelHygiene(doc: ModelDoc, schema: SchemaInfo, cfg: { seedDrift: boolean; warning: string | null }): HygieneRow[] {
  const out: HygieneRow[] = [];
  if (cfg.warning) out.push({ kind: 'fileFallback', where: 'config', detail: cfg.warning });
  if (cfg.seedDrift) out.push({ kind: 'drifted', where: 'config' });
  if (schema.types === null) out.push({ kind: 'unverified', where: 'schema', detail: schema.reason ?? undefined });
  for (const t of modelTypes(doc)) {
    const s = schema.types?.[t.type];
    for (const f of t.fields) {
      const key = String(f.key ?? '');
      if (typeof f.group === 'string' && !(FIELD_GROUPS as readonly string[]).includes(f.group))
        out.push({ kind: 'badGroup', where: `${t.type}.${key}`, detail: f.group, type: t.type });
      const sf = s?.fields[key];
      // Правимое поле без свойства схемы: пишется, но тип не проверяется. Связи (ref) живут рёбрами.
      if (sf && sf.property === null && sf.source !== 'EDGE' && f.kind !== 'ref' && f.editable === true)
        out.push({ kind: 'undeclared', where: `${t.type}.${key}`, type: t.type });
    }
    for (const p of s?.unclassified ?? []) out.push({ kind: 'unclassified', where: `${t.type}.${p}`, type: t.type });
  }
  for (const g of arr(doc.nav).map(obj))
    if (arr(g.items).length === 0) out.push({ kind: 'emptyNav', where: `nav.${String(g.id ?? '')}` });
  return out;
}
