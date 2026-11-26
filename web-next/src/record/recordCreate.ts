// Создание записи в v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
//
// Слово владелицы 08.11: «форма „новая“ открывает ту же форму, что и кнопка
// „читать целиком“». Отсюда устройство:
//   - «+ Новая» открывает ТОТ ЖЕ док записи (RecordDock), в том же месте
//     (справа / снизу / во весь экран — личная настройка passport_place);
//   - в доке — черновик: только поля, без которых запись не завести, плюс тела;
//   - после первого сохранения в том же доке открывается полная запись
//     (ListPassport — то, что открывает «Читать целиком»), и дальше правка идёт
//     уже там, теми же редакторами полей.
//
// Поля — инвентаризация форм v1 (заметка задачи 08.11): спринт —
// LoreSprintEditor (ID и название обязательны; статус, приоритет, «Контекст»,
// «Итог»), ADR — LoreAdrEditor (ID и название; статус, дата, Context / Decision
// / Consequences), задача — строка вех v1 (спринт и название; код задачи
// здесь вводится явно — сервер требует task_id). Связи (компоненты, проекты,
// теги) в черновик не входят: в полной записи они правятся своим путём
// привязки, который требует существующей записи.
//
// Честность записи, три ловушки сервера:
//   1. `POST /lore/adr` — UPSERT: на существующий код он ПЕРЕПИШЕТ чужой ADR.
//      Поэтому до записи код проверяется чтением паспорта (404 — свободен);
//      «не смогли проверить» — отказ, а не запись вслепую.
//   2. `POST /lore/sprint/create` на существующий код отвечает `created: false`
//      — это «уже есть», а не успех.
//   3. Право создать — `perms.can_create` паспорта `_new` (LoreRecordPerms).
//      Нет права — кнопки нет, а не 403 после заполнения.
import type { FieldEditorDef } from '@seidr/kit';
import type { KitLang } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { recordPath } from '../api/liveRecord';
import { loreFetch } from '../auth/session';
import { fetchSlice } from '../api/loreClient';
import { planStatusOf } from '../sprints/taskStatus';
import { saveRelation } from './relationSave';

// S4-24 (14.11): решения и спеки — та же форма; кнопка появится, когда сервер отдаст паспорт `_new` с can_create.
// Организация (решение владелицы 19.11.2026): код и название; заводит только super-admin — кнопку решает can_create.
// AP-PASSPORT-EDIT, волна 1 (решения владельца 25.11.2026: 1б, 2б, 3а, 4а): продуктовый слой — боль, выгода, работа,
// роль продукта, фича. Код предлагается из названия (suggestCode), занятость — до записи (checkCodeFree), запись —
// строгим mode=create. Кнопку по-прежнему решает can_create сервера.
export const CREATE_TYPES = ['sprint', 'adr', 'task', 'decision', 'spec', 'organization',
  'pain', 'gain', 'job', 'actor', 'feature'] as const;
export type CreateType = (typeof CREATE_TYPES)[number];

export const isCreateType = (t: string | undefined | null): t is CreateType =>
  !!t && (CREATE_TYPES as readonly string[]).includes(t);

/** Код черновика в адресе (`?open=_new`) — тот же, что у сервера (LoreRecordResource.NEW_ID). */
export const NEW_RECORD_ID = '_new';

export type CreateValues = Record<string, unknown>;

interface FieldSpec {
  key: string;
  label: AppKey;
  kind: 'text' | 'enum' | 'date' | 'md';
  required?: boolean;
}

const SPECS: Record<CreateType, FieldSpec[]> = {
  sprint: [
    { key: 'id', label: 'create.field.sprintId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'status', label: 'create.field.status', kind: 'enum' },
    { key: 'priority', label: 'create.field.priority', kind: 'text' },
    { key: 'context_md', label: 'create.field.context', kind: 'md' },
    { key: 'outcome_md', label: 'create.field.outcome', kind: 'md' },
  ],
  adr: [
    { key: 'id', label: 'create.field.adrId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'status', label: 'create.field.status', kind: 'enum' },
    { key: 'date', label: 'create.field.date', kind: 'date' },
    { key: 'context_md', label: 'create.field.context', kind: 'md' },
    { key: 'decision_md', label: 'create.field.decision', kind: 'md' },
    { key: 'consequences_md', label: 'create.field.consequences', kind: 'md' },
  ],
  task: [
    // Спринт — ребро PART_OF, а не текст (слово владелицы 11.11: «где значения
    // задаются рёбрами — dropdown, а не корректировка текста»). Варианты — срез
    // спринтов; не прочитался — выбора нет, и это сказано, а не поле ввода.
    { key: 'sprint_id', label: 'create.field.sprint', kind: 'enum', required: true },
    { key: 'id', label: 'create.field.taskId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'note_md', label: 'create.field.note', kind: 'md' },
  ],
  // Решение и спека — по блоку create модели (model-config, S4-24): ключи полей те же, что у сервера.
  // Проект и ADR — рёбра, выбор из списка; обязательность — require_one_of ниже, а не у поля.
  decision: [
    { key: 'id', label: 'create.field.decisionId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'projects', label: 'create.field.project', kind: 'enum' },
    { key: 'adr', label: 'create.field.adr', kind: 'enum' },
  ],
  spec: [
    { key: 'id', label: 'create.field.specId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'projects', label: 'create.field.project', kind: 'enum' },
    { key: 'summary', label: 'create.field.summary', kind: 'text' },
    // Без body в блоке create: поле несёт after_write — привязка BELONGS_TO после записи (#1344).
    { key: 'component', label: 'create.field.component', kind: 'enum' },
  ],
  // Организация — блок create модели: код → org_id, название → name. Связи — в паспорте после создания.
  organization: [
    { key: 'id', label: 'create.field.orgId', kind: 'text', required: true },
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
  ],
  // AP-PASSPORT-EDIT, волна 1: название первым — из него предлагается код (2б); свойства — в паспорте после записи.
  pain: [
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'id', label: 'create.field.code', kind: 'text', required: true },
    { key: 'body_md', label: 'create.field.body', kind: 'md' },
  ],
  gain: [
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'id', label: 'create.field.code', kind: 'text', required: true },
    { key: 'body_md', label: 'create.field.body', kind: 'md' },
    { key: 'metric_md', label: 'create.field.metric', kind: 'md' },
  ],
  job: [
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'id', label: 'create.field.code', kind: 'text', required: true },
    { key: 'body_md', label: 'create.field.body', kind: 'md' },
  ],
  actor: [
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'id', label: 'create.field.code', kind: 'text', required: true },
    { key: 'body_md', label: 'create.field.body', kind: 'md' },
  ],
  feature: [
    { key: 'title', label: 'create.field.title', kind: 'text', required: true },
    { key: 'id', label: 'create.field.code', kind: 'text', required: true },
    { key: 'body_md', label: 'create.field.body', kind: 'md' },
    { key: 'context_md', label: 'create.field.context', kind: 'md' },
  ],
};

/**
 * Продуктовый слой (волна 1): путь записи, поле кода и поле названия в теле — те же, что в блоке create модели
 * (`shared/model/lore-model.json`). Роль продукта — KnowProjectActor (путь project-actor, название — `name`).
 */
const PRODUCT_WRITE: Partial<Record<CreateType, { url: string; id: string; title: string }>> = {
  pain: { url: '/lore/pain', id: 'pain_id', title: 'title' },
  gain: { url: '/lore/gain', id: 'gain_id', title: 'title' },
  job: { url: '/lore/job', id: 'job_id', title: 'title' },
  actor: { url: '/lore/project-actor', id: 'actor_id', title: 'name' },
  feature: { url: '/lore/feature', id: 'feature_id', title: 'title' },
};

/** Префикс кода типа (2б, прототип v2gap-create-types): проектную часть человек допишет сам, если нужна. */
export const CODE_PREFIX: Partial<Record<CreateType, string>> = {
  pain: 'PAIN-', gain: 'GAIN-', job: 'JOB-', actor: 'ACT-', feature: 'FEAT-',
};

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Длина кода — с запасом под предел сервера (SAFE_ID: 100 знаков). */
const CODE_MAX = 64;

/**
 * Код из названия (2б): транслит кириллицы, латиница и цифры, слова через дефис, верхний регистр,
 * префикс типа. Пустое название — пустой код (человек вводит сам). Тип без префикса — без подсказки.
 */
export function suggestCode(type: CreateType, title: string): string {
  const prefix = CODE_PREFIX[type];
  if (!prefix) return '';
  const latin = [...title.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join('');
  const words = latin.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return '';
  let code = prefix + words.replace(/ /g, '-').toUpperCase();
  if (code.length > CODE_MAX) code = code.slice(0, CODE_MAX).replace(/-+$/, '');
  return code;
}

/** Код, который сервер примет (SAFE_ID): латиница, цифры, точка, подчёркивание, дефис, слэш. */
const SAFE_CODE = /^[A-Za-z0-9_./-]{1,100}$/;

/**
 * Свободен ли код — ДО записи (2б): пути продуктового слоя — UPSERT и перезаписали бы существующую запись.
 * Чтение паспорта: 404 — свободен, 200 — занят, иное — «не смогли проверить» (`ok: null`, это НЕ «свободен»).
 */
export async function checkCodeFree(type: CreateType, id: string, opts: { fetchImpl?: typeof fetch; lang: KitLang }): Promise<{ ok: boolean | null; message: string }> {
  const t = (k: AppKey, vars?: Record<string, string | number>) => appT(opts.lang, k, vars);
  const code = id.trim();
  if (!SAFE_CODE.test(code)) return { ok: false, message: t('create.code.bad') };
  const http = opts.fetchImpl ?? loreFetch;
  try {
    const probe = await http(`/lore/record/${type}/${recordPath(code)}`);
    if (probe.ok) return { ok: false, message: t('create.code.taken', { id: code }) };
    if (probe.status === 404) return { ok: true, message: t('create.code.free') };
    return { ok: null, message: t('create.code.unchecked', { reason: await reasonOf(probe) }) };
  } catch (e) {
    return { ok: null, message: t('create.code.unchecked', { reason: e instanceof Error ? e.message : String(e) }) };
  }
}

/** require_one_of блока create: хотя бы одно из полей заполнено (у решения — проект ИЛИ ADR-родитель). */
const ONE_OF: Partial<Record<CreateType, readonly string[]>> = {
  decision: ['projects', 'adr'],
  spec: ['projects'],
};

/** Варианты статуса — цикл ТИПА из модели (S4-STATUS-AXIS-CONFIG); нет — поле статуса не рисуется. */
export interface StatusOption { value: string; label: string }

export interface CreateFieldOptions {
  /** Цикл статусов типа из модели. */
  status?: readonly StatusOption[];
  /** Спринты, в которые можно завести задачу (срез sprints без закрытых). Пусто/нет — выбирать не из чего. */
  sprints?: readonly StatusOption[];
  /** ADR, к которым можно привязать новое решение (срез adrs). Нет — поле только для чтения. */
  adrs?: readonly StatusOption[];
  /** Проекты (срез git_projects): новое решение или спека кладутся в проект. Нет — поле только для чтения. */
  projects?: readonly StatusOption[];
  /** Компоненты (срез components) — компонент новой спеки. Нет — поле только для чтения. */
  components?: readonly StatusOption[];
}

/**
 * Поля черновика типа для FieldEditor. Статус без вариантов не показывается:
 * ставит умолчание сервер. Поле-ребро (спринт задачи) без вариантов — только
 * чтение: свободный текст на месте ребра молча завёл бы запись «в никуда».
 */
export function createFields(type: CreateType, lang: KitLang, opts: CreateFieldOptions = {}): FieldEditorDef[] {
  const status = opts.status ?? [];
  const sprints = opts.sprints ?? [];
  const adrs = opts.adrs ?? [];
  const projects = opts.projects ?? [];
  const components = opts.components ?? [];
  return SPECS[type]
    .filter(f => f.key !== 'status' || status.length > 0)
    .map(f => ({
      key: f.key,
      label: appT(lang, f.label),
      kind: f.kind,
      editable: f.key === 'sprint_id' ? sprints.length > 0 : f.key === 'adr' ? adrs.length > 0 : f.key === 'projects' ? projects.length > 0 : f.key === 'component' ? components.length > 0 : true,
      ...(f.required ? { required: 'block' as const } : {}),
      ...(f.key === 'status' ? { options: status } : {}),
      ...(f.key === 'sprint_id' ? { options: sprints } : {}),
      ...(f.key === 'adr' ? { options: adrs } : {}),
      ...(f.key === 'projects' ? { options: projects } : {}),
      ...(f.key === 'component' ? { options: components } : {}),
    }));
}

/**
 * Спринты для выбора у новой задачи — срез `sprints`.
 *
 * Закрытые (готово / отменено) не предлагаются: сервер отказывает в задаче для
 * закрытого спринта (MT-SPRINT-DONE-GUARD), и вариант, который откажет, хуже его
 * отсутствия. Не прочитался срез — пусто и причина; обрезан — варианты и оговорка.
 */
export async function fetchSprintOptions(fetchImpl?: typeof fetch): Promise<{ options: StatusOption[]; note?: string }> {
  try {
    const body = await fetchSlice<Record<string, unknown>>('sprints', { limit: '1000' }, fetchImpl ? { fetchImpl } : {});
    const options = body.rows
      .filter(r => typeof r.sprint_id === 'string' && r.sprint_id)
      .filter(r => !['done', 'cancelled'].includes(planStatusOf(typeof r.status_raw === 'string' ? r.status_raw : null)))
      .map(r => {
        const id = String(r.sprint_id);
        const name = typeof r.name === 'string' && r.name ? r.name : '';
        return { value: id, label: name ? `${id} · ${name}` : id };
      });
    const cut = body.truncated === true || body.truncated === 'unknown';
    return cut ? { options, note: 'cut' } : { options };
  } catch (e) {
    return { options: [], note: e instanceof Error ? e.message : String(e) };
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

/** Обязательные поля, которые пусты, — ключами, в порядке формы. */
export function missingRequired(type: CreateType, values: CreateValues): string[] {
  const own = SPECS[type].filter(f => f.required && !text(values[f.key])).map(f => f.key);
  // require_one_of: ни одного из полей — называем все, из которых можно выбрать.
  const oneOf = ONE_OF[type];
  const none = oneOf && !oneOf.some(k => text(values[k])) ? [...oneOf] : [];
  return [...own, ...none];
}

/** Код записи, под которым она откроется после создания (у задачи — «спринт/код»). */
export function createdId(type: CreateType, values: CreateValues): string {
  return type === 'task' ? `${text(values.sprint_id)}/${text(values.id)}` : text(values.id);
}

const opt = (v: unknown): string | undefined => (text(v) ? text(v) : undefined);

/** Адрес и тело записи — по путям, которыми пишет v1 (src/api/lore.ts). */
export function createRequest(type: CreateType, values: CreateValues): { url: string; body: Record<string, unknown> } {
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  switch (type) {
    case 'sprint':
      return {
        url: '/lore/sprint/create',
        body: strip({
          sprint_id: text(values.id), name: text(values.title), status: opt(values.status),
          priority: opt(values.priority), context_md: opt(values.context_md), outcome_md: opt(values.outcome_md),
        }),
      };
    case 'adr':
      return {
        url: '/lore/adr?mode=create',
        body: strip({
          adr_id: text(values.id), name: text(values.title), status: opt(values.status),
          created_at: opt(values.date), context_md: opt(values.context_md),
          decision_md: opt(values.decision_md), consequences_md: opt(values.consequences_md),
        }),
      };
    case 'task':
      return {
        url: '/lore/task',
        body: strip({
          sprint_id: text(values.sprint_id), task_id: text(values.id), title: text(values.title),
          note_md: opt(values.note_md) ?? null,
          // MDL-11: статус при создании обязателен; форма без поля статуса создаёт «запланирована» явно.
          status: opt(values.status) ?? 'planned',
        }),
      };
    // Имена тела — из блока create: title→title, projects→project, adr→adr_id, summary→summary.
    case 'decision':
      return { url: '/lore/decision?mode=create', body: strip({ decision_id: text(values.id), title: text(values.title), project: opt(values.projects), adr_id: opt(values.adr) }) };
    case 'spec':
      return { url: '/lore/spec?mode=create', body: strip({ spec_id: text(values.id), title: text(values.title), project: opt(values.projects), summary: opt(values.summary) }) };
    case 'organization':
      return { url: '/lore/organization', body: { org_id: text(values.id), name: text(values.title) } };
    // Продуктовый слой: строгий mode=create — на занятый код сервер отвечает 409 ID_TAKEN, а не перезаписывает.
    case 'pain': case 'gain': case 'job': case 'actor': case 'feature': {
      const w = PRODUCT_WRITE[type]!;
      return {
        url: `${w.url}?mode=create`,
        body: strip({
          [w.id]: text(values.id), [w.title]: text(values.title),
          body_md: opt(values.body_md), metric_md: opt(values.metric_md), context_md: opt(values.context_md),
        }),
      };
    }
  }
}

/** Связь, которую ставить после создания (1б: «+ боль» во вкладке фичи или роли) — со стороны записи-источника. */
export interface CreateLink { type: string; id: string; rel: string; dir: 'out' | 'in' }

/**
 * 1б: где во вкладках паспорта есть «+ боль / + выгода / + работа» — «тип источника · ребро · направление» → тип
 * новой записи. Фича: вкладка «Ценность» (ADDRESSES / PROMISES / HELPS_WITH); роль: «Профиль клиента»
 * (FELT_BY / DESIRED_BY / PERFORMED_BY, со стороны роли — входящие). Маршруты /relation есть на сервере для обоих концов.
 */
const LINKED_CREATE: Record<string, CreateType> = {
  'feature|ADDRESSES|out': 'pain', 'feature|PROMISES|out': 'gain', 'feature|HELPS_WITH|out': 'job',
  'actor|FELT_BY|in': 'pain', 'actor|DESIRED_BY|in': 'gain', 'actor|PERFORMED_BY|in': 'job',
};

/** Тип записи, которую можно завести прямо из вкладки связи; null — у этой связи «+ …» нет. */
export function linkedCreateOf(type: string, rel: string, dir: 'out' | 'in'): CreateType | null {
  return LINKED_CREATE[`${type}|${rel}|${dir}`] ?? null;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; kind: 'exists' | 'forbidden' | 'refused' | 'unchecked' | 'network' }
  /** Запись заведена, привязка after_write отказала: запись есть, связи нет — сказать громко. */
  | { ok: false; reason: string; kind: 'linkFailed'; id: string };

async function reasonOf(res: Response): Promise<string> {
  let detail = '';
  try {
    const b = await res.json() as Record<string, unknown>;
    detail = [b.reason, b.message, b.detail, b.error].map(v => (typeof v === 'string' ? v : '')).find(Boolean) ?? '';
  } catch { /* тело не JSON — хватит кода */ }
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

/**
 * Завести запись.
 *
 * Порядок: обязательные → проверка, что кода ещё нет → запись. Любая
 * неудача возвращается словами (`reason`), набранное остаётся в форме у
 * вызывающего: тихий откат съел бы работу человека.
 */
export async function saveCreate(type: CreateType, values: CreateValues, opts: { fetchImpl?: typeof fetch; lang: KitLang; link?: CreateLink }): Promise<CreateResult> {
  const http = opts.fetchImpl ?? loreFetch;
  const t = (k: AppKey, vars?: Record<string, string | number>) => appT(opts.lang, k, vars);
  const missing = missingRequired(type, values);
  if (missing.length) {
    // require_one_of (проект ИЛИ ADR): назвать, из чего выбрать, а не «заполните обязательные».
    const oneOf = ONE_OF[type] ?? [];
    const onlyOneOf = missing.length > 0 && missing.every(k => oneOf.includes(k));
    if (onlyOneOf) {
      const labels = SPECS[type].filter(f => oneOf.includes(f.key)).map(f => t(f.label)).join(', ');
      return { ok: false, kind: 'refused', reason: t('create.err.oneOf', { fields: labels }) };
    }
    return { ok: false, kind: 'refused', reason: t('create.err.required') };
  }
  const id = createdId(type, values);
  try {
    const probe = await http(`/lore/record/${type}/${recordPath(id)}`);
    if (probe.ok) return { ok: false, kind: 'exists', reason: t('create.err.exists', { id }) };
    if (probe.status !== 404) {
      return { ok: false, kind: 'unchecked', reason: t('create.err.unchecked', { reason: await reasonOf(probe) }) };
    }
    const { url, body } = createRequest(type, values);
    const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 403) return { ok: false, kind: 'forbidden', reason: t('create.err.forbidden', { reason: await reasonOf(res) }) };
    // Строгий режим (mode=create): код заняли между пробой и записью — «уже есть», а не «сервер не принял».
    if (res.status === 409) return { ok: false, kind: 'exists', reason: t('create.err.exists', { id }) };
    if (!res.ok) return { ok: false, kind: 'refused', reason: t('create.err.refused', { reason: await reasonOf(res) }) };
    let out: Record<string, unknown> = {};
    try { out = await res.json() as Record<string, unknown>; } catch { /* ответ без тела — успех по коду */ }
    if (out.ok === false) return { ok: false, kind: 'refused', reason: t('create.err.refused', { reason: String(out.reason ?? out.message ?? 'ok:false') }) };
    if (type === 'sprint' && out.created === false) return { ok: false, kind: 'exists', reason: t('create.err.exists', { id }) };
    // after_write блока create: компонент спеки — ребро BELONGS_TO, путь записи из модели.
    const component = type === 'spec' ? text(values.component) : '';
    if (component) {
      try {
        await saveRelation({ type, id, rel: 'BELONGS_TO', dir: 'out', target: component, action: 'add' }, http);
      } catch (e) {
        return { ok: false, kind: 'linkFailed', id, reason: t('create.err.linkFailed', { id, reason: e instanceof Error ? e.message : String(e) }) };
      }
    }
    // 1б: «+ боль» из вкладки фичи или роли — связь со стороны источника тем же путём /relation, что у привязки.
    if (opts.link) {
      const l = opts.link;
      try {
        await saveRelation({ type: l.type, id: l.id, rel: l.rel, dir: l.dir, target: id, action: 'add' }, http);
      } catch (e) {
        return { ok: false, kind: 'linkFailed', id, reason: t('create.err.linkedFailed', { id, to: l.id, reason: e instanceof Error ? e.message : String(e) }) };
      }
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, kind: 'network', reason: t('create.err.network', { reason: e instanceof Error ? e.message : String(e) }) };
  }
}

/** Проекты для нового решения или спеки — срез git_projects (ключ — slug). Не прочитался — пусто и причина. */
export async function fetchProjectOptions(fetchImpl?: typeof fetch): Promise<{ options: StatusOption[]; note?: string }> {
  try {
    const body = await fetchSlice<Record<string, unknown>>('git_projects', { fields: 'slug,name', limit: '1000' }, fetchImpl ? { fetchImpl } : {});
    const options = body.rows
      .filter(r => typeof r.slug === 'string' && r.slug)
      .map(r => ({ value: String(r.slug), label: typeof r.name === 'string' && r.name ? `${r.name} · ${String(r.slug)}` : String(r.slug) }));
    return { options };
  } catch (e) {
    return { options: [], note: e instanceof Error ? e.message : String(e) };
  }
}

/** Компоненты для новой спеки — срез components. Не прочитался — пусто и причина. */
export async function fetchComponentOptions(fetchImpl?: typeof fetch): Promise<{ options: StatusOption[]; note?: string }> {
  try {
    const body = await fetchSlice<Record<string, unknown>>('components', { limit: '1000' }, fetchImpl ? { fetchImpl } : {});
    const options = body.rows
      .filter(r => typeof r.component_id === 'string' && r.component_id)
      .map(r => {
        const id = String(r.component_id);
        const name = typeof r.name === 'string' && r.name ? r.name : '';
        return { value: id, label: name ? `${id} · ${name}` : id };
      });
    return { options };
  } catch (e) {
    return { options: [], note: e instanceof Error ? e.message : String(e) };
  }
}

/** ADR для выбора у нового решения — срез `adrs`. Не прочитался — пусто и причина. */
export async function fetchAdrOptions(fetchImpl?: typeof fetch): Promise<{ options: StatusOption[]; note?: string }> {
  try {
    const body = await fetchSlice<Record<string, unknown>>('adrs', {}, fetchImpl ? { fetchImpl } : {});
    const options = body.rows
      .filter(r => typeof r.adr_id === 'string' && r.adr_id)
      .map(r => {
        const id = String(r.adr_id);
        const name = typeof r.name === 'string' && r.name ? r.name : '';
        return { value: id, label: name ? `${id} · ${name}` : id };
      });
    return { options };
  } catch (e) {
    return { options: [], note: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Можно ли создавать запись этого типа — `perms.can_create` паспорта `_new`.
 *
 * Не смогли спросить — `false` с причиной: кнопка, которая откажет после
 * заполнения формы, хуже её отсутствия.
 */
export async function fetchCanCreate(type: CreateType, fetchImpl?: typeof fetch): Promise<{ can: boolean; reason?: string }> {
  const http = fetchImpl ?? loreFetch;
  try {
    const res = await http(`/lore/record/${type}/${NEW_RECORD_ID}`);
    if (!res.ok) return { can: false, reason: await reasonOf(res) };
    const b = await res.json() as { perms?: { can_create?: unknown; reason?: unknown } };
    const can = b.perms?.can_create === true;
    return can ? { can } : { can, reason: typeof b.perms?.reason === 'string' ? b.perms.reason : undefined };
  } catch (e) {
    return { can: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
