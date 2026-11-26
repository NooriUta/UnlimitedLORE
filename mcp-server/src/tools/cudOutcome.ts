// SPRINT_LORE_EXT_ISSUES_W2/ISS-06-LINK-FALSE-SUCCESS (issue #6), решение
// D-2026-LORE-MCP-LINK-NOOP-IS-ERROR при ADR-LORE-043. Слова владельца 25.11.2026:
// «скорректируй adr043» · «noop на change» · «однородно возвращать ошибку с объяснением на noop
// если запрос был на cud без r».
//
// Бэкенд по ADR-LORE-043 отвечает ok:true + outcome — ok там значит «вызов не упал». Агент-LLM
// читает ok как «сработало». Поэтому в MCP-слое ЛЮБОЙ CUD-инструмент (создание, правка, удаление,
// связь, статус), чей ответ говорит «ничего не изменилось», отдаётся как isError:true. Первая строка —
// объяснение (reason бэкенда + что сделать), JSON ответа сохраняется целиком.
// Однородно, без исключений: outcome=noop (не сделано) и outcome=unchanged (уже такое значение /
// связь уже есть / снимать нечего) — оба ошибка, разницу несёт объяснение. Чтение не затрагивается.
// HTTP-контракт бэкенда не меняется (UI, miniLORE его не замечают).
//
// Применяется в ОДНОМ месте — обёртке регистрации withStrictTools (strictTool.ts) по пометке
// инструмента в TOOL_KIND (toolKinds.ts). Сторож — linkNoop.test.ts.

type ToolResult = { isError?: boolean; content?: { type: string; text?: string }[] };

/** Хвост описания каждого CUD-инструмента (добавляет strictTool.ts). */
export const NOOP_NOTE =
  'If nothing changed (backend outcome=noop: target missing / refused; or outcome=unchanged: already that value, ' +
  'already linked, nothing to remove) the call is returned as an ERROR (isError) with the explanation first and the ' +
  'backend JSON kept below — ok:true in that JSON only means "the call did not crash" (ADR-LORE-043).';

/** Инструмент связи: *_link и entity_link. */
export function isLinkTool(name: string): boolean {
  return /^[a-z0-9_]+_link$/.test(name);
}

function noopHint(body: Record<string, unknown>): string {
  const cands = body.project_candidates;
  if (Array.isArray(cands) && cands.length) {
    return `Ближайшие зарегистрированные проекты: ${cands.join(', ')} — повторите вызов с одним из них.`;
  }
  if (typeof body.hint === 'string' && body.hint.trim()) return body.hint;
  const aboutProject = ['project', 'git_project', 'projects', 'slug'].some((k) => k in body)
    || /проект|project/i.test(String(body.reason ?? ''));
  return aboutProject
    ? 'Зарегистрируйте проект через project_new (список: query_slice slice="git_projects") и повторите вызов.'
    : 'Проверьте, что указанные сущности существуют и значения верны, и повторите вызов.';
}

/** Объяснение для ответа «ничего не изменилось»; null — изменение было, ошибки нет. */
function explain(body: Record<string, unknown>): string | null {
  if (body.outcome === 'noop') {
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason : 'запрос не выполнен, бэкенд причину не назвал';
    return `НЕ СДЕЛАНО (outcome=noop): ${reason}\n${noopHint(body)}`;
  }
  if (body.outcome === 'unchanged') {
    const hint = typeof body.hint === 'string' && body.hint.trim() ? ` ${body.hint}.` : '';
    return `ИЗМЕНЕНИЙ НЕТ (outcome=unchanged): уже такое значение.${hint} Повторять вызов не нужно; если ждали изменения — проверьте аргументы.`;
  }
  return null;
}

/** Ответ CUD-инструмента: outcome noop/unchanged → isError:true с объяснением первой строкой. Иначе — как есть. */
export function noopAsError<T>(result: T): T {
  const r = result as unknown as ToolResult;
  if (!r || typeof r !== 'object' || r.isError || !Array.isArray(r.content) || r.content.length !== 1) return result;
  const c = r.content[0];
  if (c.type !== 'text' || typeof c.text !== 'string') return result;
  let body: unknown;
  try { body = JSON.parse(c.text); } catch { return result; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result;
  const head = explain(body as Record<string, unknown>);
  if (!head) return result;
  return { ...r, isError: true, content: [{ type: 'text', text: `${head}\n\n${c.text}` }] } as unknown as T;
}
