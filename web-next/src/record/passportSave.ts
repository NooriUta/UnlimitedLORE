// Правка на месте в паспорте (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24, ADR-LORE-047 п. 14.1).
// Пока нет фасада записи /lore/record — сохраняем существующими путями записи, теми же, что
// у MCP sprint_set / task_set / spec_set: запись идёт через Java-сервисы, SCD2 и слайсы целы.
// Проверки версии (п. 4) ещё нет — паспорт говорит об этом в perms.reason.
// ADR: тело в паспорте склеено из трёх разделов (контекст / решение / следствия) — правка
// одним полем перезаписала бы разделы; до раздельной правки ADR только читается.
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';
import type { PassportType } from './passportAdapters';

/** Типы, у которых текст записи уже правится на месте. */
export const EDITABLE_BODY: readonly PassportType[] = ['sprint', 'task', 'spec'];

/**
 * Типы, у которых сервер ПРОВЕРЯЕТ версию при записи (S5-08).
 *
 * Сверено по коду: `expected_version` есть у правки спринта, задачи, спеки и —
 * с 09.11, PR #969 — ADR; все через `LoreResourceBase.versionConflict`.
 *
 * Список остаётся явным, а не «все типы»: он существует затем, чтобы экран
 * говорил правду. Утром ADR в нём не было, и это было важно — обещать защиту
 * там, где её нет, хуже, чем честно сказать «проверки пока нет». Появится
 * новый тип без проверки — его сюда не добавят, и ничего не соврётся.
 */
export const VERSION_CHECKED: readonly PassportType[] = ['sprint', 'task', 'spec', 'adr'];

/**
 * Запись изменили, пока её правили (409 VERSION_CONFLICT).
 *
 * Отдельный тип, а не «HTTP 409»: это единственный отказ, после которого
 * человеку надо не повторить попытку, а ПЕРЕЧИТАТЬ запись. Текст правки в
 * ошибку не попадает — он остаётся в поле, и терять его нельзя.
 */
export class VersionConflict extends LoreHttpError {
  constructor(
    readonly currentVersion: string | null,
    readonly updatedBy: string | null,
    detail: string,
  ) {
    super(409, 'VERSION_CONFLICT', detail);
    this.name = 'VersionConflict';
  }
}

/** Сообщение о расхождении: что случилось и что делать. */
function conflictText(updatedBy: string | null, detail: string): string {
  const who = updatedBy ? ` (правил: ${updatedBy})` : '';
  // Серверный detail оставляем в хвосте: он называет версии, и это пригодится
  // при разборе. Но первым идёт то, что человеку делать.
  const tail = detail ? ` · ${detail}` : '';
  return `запись изменили, пока вы её правили${who} — перечитайте её и повторите правку; ваш текст остался в поле${tail}`;
}

/**
 * Почему тело ADR целиком не правится — та же строка уходит в perms.reason.
 *
 * Сами разделы с S4-24 правятся по отдельности (см. ADR_SECTIONS); запрет
 * остаётся только на склеенное тело: одним полем его не сохранить, не
 * затерев разделы.
 */
export const ADR_BODY_READONLY = 'ADR правится по разделам: контекст, решение, следствия — каждый отдельно, склеенное тело не сохраняется';

type Ref = { id: string; title: string };

/**
 * Разделы ADR, которые правятся по отдельности (S4-24).
 *
 * Тремя разделами — требование владелицы, как в v1. Каждый уходит своим
 * полем, соседние не отправляются вовсе: сервер перезаписывает запись
 * целиком, и отправить соседний раздел «как есть» значило бы затереть чужую
 * правку, сделанную между чтением и сохранением.
 */
export const ADR_SECTIONS = ['context_md', 'decision_md', 'consequences_md'] as const;

/**
 * Чем запись называется в теле запроса: ключ и, где сервер требует, имя.
 *
 * Эндпоинты LORE перезаписывают запись целиком, поэтому имя обязательно у тех,
 * кто без него сохранит запись безымянной. Лучше не сохранить, чем сохранить
 * безымянным — поэтому пустое имя тут отказ, а не пустая строка.
 */
function idBody(type: PassportType, rec: Ref): Record<string, unknown> {
  const named = (key: string, nameKey: string) => {
    const name = rec.title.trim();
    if (!name) throw new Error(`у записи не заполнено имя — без него правка раздела не отправляется`);
    return { [key]: rec.id, [nameKey]: name };
  };
  if (type === 'sprint') return { sprint_id: rec.id };
  if (type === 'task') return named('task_uid', 'title');
  if (type === 'spec') return named('spec_id', 'title');
  if (type === 'adr') return named('adr_id', 'name');
  // S5-DOC-PASSPORT: /lore/doc пишет только переданные поля — имя не нужно и не затирается.
  if (type === 'doc') return { doc_id: rec.id };
  return { id: rec.id };
}

function payload(type: PassportType, rec: Ref, field: string, to: unknown): { path: string; body: Record<string, unknown> } {
  if (type === 'adr' && (ADR_SECTIONS as readonly string[]).includes(field)) {
    // Имя обязательно: сервер перезаписывает запись, и без него ADR остался
    // бы безымянным. Лучше не сохранить, чем сохранить безымянным.
    const name = rec.title.trim();
    if (!name) throw new Error('у ADR не заполнено имя — без него правка раздела не отправляется');
    return { path: '/lore/adr', body: { adr_id: rec.id, name, [field]: typeof to === 'string' ? to : '' } };
  }
  // Текст записи приходит либо склеенным телом (`body_md` — эмуляция), либо
  // СВОИМ полем раздела: фасад `/lore/record` отдаёт разделы тела под их
  // настоящими именами (`note_md` у задачи, `context_md` у спринта,
  // `content_md` у спеки). Прежде принималось только `body_md`, и правка
  // раздела падала с «поле не правится» — а снаружи это выглядело как
  // отсутствие правки вовсе (дефект прода v1.17.7, S5-06).
  const BODY_FIELD: Partial<Record<PassportType, string>> = {
    sprint: 'context_md', task: 'note_md', spec: 'content_md',
  };
  const own = BODY_FIELD[type];
  if (field !== 'body_md' && field !== own) {
    throw new Error(`поле «${field}» пока не правится в паспорте`);
  }
  const text = typeof to === 'string' ? to : '';
  if (type === 'sprint') return { path: '/lore/sprint/update', body: { sprint_id: rec.id, context_md: text } };
  if (type === 'task') return { path: '/lore/task/edit', body: { task_uid: rec.id, title: rec.title, note_md: text } };
  if (type === 'spec') return { path: '/lore/spec', body: { spec_id: rec.id, title: rec.title, content_md: text } };
  throw new Error(ADR_BODY_READONLY);
}

/**
 * Сохранить поле записи. Ошибка сервера — `LoreHttpError` со статусом (kit
 * покажет «HTTP 403 · …»); расхождение версий — `VersionConflict`.
 *
 * `expectedVersion` — `record.version` на момент ЧТЕНИЯ записи (S5-08).
 * Отправляется только там, где сервер её проверяет (`VERSION_CHECKED`), и
 * только непустой: сервер пропускает проверку при пустом значении
 * (`versionConflict` возвращает null), и тогда мы считали бы себя
 * защищёнными, не будучи защищёнными.
 */
export async function savePassportField(
  type: PassportType, rec: Ref, field: string, to: unknown,
  fetchImpl: typeof fetch = loreFetch, expectedVersion?: string | null,
  /**
   * Путь записи ИМЕННО ЭТОГО раздела из схемы сервера (`write`).
   *
   * Передан — пишем по нему, и своя таблица «тип → поле» не нужна. Это не
   * украшение: у спринта разделов два («Контекст» и «Итог»), у ADR три, и
   * таблица по одному имени на тип молча не записала бы остальные (замечание
   * серверной сессии 09.11, проверено по `LoreRecordRegistry:532`).
   */
  write?: { endpoint: string; field: string } | null,
): Promise<void> {
  const { path, body } = write
    ? { path: write.endpoint, body: { ...idBody(type, rec), [write.field]: typeof to === 'string' ? to : '' } }
    : payload(type, rec, field, to);
  const checked = (VERSION_CHECKED as readonly string[]).includes(type);
  const version = typeof expectedVersion === 'string' ? expectedVersion.trim() : '';
  const withVersion = checked && version ? { ...body, expected_version: version } : body;
  const res = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(withVersion) });
  if (!res.ok) {
    let code = ''; let detail = ''; let current: { version?: unknown; updated_by?: unknown } = {};
    try {
      const b = (await res.json()) as { error?: string; detail?: string; current?: { version?: unknown; updated_by?: unknown } };
      code = b.error ?? ''; detail = b.detail ?? ''; current = b.current ?? {};
    } catch { /* тело не разобрали — остаётся статус */ }
    if (res.status === 409) {
      const cur = typeof current.version === 'string' && current.version ? current.version : null;
      const who = typeof current.updated_by === 'string' && current.updated_by ? current.updated_by : null;
      throw new VersionConflict(cur, who, conflictText(who, detail));
    }
    throw new LoreHttpError(res.status, code || res.statusText || 'HTTP', detail);
  }
}
