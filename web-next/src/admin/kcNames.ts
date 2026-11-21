// Пакет 1.18 — имена людей из Keycloak (владелица 21.11.2026: «у людей из KC то ФИО достань, а то только логины»).
//
// Сервер (POST /lore/kc/user-names/sync) читает учётки KC и пишет «Имя Фамилия» тем, у кого имя не задано
// человеком. Здесь — вызов и слова итога. KC недоступен или не настроен — это говорится словами: тихо остаться
// на логинах нельзя, человек решит, что имён в KC просто нет.
import type { KitLang } from '@seidr/kit';
import { appT } from '../i18n';

export interface KcNamesSummary {
  updated: number;
  unchanged?: number;
  manual_kept: number;
  no_name_in_kc: number;
  not_in_kc?: number;
}

export type KcNamesResult =
  | { state: 'done'; summary: KcNamesSummary }
  | { state: 'skipped'; syncedAt: string; last?: KcNamesSummary }
  | { state: 'error'; reason: string };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function summaryOf(b: Record<string, unknown>): KcNamesSummary {
  return {
    updated: num(b.updated), unchanged: num(b.unchanged), manual_kept: num(b.manual_kept),
    no_name_in_kc: num(b.no_name_in_kc), not_in_kc: num(b.not_in_kc),
  };
}

/** Сверка имён. `ifOlderThanHours` — шаг при открытии раздела: свежая сверка не повторяется. */
export async function syncKcNames(http: typeof fetch, opts: { ifOlderThanHours?: number } = {}): Promise<KcNamesResult> {
  const url = '/lore/kc/user-names/sync' + (opts.ifOlderThanHours ? `?if_older_than_hours=${opts.ifOlderThanHours}` : '');
  let r: Response;
  try {
    r = await http(url, { method: 'POST' });
  } catch (e) {
    return { state: 'error', reason: e instanceof Error ? e.message : String(e) };
  }
  let body: Record<string, unknown> = {};
  try { body = (await r.json()) as Record<string, unknown>; } catch { /* тело не JSON — причина ниже по коду */ }
  if (!r.ok) {
    const msg = typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : '';
    return { state: 'error', reason: `${r.status}${msg ? ` ${msg}` : ''}` };
  }
  if (body.skipped === true) {
    const last = body.last && typeof body.last === 'object' ? summaryOf(body.last as Record<string, unknown>) : undefined;
    return { state: 'skipped', syncedAt: String(body.synced_at ?? ''), ...(last ? { last } : {}) };
  }
  return { state: 'done', summary: summaryOf(body) };
}

/** Итог одной строкой для человека. */
export function kcNamesLine(r: KcNamesResult, lang: KitLang): string {
  if (r.state === 'error') return appT(lang, 'admin.kcNames.error', { reason: r.reason });
  const s = r.state === 'done' ? r.summary : r.last;
  const counts = s
    ? appT(lang, 'admin.kcNames.done', { updated: s.updated, noName: s.no_name_in_kc, manual: s.manual_kept })
    : '';
  if (r.state === 'skipped') return appT(lang, 'admin.kcNames.skipped', { at: r.syncedAt.slice(0, 16).replace('T', ' ') }) + (counts ? ` ${counts}` : '');
  return counts;
}
