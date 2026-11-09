// Какая версия на экране: сервер, фронт и честное «не проверено»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Просьба владелицы 09.11.2026: «в правое нижний угол запиши версию сервера и
// версию фронта или одну если они вместе».
//
// ЗАЧЕМ ЭТО ВООБЩЕ. По метке судят, доехала ли выкатка. Поэтому одна метка
// показывается ТОЛЬКО когда сервер и фронт собраны из одного коммита: иначе
// «одна версия» — ложь, причём ровно про то, ради чего смотрят. Отсюда формы:
//
//   • коммиты совпали          → `v1.17.7 · 339f15b0`  (или один коммит, если
//                                 тега выпуска нет — препрод, локальная сборка);
//   • коммиты разные           → `сервер v1.17.7 · 339f15b0 · фронт 4a1c22e0`;
//   • фронт не помечен         → `сервер v1.17.7 · 339f15b0` — названа
//                                 серверной, и причина сказана в подсказке;
//   • /lore/version не ответил → `сервер: не проверено` плюс причина.
//
// «Не проверено» — не то же, что «версий нет» и не то же, что «старая версия».
// Поэтому последнее известное значение не кешуется и не показывается: метка
// говорит о том, что видно СЕЙЧАС.
import type { KitLang } from '@seidr/kit';
import { appT } from '../i18n';
import { loreFetch } from '../auth/session';

/**
 * Коммит, из которого собран фронт.
 *
 * Отметку кладёт сборка (`VITE_LORE_BUILD_COMMIT`), как у бэкенда её кладёт
 * Gradle в build-info.properties. Нет отметки — пустая строка, и это
 * ОТДЕЛЬНОЕ состояние: метка тогда называет серверную версию серверной, а не
 * выдаёт её за общую.
 */
export const FRONT_COMMIT: string =
  (((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_LORE_BUILD_COMMIT) ?? '').trim();

export interface ServerVersion {
  /** Тег выпуска выкатки (`v1.17.7`); null — стенд или локальная сборка. */
  release: string | null;
  /** Коммит сборки бэкенда; `unknown` от сервера приводится к пустой строке. */
  commit: string;
  builtAt: string;
  schema: string | null;
}

export type VersionState =
  | { kind: 'loading' }
  | { kind: 'ok'; server: ServerVersion }
  | { kind: 'failed'; reason: string };

export interface FetchVersionOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  signal?: AbortSignal;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** Коммит в виде метки образа — восемь знаков. `unknown` — это не коммит. */
export function shortCommit(raw: string): string {
  const s = raw.trim();
  if (!s || s === 'unknown') return '';
  return s.slice(0, 8);
}

/** GET /lore/version. Три исхода, и каждый различим: ответ · отказ · причина. */
export async function fetchServerVersion(opts: FetchVersionOptions = {}): Promise<VersionState> {
  const http = opts.fetchImpl ?? loreFetch;
  const url = opts.url ?? '/lore/version';
  try {
    const res = await http(url, opts.signal ? { signal: opts.signal } : undefined);
    if (!res.ok) return { kind: 'failed', reason: `HTTP ${res.status}` };
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      return { kind: 'failed', reason: 'ответ не JSON' };
    }
    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return { kind: 'failed', reason: 'ответ не разобран' };
    return {
      kind: 'ok',
      server: {
        // Поля release может не быть вовсе: серверная половина (#1033) доезжает
        // своим выпуском, и метка обязана работать до неё.
        release: str(body.release) || null,
        commit: str(body.commit),
        builtAt: str(body.built_at),
        schema: str(body.schema_version) || null,
      },
    };
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface VersionText {
  /** Что видно в углу; пусто — показывать нечего (ещё грузим). */
  text: string;
  /** Чего в метке не хватает и почему — в подсказке и в копируемом тексте. */
  note: string;
}

/**
 * Текст метки. Чистая функция: одна и та же форма у угла, у подсказки и у
 * того, что кладётся в буфер.
 */
export function versionLabel(lang: KitLang, state: VersionState, front: string): VersionText {
  const t = (k: Parameters<typeof appT>[1], v?: Record<string, string | number>) => appT(lang, k, v);
  const f = shortCommit(front);
  const notes: string[] = [];
  if (!f) notes.push(t('version.note.frontUnstamped'));

  if (state.kind === 'loading') return { text: '', note: '' };

  if (state.kind === 'failed') {
    notes.unshift(t('version.note.serverFailed', { reason: state.reason }));
    const head = `${t('version.server')}: ${t('version.unchecked')}`;
    // Фронт свою отметку знает сам — её видно даже когда сервер молчит. Это не
    // «частично получилось»: это ровно то, что действительно известно.
    return { text: f ? `${head} · ${t('version.front')} ${f}` : head, note: notes.join(' · ') };
  }

  const { release, commit } = state.server;
  const s = shortCommit(commit);
  if (!s) notes.push(t('version.note.serverUnstamped'));

  // Одна метка — только при полном совпадении коммитов. Совпадения нет (или
  // нечего сравнивать) — говорим, что чьё.
  const same = !!s && !!f && s === f;
  if (same) return { text: release ? `${release} · ${s}` : s, note: notes.join(' · ') };

  const parts: string[] = [];
  const serverPart = [release, s].filter(Boolean).join(' · ');
  if (serverPart) parts.push(`${t('version.server')} ${serverPart}`);
  else parts.push(`${t('version.server')}: ${t('version.unstamped')}`);
  if (f) parts.push(`${t('version.front')} ${f}`);
  return { text: parts.join(' · '), note: notes.join(' · ') };
}
