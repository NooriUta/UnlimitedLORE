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

/** Почему тело ADR пока не правится — та же строка уходит в perms.reason. */
export const ADR_BODY_READONLY = 'ADR: текст собран из трёх разделов (контекст, решение, следствия) — правка по разделам будет отдельно';

type Ref = { id: string; title: string };

function payload(type: PassportType, rec: Ref, field: string, to: unknown): { path: string; body: Record<string, unknown> } {
  if (field !== 'body_md') throw new Error(`поле «${field}» пока не правится в паспорте`);
  const text = typeof to === 'string' ? to : '';
  if (type === 'sprint') return { path: '/lore/sprint/update', body: { sprint_id: rec.id, context_md: text } };
  if (type === 'task') return { path: '/lore/task/edit', body: { task_uid: rec.id, title: rec.title, note_md: text } };
  if (type === 'spec') return { path: '/lore/spec', body: { spec_id: rec.id, title: rec.title, content_md: text } };
  throw new Error(ADR_BODY_READONLY);
}

/** Сохранить поле записи. Ошибка сервера — LoreHttpError со статусом (kit покажет «HTTP 403 · …»). */
export async function savePassportField(type: PassportType, rec: Ref, field: string, to: unknown, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  const { path, body } = payload(type, rec, field, to);
  const res = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let code = ''; let detail = '';
    try { const b = (await res.json()) as { error?: string; detail?: string }; code = b.error ?? ''; detail = b.detail ?? ''; } catch { /* тело не разобрали — остаётся статус */ }
    throw new LoreHttpError(res.status, code || res.statusText || 'HTTP', detail);
  }
}
