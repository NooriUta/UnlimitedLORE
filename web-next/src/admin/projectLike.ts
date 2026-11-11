// UC-5 «завести проект как у похожего» (SPRINT_UXR_S7B_ADMIN/S7B-18, прототип
// docs/prototypes/s7b-admin-v6.html, раздел UC-5). Здесь — данные и обращения
// к серверу; экран — ProjectLikeWizard.tsx из готовых элементов kit (Steps ·
// DiffPreview · BatchUndo через DangerBatch).
//
// Сервер уже есть, мастер только собирает шаги:
//   • регистрация — POST /lore/project {slug, name, hosts, default_branch}
//     (тот же путь, что MCP project_new; upsert по slug — поэтому уже
//     зарегистрированный проект мастер НЕ шлёт повторно: перезаписал бы его поля);
//   • проверка репозитория — GET /lore/forgejo/ci?git_project&ref: мост Forgejo
//     разрешает slug → owner/repo по hosts[] primary и ветку → SHA. SHA есть —
//     репозиторий и ветка видны. Отдельного «есть ли репозиторий» у сервера нет,
//     и 404 ветки не отличает «нет репо» от «нет ветки» и от «у токена нет доступа» —
//     так и говорим;
//   • люди и роли похожего — срез role_matrix (ячейка несёт состояние проверки);
//   • выдача — POST /lore/user/role/batch: пачка у сервера на ОДНОГО человека,
//     поэтому на N людей — N пачек по очереди, итог — по каждому.
import type { BatchItemFail } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import type { CellState, PersonChanges, RolesData } from './roles';

export const FORGEJO_BASE = 'https://git.seidrstudio.pro';

/** Параметры адреса мастера — сбрасываются при смене мастера. */
export const PROJECT_WIZ_PARAMS = ['adm-pslug', 'adm-pname', 'adm-pbranch', 'adm-prepo', 'adm-psrc'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Тот же набор символов, что у сервера (LoreResourceBase.SAFE_ID). */
const SAFE_ID = /^[A-Za-z0-9_./-]{1,100}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function slugProblem(slug: string): 'empty' | 'chars' | null {
  const s = slug.trim();
  if (s === '') return 'empty';
  return SAFE_ID.test(s) ? null : 'chars';
}

export function repoProblem(repo: string): 'empty' | 'shape' | null {
  const s = repo.trim();
  if (s === '') return 'empty';
  return REPO.test(s) ? null : 'shape';
}

/** hosts[] — primary на Forgejo, в том же виде, что у уже зарегистрированных проектов. */
export function forgejoHosts(repo: string, branch: string) {
  return [{
    remote: 'origin',
    role: 'primary',
    base_url: `${FORGEJO_BASE}/${repo.trim()}`,
    file_url_template: '{base}/src/branch/{branch}/{path}',
    pr_url_template: '{base}/pulls/{n}',
    default_branch: branch,
  }];
}

export interface GitProject {
  slug: string;
  name: string | null;
  /** owner/repo primary-хоста; null — hosts нет. */
  repo: string | null;
}

/** owner/repo из hosts[] primary (JSON-строка) — то же правило, что у ForgejoBridge.primaryRepoPath. */
export function primaryRepoOf(hosts: unknown): string | null {
  try {
    const arr: unknown = typeof hosts === 'string' ? JSON.parse(hosts) : hosts;
    if (!Array.isArray(arr)) return null;
    const p = arr.map(h => (h ?? {}) as Record<string, unknown>).find(h => h.role === 'primary');
    const seg = new URL(String(p?.base_url ?? '')).pathname.replace(/^\/|\/$/g, '').split('/');
    return seg.length >= 2 ? `${seg[seg.length - 2]}/${seg[seg.length - 1]}` : null;
  } catch {
    return null;
  }
}

export async function fetchGitProjects(fetchImpl: typeof fetch = loreFetch): Promise<GitProject[]> {
  const b = await fetchSlice<Record<string, unknown>>('git_projects', { limit: '1000', fields: 'slug,name,hosts' }, { fetchImpl });
  return b.rows.map(r => ({ slug: str(r.slug) ?? '', name: str(r.name), repo: primaryRepoOf(r.hosts) })).filter(p => p.slug !== '');
}

// ── люди похожего проекта ────────────────────────────────────────────────

export interface ProjectPerson { kc_sub: string; name: string; role: string; state: CellState }

export function projectPeople(data: RolesData, project: string): ProjectPerson[] {
  const out: ProjectPerson[] = [];
  for (const p of data.people) {
    const c = p.cells.find(x => x.project === project && x.role);
    if (c) out.push({ kc_sub: p.kc_sub, name: p.name, role: c.role as string, state: c.state });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Пачки «как у похожего» в новый проект — по человеку. Только ПРОВЕРЕННЫЕ роли:
 * копировать то, чего сервер не подтвердил, значит раздать догадку.
 */
export function likeProjectBatches(
  data: RolesData,
  source: string,
  target: string,
  excluded: ReadonlySet<string>,
  override: Readonly<Record<string, string>>,
): PersonChanges[] {
  if (!source || !target || source === target) return [];
  return projectPeople(data, source)
    .filter(p => p.state === 'checked' && !excluded.has(p.kc_sub))
    .map(p => ({ kc_sub: p.kc_sub, changes: [{ project: target, role: override[p.kc_sub] ?? p.role }] }));
}

// ── регистрация ──────────────────────────────────────────────────────────

export interface Registered { outcome: string; rolesGranted: string[]; rolesWarning: string | null }

export async function registerProject(
  req: { slug: string; name: string; repo: string; branch: string },
  fetchImpl: typeof fetch = loreFetch,
): Promise<Registered> {
  const res = await fetchImpl('/lore/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      slug: req.slug.trim(),
      name: req.name.trim() || null,
      hosts: JSON.stringify(forgejoHosts(req.repo, req.branch)),
      default_branch: req.branch,
    }),
  });
  const body = await readBody(res);
  if (!res.ok || body === null) throw httpError(res.status, body);
  const b = body as Record<string, unknown>;
  return {
    outcome: str(b.outcome) ?? '',
    rolesGranted: Array.isArray(b.roles_granted) ? b.roles_granted.map(String) : [],
    rolesWarning: str(b.roles_warning),
  };
}

// ── проверка репозитория ─────────────────────────────────────────────────

export type RepoCheck =
  | { kind: 'found'; sha: string; via: string | null }
  | { kind: 'missing'; reason: string }
  | { kind: 'unresolvable'; reason: string }
  | { kind: 'unchecked'; reason: string };

/** Ответ /lore/forgejo/ci → что мы знаем о репозитории. Неизвестное — «не смогли». */
export function repoCheckOf(status: number, body: unknown): RepoCheck {
  const b = (body ?? {}) as Record<string, unknown>;
  const reason = [str(b.error), str(b.detail)].filter(Boolean).join(': ') || `HTTP ${status}`;
  if (status === 200) {
    const sha = str(b.sha);
    return sha ? { kind: 'found', sha, via: str(b.resolved_via) } : { kind: 'unchecked', reason: 'malformed answer: sha' };
  }
  if (status === 404 && b.error === 'REF_NOT_RESOLVED') return { kind: 'missing', reason };
  if (status === 404 && b.error === 'PROJECT_NOT_RESOLVABLE') return { kind: 'unresolvable', reason };
  return { kind: 'unchecked', reason };
}

export async function checkRepo(slug: string, branch: string, fetchImpl: typeof fetch = loreFetch): Promise<RepoCheck> {
  try {
    const qs = new URLSearchParams({ git_project: slug, ref: branch }).toString();
    const res = await fetchImpl(`/lore/forgejo/ci?${qs}`, { headers: { Accept: 'application/json' } });
    return repoCheckOf(res.status, await readBody(res));
  } catch (e) {
    return { kind: 'unchecked', reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── итог пачек по людям ──────────────────────────────────────────────────

export type BatchOutcome =
  | { kind: 'applied'; applied: number; total: number; failed: BatchItemFail[]; batchId: string }
  | { kind: 'undone'; batchId: string }
  | { kind: 'skipped' };

export interface BatchVerdict { pending: string[]; applied: string[]; partial: string[]; skipped: string[]; undone: string[] }

/** Кто ещё ждёт, кому выдано целиком, кому частично, кого пропустили или откатили. */
export function batchVerdict(order: readonly string[], outcomes: Readonly<Record<string, BatchOutcome>>): BatchVerdict {
  const v: BatchVerdict = { pending: [], applied: [], partial: [], skipped: [], undone: [] };
  for (const id of order) {
    const o = outcomes[id];
    if (!o) v.pending.push(id);
    else if (o.kind === 'skipped') v.skipped.push(id);
    else if (o.kind === 'undone') v.undone.push(id);
    else if (o.failed.length > 0 || o.applied < o.total) v.partial.push(id);
    else v.applied.push(id);
  }
  return v;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

async function readBody(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function httpError(status: number, body: unknown): LoreHttpError {
  const b = (body ?? {}) as Record<string, unknown>;
  return new LoreHttpError(status, String(b.error ?? (body === null ? 'NON_JSON' : '')), String(b.detail ?? ''));
}
