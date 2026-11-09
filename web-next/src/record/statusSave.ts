// Смена статуса записи из v2 (аудит 09.11, находка D-04 · S4-STATUS-AXIS-CONFIG).
//
// До этого статус из v2 сменить было нельзя по двум причинам, и первая уже
// снята: эмуляция паспорта зашивала `can_status: false`, поэтому чип никогда не
// был кнопкой; переход на боевой фасад (#963) отдал настоящие права. Вторая —
// здесь: **пути записи статуса в клиенте не было вовсе.** `savePassportField`
// умеет текст записи и разделы ADR, а на поле `status` честно отказывал. То
// есть чип стал нажимаемым, а сохранять было нечем.
//
// Контракт сверен с серверной сессией 09.11 (она его и писала):
//
//   POST /lore/status {entity_type: sprint|task|phase|adr, id, status, expected}
//
// `expected` — это «было» (S2-09). Шлём ровно то, что показано человеку: если
// статус успели изменить, сервер ответит 409 с текущим значением, и человек
// увидит, что произошло, вместо того чтобы молча переписать чужую правку.
//
// Отказы переведены в то, что человеку делать. «Не получилось» заставило бы
// перебирать статусы, хотя причина одна и не в статусе.
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';

/** Типы, у которых сервер принимает смену статуса (LoreStatusResource). */
export type StatusEntity = 'sprint' | 'task' | 'phase' | 'adr';

export interface StatusChange {
  type: StatusEntity;
  id: string;
  /** Куда переводим. */
  to: string;
  /** Что было показано человеку; `null` — неизвестно, тогда проверки версии не будет. */
  was: string | null;
}

/**
 * Отказ смены статуса: текст уже пригоден для показа.
 *
 * Отдельный тип, потому что эти отказы требуют от человека РАЗНОГО: при 403 —
 * просить роль, при 409 — перечитать запись. `current` заполнено только у 409.
 */
export class StatusRefused extends LoreHttpError {
  constructor(status: number, code: string, message: string, readonly current: string | null = null) {
    super(status, code, message);
    this.name = 'StatusRefused';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Сообщение по ответу сервера. Ни один отказ не превращается в «не получилось». */
function refusalText(status: number, code: string, detail: string, current: string | null): string {
  if (code === 'AGENT_SCOPE_FORBIDDEN')
    return 'агенту не разрешена смена статуса: его профиль вне семейства «status»';
  if (status === 403)
    return 'нужна роль администратора — смена статуса доступна admin или superadmin';
  if (status === 409)
    return current
      ? `статус успели изменить: сейчас «${current}» — перечитайте запись и повторите`
      : 'статус успели изменить — перечитайте запись и повторите';
  return detail || `сервер ответил ${status}${code ? ` (${code})` : ''}`;
}

/**
 * Сменить статус записи. Удача — ничего не возвращает; отказ — исключение с
 * текстом, пригодным для показа.
 *
 * Код записи в адрес не кодируется и в теле не искажается: у задачи это
 * «спринт/код», и дробь — часть кода.
 */
export async function saveRecordStatus(c: StatusChange, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  const body: Record<string, unknown> = { entity_type: c.type, id: c.id, status: c.to };
  // Пустое «было» не отправляем: сервер пропустил бы проверку, а мы считали бы
  // себя защищёнными. Нет данных — нет обещания.
  if (c.was) body.expected = c.was;

  const res = await fetchImpl('/lore/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return;

  let parsed: Record<string, unknown> = {};
  try {
    const b = await res.json();
    if (b && typeof b === 'object') parsed = b as Record<string, unknown>;
  } catch {
    // Ответ не json (прокси с html-страницей) — код всё равно назовём.
  }
  const code = str(parsed.error);
  const detail = str(parsed.detail) || str(parsed.message);
  const cur = parsed.current && typeof parsed.current === 'object'
    ? str((parsed.current as Record<string, unknown>).status) || null
    : null;

  if (res.status === 403 || res.status === 409) {
    throw new StatusRefused(res.status, code, refusalText(res.status, code, detail, cur), cur);
  }
  // Пустое тело бывает у прокси: тогда в причине хотя бы код ответа, иначе
  // человек получит безымянное «HTTP».
  throw new LoreHttpError(res.status, code || res.statusText || 'HTTP', detail || `сервер ответил ${res.status}`);
}
