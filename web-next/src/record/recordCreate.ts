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

export const CREATE_TYPES = ['sprint', 'adr', 'task'] as const;
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
};

/** Варианты статуса — цикл ТИПА из модели (S4-STATUS-AXIS-CONFIG); нет — поле статуса не рисуется. */
export interface StatusOption { value: string; label: string }

export interface CreateFieldOptions {
  /** Цикл статусов типа из модели. */
  status?: readonly StatusOption[];
  /** Спринты, в которые можно завести задачу (срез sprints без закрытых). Пусто/нет — выбирать не из чего. */
  sprints?: readonly StatusOption[];
}

/**
 * Поля черновика типа для FieldEditor. Статус без вариантов не показывается:
 * ставит умолчание сервер. Поле-ребро (спринт задачи) без вариантов — только
 * чтение: свободный текст на месте ребра молча завёл бы запись «в никуда».
 */
export function createFields(type: CreateType, lang: KitLang, opts: CreateFieldOptions = {}): FieldEditorDef[] {
  const status = opts.status ?? [];
  const sprints = opts.sprints ?? [];
  return SPECS[type]
    .filter(f => f.key !== 'status' || status.length > 0)
    .map(f => ({
      key: f.key,
      label: appT(lang, f.label),
      kind: f.kind,
      editable: f.key === 'sprint_id' ? sprints.length > 0 : true,
      ...(f.required ? { required: 'block' as const } : {}),
      ...(f.key === 'status' ? { options: status } : {}),
      ...(f.key === 'sprint_id' ? { options: sprints } : {}),
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
  return SPECS[type].filter(f => f.required && !text(values[f.key])).map(f => f.key);
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
        url: '/lore/adr',
        body: strip({
          adr_id: text(values.id), name: text(values.title), status: opt(values.status),
          date_created: opt(values.date), context_md: opt(values.context_md),
          decision_md: opt(values.decision_md), consequences_md: opt(values.consequences_md),
        }),
      };
    case 'task':
      return {
        url: '/lore/task',
        body: strip({
          sprint_id: text(values.sprint_id), task_id: text(values.id), title: text(values.title),
          note_md: opt(values.note_md) ?? null,
        }),
      };
  }
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; kind: 'exists' | 'forbidden' | 'refused' | 'unchecked' | 'network' };

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
export async function saveCreate(type: CreateType, values: CreateValues, opts: { fetchImpl?: typeof fetch; lang: KitLang }): Promise<CreateResult> {
  const http = opts.fetchImpl ?? loreFetch;
  const t = (k: AppKey, vars?: Record<string, string | number>) => appT(opts.lang, k, vars);
  const missing = missingRequired(type, values);
  if (missing.length) return { ok: false, kind: 'refused', reason: t('create.err.required') };
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
    if (!res.ok) return { ok: false, kind: 'refused', reason: t('create.err.refused', { reason: await reasonOf(res) }) };
    let out: Record<string, unknown> = {};
    try { out = await res.json() as Record<string, unknown>; } catch { /* ответ без тела — успех по коду */ }
    if (out.ok === false) return { ok: false, kind: 'refused', reason: t('create.err.refused', { reason: String(out.reason ?? out.message ?? 'ok:false') }) };
    if (type === 'sprint' && out.created === false) return { ok: false, kind: 'exists', reason: t('create.err.exists', { id }) };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, kind: 'network', reason: t('create.err.network', { reason: e instanceof Error ? e.message : String(e) }) };
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
