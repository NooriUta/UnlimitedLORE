// Привязать / отвязать связь записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST).
//
// Путь существующий: `POST /lore/record/{type}/{id}/relation` с телом
// `{rel, dir, target, action}` (форма снята с `RelationRequest` сервера). Он
// сам разводит запрос по старым обработчикам привязки, поэтому новых серверных
// ручек тут не нужно.
//
// Весь смысл этого файла — в отказах. У пути их три разных, и каждый говорит
// человеку РАЗНОЕ:
//   • 403 «admin role required» (у пути стоит requireAdmin) — надо просить
//     роль, перебирать коды бессмысленно;
//   • 400 UNKNOWN_RELATION — у типа нет пути для этой связи, и сервер
//     присылает `allowed`; этот список превращает тупик в действие;
//   • 400 BAD_PARAMS — своя причина текстом.
//
// Сообщение уходит в текст исключения, потому что управление связями в kit
// печатает причину отказа рядом с собой (`sk-rel__failed`). До этого отказ
// проглатывался, и неудачная привязка выглядела как успех.
import { loreFetch } from '../auth/session';

export interface RelationChange {
  type: string;
  id: string;
  rel: string;
  dir: 'out' | 'in';
  target: string;
  action: 'add' | 'remove';
}

/** Отказ пути привязки: текст уже пригоден для показа человеку. */
export class RelationRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'RelationRefused';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Сообщение по ответу сервера. Ни один отказ не превращается в «не получилось». */
function refusalText(status: number, body: Record<string, unknown>): string {
  const code = str(body.error);
  const detail = str(body.detail) || str(body.message);
  if (status === 403 || code === 'FORBIDDEN')
    // Сервер пишет «admin role required» по-английски; человеку нужно по-русски
    // и с действием: не «нельзя», а «нужна роль».
    return 'нужна роль администратора — попросите доступ';
  if (code === 'UNKNOWN_RELATION') {
    const allowed = Array.isArray(body.allowed) ? body.allowed.map(String) : [];
    const tail = allowed.length ? ` Управлять можно: ${allowed.join(', ')}.` : '';
    return `${detail || 'у этого типа нет пути привязки для такой связи'}.${tail}`;
  }
  if (detail) return detail;
  return `сервер ответил ${status}${code ? ` (${code})` : ''}`;
}

/**
 * Привязка или отвязка. Удача — ничего не возвращает; отказ — исключение с
 * текстом, пригодным для показа.
 *
 * Код записи в адрес не кодируется: сервер принимает `{id: .+}`, и у задачи
 * код — «спринт/код».
 */
export async function saveRelation(c: RelationChange, fetchImpl?: typeof fetch): Promise<void> {
  const http = fetchImpl ?? loreFetch;
  const res = await http(`/lore/record/${c.type}/${c.id}/relation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rel: c.rel, dir: c.dir, target: c.target, action: c.action }),
  });
  if (res.ok) return;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // Ответ не json (прокси с html-страницей) — код всё равно назовём.
    body = {};
  }
  throw new RelationRefused(res.status, str(body.error), refusalText(res.status, body));
}
