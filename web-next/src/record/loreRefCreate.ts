// Заведение записи прямо из текста — карточка «Новый» мини-окна ссылок
// (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050).
//
// Какие поля просить, решает МОДЕЛЬ LORE (`/lore/model` → types.<тип>.fields,
// MD-REQUIRED), а не список в коде. Правила — слова владелицы 11.11.2026:
//   • «если зависимость — можно и без неё, а если это родитель — родитель должен
//     быть»: обязательна связь-композиция «к родителю» (у задачи — спринт,
//     PART_OF … composition); attribute / realization / association — нет;
//   • «автор — кто пишет, не надо лишнего поля, это правило»: автор не поле, а
//     вошедший человек;
//   • «исполнителя выбирает или кнопка себя по умолчанию».
// Код записи вводит человек: сервер его не выдаёт (task_id, adr_id, spec_id,
// decision_id обязательны в теле создания).
import { loadModel, type KitLang, type KitRecord } from '@seidr/kit';
import type { RefCreateResult, RefCreateSpec, RefFieldDef } from '@seidr/kit/content';
import { loreFetch } from '../auth/session';

/** Поле типа в модели — форма LoreRecordRegistry.fieldJson (+ required_level из MD-REQUIRED). */
export interface ModelField {
  key: string;
  label: string;
  kind: string;
  group?: string;
  required?: boolean;
  required_level?: 'block' | 'warn' | null;
  ref?: { type: string; rel: string; dir: 'in' | 'out' };
  relation?: string;
  multi?: boolean;
}
export interface ModelType { type: string; label?: string; fields: ModelField[] }

/** Типы, у которых есть серверная точка заведения. Остальные из текста не заводятся. */
export const CREATABLE = ['task', 'spec', 'adr', 'decision'] as const;
type Creatable = (typeof CREATABLE)[number];

/** Кто пишет и что рядом: родители из контекста записи (тип родителя → его код). */
export interface CreateCtx { me: string | null; parents: Record<string, string> }

/** Поля, которые карточка не просит: автор — правило, статус и принимающий — потом в паспорте. */
const NEVER = new Set(['author', 'reviewer', 'status', 'code', 'title']);

const T = {
  ru: {
    code: 'Код', model: 'Модель LORE не загрузилась — какие поля нужны, неизвестно; заведите запись в её паспорте',
    type: 'Этот тип из текста пока не заводится — только выбрать существующий', login: 'Не выполнен вход — без автора запись не заводится',
  },
  en: {
    code: 'Code', model: 'The LORE model did not load — which fields are needed is unknown; create the record in its passport',
    type: 'This type cannot be created from text yet — pick an existing one', login: 'Not signed in — a record cannot be created without its author',
  },
} as const;

const isParent = (f: ModelField) => f.kind === 'ref' && f.relation === 'composition' && f.ref?.dir === 'out' && !f.multi;

/** Поля карточки «Новый» для типа — из модели и правил владелицы. */
export function createSpecFor(type: string, model: ModelType | undefined, ctx: CreateCtx, lang: KitLang): RefCreateSpec {
  const t = T[lang === 'en' ? 'en' : 'ru'];
  if (!(CREATABLE as readonly string[]).includes(type)) return { denied: t.type };
  if (!model) return { denied: t.model };
  if (!ctx.me) return { denied: t.login };
  const title = model.fields.find(f => f.key === 'title');
  const out: RefFieldDef[] = [
    { key: 'title', label: title?.label ?? 'Название', required: 'block' },
    { key: 'code', label: model.fields.find(f => f.key === 'code')?.label ?? t.code, required: 'block' },
  ];
  for (const f of model.fields) {
    if (NEVER.has(f.key)) continue;
    if (isParent(f)) {
      // Родитель обязателен; из контекста — подставлен, иначе пусто и обязательно.
      const v = ctx.parents[f.ref!.type];
      out.push({ key: f.key, label: f.label, required: 'block', ...(v ? { value: v } : {}) });
      continue;
    }
    if (f.key === 'executor') {
      out.push({ key: 'executor', label: f.label, required: 'block', value: ctx.me, self: ctx.me });
      continue;
    }
    if (f.kind === 'ref') {
      // Зависимость не обязательна («можно и без неё»). Если она уже есть в контексте —
      // например, решение пишут внутри ADR, — подставляем как необязательную; иначе — потом, в паспорте.
      const v = !f.multi && f.ref ? ctx.parents[f.ref.type] : undefined;
      if (v) out.push({ key: f.key, label: f.label, value: v });
      continue;
    }
    if (f.required_level === 'block' || f.required_level === 'warn') out.push({ key: f.key, label: f.label, required: f.required_level });
  }
  return { fields: out };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Тело создания: имена полей сервера (TaskCreateRequest, SpecUpsertRequest, AdrCreateRequest, DecisionCreateRequest). */
function bodyOf(type: Creatable, v: Record<string, string>, me: string): { path: string; body: Record<string, unknown>; id: string } {
  switch (type) {
    case 'task':
      return {
        path: '/lore/task', id: `${v.sprint}/${v.code}`,
        body: { sprint_id: v.sprint, task_id: v.code, title: v.title, author_agent: me, executor_agent: v.executor || me },
      };
    case 'spec': return { path: '/lore/spec', id: v.code, body: { spec_id: v.code, title: v.title } };
    case 'adr': return { path: '/lore/adr', id: v.code, body: { adr_id: v.code, name: v.title } };
    case 'decision': return { path: '/lore/decision', id: v.code, body: { decision_id: v.code, title: v.title, ...(v.adr ? { adr_id: v.adr } : {}) } };
  }
}

/** Завести запись. Отказ сервера — причина словами (окно остаётся открытым), а не «ничего не произошло». */
export async function createLoreRecord(type: string, values: Record<string, string>, ctx: CreateCtx, fetchFn: FetchFn = loreFetch): Promise<RefCreateResult> {
  if (!(CREATABLE as readonly string[]).includes(type) || !ctx.me) return { ok: false, reason: T.ru.type };
  const { path, body, id } = bodyOf(type as Creatable, values, ctx.me);
  let res: Response;
  try {
    res = await fetchFn(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  let b: Record<string, unknown> = {};
  try { b = await res.json() as Record<string, unknown>; } catch { /* тело не JSON */ }
  const reason = [b.reason, b.detail, b.error].find(x => typeof x === 'string' && x) as string | undefined;
  if (!res.ok || b.ok === false) return { ok: false, reason: reason ?? `${res.status}` };
  return { ok: true, item: { id, type, title: values.title } };
}

// ── Модель для карточки: грузится один раз, кешем kit (loadModel) ─────────────
let modelTypes: Record<string, ModelType> | null = null;
let modelState: 'idle' | 'loading' | 'ok' | 'error' = 'idle';

/** Запустить загрузку модели (один раз). Карточка спрашивает синхронно — до ответа честно «загружается». */
export function warmCreateModel(fetchFn: FetchFn = loreFetch): void {
  if (modelState === 'loading' || modelState === 'ok') return;
  modelState = 'loading';
  void loadModel(async signal => {
    const r = await fetchFn('/lore/model', signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`модель не прочитана: сервер ответил ${r.status}`);
    return r.json();
  }).then(res => {
    const types = (res.model as { types?: Record<string, ModelType> } | null)?.types;
    if (res.state !== 'error' && types) { modelTypes = types; modelState = 'ok'; } else modelState = 'error';
  }).catch(() => { modelState = 'error'; });
}

/** Модель типа из кеша; undefined — не загрузилась (или ещё грузится — тогда loading=true). */
export function cachedModelType(type: string): { model?: ModelType; loading: boolean } {
  return { model: modelTypes?.[type], loading: modelState === 'loading' };
}

/** Для тестов: забыть кеш. */
export function resetCreateModel(types: Record<string, ModelType> | null = null): void {
  modelTypes = types; modelState = types ? 'ok' : 'idle';
}

/**
 * Родители из контекста записи, в которой пишут: в спринте и его задаче — этот спринт,
 * в ADR — этот ADR. Тип родителя → его код.
 */
export function parentsOf(record: Pick<KitRecord, 'id' | 'kind' | 'fields'> | null | undefined): Record<string, string> {
  if (!record) return {};
  if (record.kind === 'sprint' || record.kind === 'Sprint') return { sprint: record.id };
  if (record.kind === 'task') { const s = record.fields?.sprint; return typeof s === 'string' && s ? { sprint: s } : {}; }
  if (record.kind === 'adr') return { adr: record.id };
  return {};
}
