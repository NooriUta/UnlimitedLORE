// «Правила CLAUDE» в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-06).
//
// Что есть у сервера (по коду backend, 10.11.2026):
//   • срез docs с фильтром kind=claude-rules — список доков правил;
//   • срез doc_by_id — тело дока (content_md_ru / content_md_en);
//   • GET /lore/history?type=doc&id= — цепочка SCD2 версий дока: valid_from,
//     content_hash, автор. Тела версий (KnowDocHist.content_md) эндпоинт НЕ
//     выбирает, а запись дока (doc_new) новых версий не заводит — на проде
//     цепочка у доков обычно пуста.
// Файл правил живёт на машине: браузер и сервер его не видят, дифф «док ↔
// файл» считает только MCP claude_rules_diff и серверу его не присылает.
//
// Поэтому вид диффа выбирается ПО ДАННЫМ, без выдумок на клиенте:
//   • тела у всех версий есть → построчный дифф соседних версий (kit wordDiff
//     + DiffPreview) — включится сам, когда сервер начнёт отдавать content_md;
//   • есть только хеши → версии списком, смена тела видна по content_hash;
//   • версий меньше двух → «сравнивать нечего», словами.
import { wordDiff, type DiffRow } from '@seidr/kit';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { getJson, type FetchOptions } from './actions';

export const RULES_KIND = 'claude-rules';

export interface RuleDoc { doc_id: string; title: string | null }

export interface RuleDocBody {
  doc_id: string;
  title: string | null;
  /** MD-тело (ru, иначе en); null — MD-тела нет. */
  md: string | null;
  /** Есть только HTML-тело — его экран не рисует голым, говорит словами. */
  htmlOnly: boolean;
}

export interface DocVersion {
  state_uid: string;
  valid_from: string | null;
  valid_to: string | null;
  content_hash: string | null;
  /** Тело версии; undefined — сервер его не прислал (сегодня — всегда). */
  content_md?: string;
  author: string | null;
}

export interface DocHistory {
  rows: DocVersion[];
  /** Автор правок не установлен (журнал не прочитался) — причина сервера. */
  attributionProblem: string | null;
  /** Строки есть, но вне проектов смотрящего. */
  outsideScope: boolean;
}

export type DiffViewKind = 'none' | 'hashes' | 'bodies';
export type VersionChange = 'first' | 'same' | 'changed' | 'unknown';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export async function fetchRuleDocs(opts: FetchOptions = {}): Promise<RuleDoc[]> {
  const body = await fetchSlice<Obj>('docs', { kind: RULES_KIND, limit: '1000' }, opts);
  return body.rows
    .map(r => ({ doc_id: String(r.doc_id ?? ''), title: str(r.title) }))
    .filter(d => d.doc_id !== '')
    .sort((a, b) => a.doc_id.localeCompare(b.doc_id));
}

export async function fetchRuleDoc(id: string, opts: FetchOptions = {}): Promise<RuleDocBody> {
  const body = await fetchSlice<Obj>('doc_by_id', { id }, opts);
  const r = body.rows[0];
  if (!r) throw new LoreHttpError(404, 'NOT_FOUND', id);
  const md = str(r.content_md_ru) ?? str(r.content_md_en);
  return { doc_id: String(r.doc_id ?? id), title: str(r.title), md, htmlOnly: md === null && str(r.content_html) !== null };
}

export function parseDocHistory(raw: unknown): DocHistory {
  const b = obj(raw);
  if (!Array.isArray(b.rows)) throw new Error('malformed answer: rows');
  const rows = b.rows.map(obj).map((r, i): DocVersion => {
    const a = obj(r.author);
    const v: DocVersion = {
      state_uid: str(r.state_uid) ?? `v${i + 1}`,
      valid_from: str(r.valid_from),
      valid_to: str(r.valid_to),
      content_hash: str(r.content_hash),
      author: str(a.caller) ?? str(a.kind),
    };
    if (typeof r.content_md === 'string') v.content_md = r.content_md;
    return v;
  });
  const att = obj(b.attribution);
  return {
    rows,
    attributionProblem: att.ok === false ? (str(att.reason) ?? '') : null,
    outsideScope: b.outside_scope !== undefined && b.outside_scope !== null,
  };
}

export async function fetchDocHistory(id: string, opts: FetchOptions = {}): Promise<DocHistory> {
  const qs = new URLSearchParams({ type: 'doc', id }).toString();
  return parseDocHistory(await getJson(`/lore/history?${qs}`, opts));
}

/** Какой дифф можно показать по тому, что прислал сервер. */
export function diffView(rows: readonly DocVersion[]): DiffViewKind {
  if (rows.length < 2) return 'none';
  return rows.every(r => typeof r.content_md === 'string') ? 'bodies' : 'hashes';
}

/** Смена тела относительно предыдущей версии — по content_hash. */
export function versionChange(rows: readonly DocVersion[], i: number): VersionChange {
  if (i === 0) return 'first';
  const a = rows[i - 1].content_hash;
  const b = rows[i].content_hash;
  if (a === null || b === null) return 'unknown';
  return a === b ? 'same' : 'changed';
}

/** Дифф двух тел строками DiffPreview (дифф — kit wordDiff; пробельные «то же» опущены). */
export function versionDiff(from: string, to: string): { rows: DiffRow[]; exact: boolean } {
  const d = wordDiff(from, to);
  const rows = d.chunks
    .filter(c => c.kind !== 'same' || c.text.trim() !== '')
    .map((c, i): DiffRow => ({
      id: `c${i}`,
      kind: c.kind === 'del' ? 'remove' : c.kind,
      text: c.text,
      check: { state: 'checked' },
    }));
  // exact=false — текст длиннее порога kit, дифф грубый: экран говорит об этом словами.
  return { rows, exact: d.exact };
}

export function versionDiffRows(from: string, to: string): DiffRow[] {
  return versionDiff(from, to).rows;
}
