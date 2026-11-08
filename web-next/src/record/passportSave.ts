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

function payload(type: PassportType, rec: Ref, field: string, to: unknown): { path: string; body: Record<string, unknown> } {
  if (type === 'adr' && (ADR_SECTIONS as readonly string[]).includes(field)) {
    // Имя обязательно: сервер перезаписывает запись, и без него ADR остался
    // бы безымянным. Лучше не сохранить, чем сохранить безымянным.
    const name = rec.title.trim();
    if (!name) throw new Error('у ADR не заполнено имя — без него правка раздела не отправляется');
    return { path: '/lore/adr', body: { adr_id: rec.id, name, [field]: typeof to === 'string' ? to : '' } };
  }
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
