// ── /lore transport layer ──────────────────────────────────────────────────
// Same-origin in dev: the vite proxy forwards /lore to lore-backend (:9100) which
// queries system_aida_lore via named slices (AidaLoreResource). The browser
// never sees ArcadeDB credentials and never sends SQL.
//
// In prod lore.enabled=false → backend returns 404 LORE_DISABLED → LoreDisabledError.

const LORE_BASE = '/lore';

export class LoreDisabledError extends Error {
  constructor() { super('lore feature is disabled (dev-only)'); }
}

export class LoreUpstreamError extends Error {
  constructor(detail?: string) { super(detail ?? 'lore upstream failed'); }
}

export class LoreNotFoundError extends Error {
  constructor(id: string) { super(`lore entity not found: ${id}`); }
}

function assertJson(res: Response): void {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new LoreUpstreamError(`backend returned ${res.status} non-JSON`);
}

async function parseError(res: Response): Promise<never> {
  assertJson(res);
  let code = '';
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    code = body.error ?? '';
    detail = body.detail ?? '';
  } catch { /* fall through */ }
  if (code === 'LORE_DISABLED') throw new LoreDisabledError();
  if (code === 'LORE_UPSTREAM') throw new LoreUpstreamError(detail);
  if (code === 'NOT_FOUND')     throw new LoreNotFoundError(detail);
  throw new Error(`${res.status} ${code || res.statusText}${detail ? `: ${detail}` : ''}`);
}

export async function fetchLoreSlice<T>(
  slice: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const url = new URL(`${LORE_BASE}/slice/${slice}`, location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { signal });
  assertJson(res);
  if (!res.ok) return parseError(res);
  const body = (await res.json()) as { rows?: T[] };
  return body.rows ?? [];
}

// Slice catalog (GET /lore/slices) — the whitelist the MCP `lore_list_slices`
// tool exposes. Used by the MCP API screen to show the live catalog.
export interface LoreSliceDescriptor {
  id: string;
  required: string[];
  optional: string[];
}

export async function fetchLoreSliceCatalog(signal?: AbortSignal): Promise<LoreSliceDescriptor[]> {
  const res = await fetch(`${LORE_BASE}/slices`, { signal });
  assertJson(res);
  if (!res.ok) return parseError(res);
  const body = (await res.json()) as { slices?: LoreSliceDescriptor[] };
  return body.slices ?? [];
}

// ── Analytics dashboard (GET /lore/analytics) ──────────────────────────────
export interface LoreAnalyticsComponent {
  component_id: string;
  full_name: string | null;
  area: string | null;
  sprint_count: number;
  task_total: number;
  task_done: number;
}
export interface LoreAnalyticsSprint {
  sprint_id: string;
  status_raw: string | null;
  task_total: number;
  task_done: number;
}
export interface LoreAnalytics {
  totals: { sprints: number; tasks: number; tasks_done: number; releases: number; components: number };
  tasks_by_status: Record<string, number>;
  sprints_by_status: Record<string, number>;
  by_component: LoreAnalyticsComponent[];
  by_sprint: LoreAnalyticsSprint[];
  releases_by_project: Record<string, number>;
  current_releases: string[];
}

export async function fetchLoreAnalytics(signal?: AbortSignal): Promise<LoreAnalytics> {
  const res = await fetch(`${LORE_BASE}/analytics`, { signal });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return (await res.json()) as LoreAnalytics;
}

// ── Typed slice helpers ────────────────────────────────────────────────────

export interface LoreTimelineItem {
  date: string;
  kind: 'adr' | 'decision' | 'release' | 'sprint';
  ref_id: string;
  title: string;
  status: string;
}

export interface LoreAdrRow {
  adr_id: string;
  name: string | null;
  status: string | null;
  date_created: string | null;
  component: string | null;
}

export interface LoreAdrPassport {
  adr_id: string;
  name: string | null;
  status: string | null;
  file_path: string | null;
  date_created: string | null;
  components: string[] | null;
  context_md: string | null;
  decision_md: string | null;
  consequences_md: string | null;
  sprint_id: string | null;
  depends_on_ids: string[] | null;
  implemented_in_ids: string[] | null;
  release_ids: string[] | null;
  supersedes_ids: string[] | null;
  tags: string[] | null;
}

export interface LoreSprintDep {
  from_sprint: string;
  to_sprint: string;
  kind: string | null;   // 'hard' | 'soft' | null
  reason: string | null;
}

export interface AdrWritePayload {
  adr_id: string;
  name: string;
  status?: string;
  date_created?: string;
  context_md?: string;
  decision_md?: string;
  consequences_md?: string;
  depends_on_ids?: string[];
  supersedes_ids?: string[];
  component_ids?: string[];
  tags?: string[];
}

export async function createLoreAdr(payload: AdrWritePayload): Promise<{ ok: boolean; adr_id: string; hist_created: boolean }> {
  const res = await fetch(`${LORE_BASE}/adr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify(payload),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; adr_id: string; hist_created: boolean }>;
}

export interface LoreDecisionRow {
  decision_id: string;
  title: string;
  date_created: string | null;
  status_raw: string | null;
}

export interface LoreDecisionPassport {
  decision_id: string;
  title: string;
  date_created: string | null;
  body_md: string | null;
  rationale_md: string | null;
  refs_raw: string | null;
  adr_refs: string[] | null;
  sprint_refs: string[] | null;
  pr_refs: string[] | null;
  release_refs: string[] | null;
  supersedes_ids: string[] | null;
}

export interface LoreSprintRow {
  sprint_id: string;
  name: string;
  status_raw: string | null;
  priority: string | null;
  valid_from: string | null;
  release_ids: string[] | null;
  release_dates: string[] | null;
  done_date: string | null;
  git_projects: string[] | null;
  components: string[] | null;
  track_id: string | null;
  context_md: string | null;
}

export interface LoreSprintDoneDate {
  sprint_id: string;
  done_date: string | null;
}

export interface LoreSprintTask {
  task_uid: string;
  task_id: string;
  title: string | null;
  order_index: number;
  phase_uid: string | null;
  status_raw: string | null;
  effort_days: number | null;
  note_md: string | null;
  component_ids: string[] | null;
}

export interface LoreMilestone {
  milestone_id: string;
  label: string;
  week: number | null;
  date_display: string | null;
  goal_md: string | null;
  sprint_ids: string[] | null;
  direct_sprint_ids?: string[] | null;
}

export interface LoreComponent {
  component_id: string;
  full_name: string;
  area: string;
  parent_id: string | null;
  game_icon: string | null;
  children: string[];
  tech: string[];
  owner?: string | null;
  team?: string | null;
  adr_count?: number | null;
  spec_count?: number | null;
  qg_count?: number | null;
  sprint_count?: number | null;
  git_projects?: string[] | null;
}

export interface LoreComponentDetail extends LoreComponent {
  sub_components: string[] | null;
  adrs: string[] | null;
  specs: string[] | null;
  spec_docs: string[] | null;
}

export interface ComponentUpdatePayload {
  component_id: string;
  owner?: string | null;
  team?: string | null;
  full_name?: string | null;
  area?: string | null;
  game_icon?: string | null;
  parent_id?: string | null;
}

export async function updateLoreComponent(payload: ComponentUpdatePayload): Promise<{ ok: boolean; component_id: string }> {
  const res = await fetch('/lore/component/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify(payload),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; component_id: string }>;
}

export interface LoreSpecRow {
  spec_id: string;
  title: string | null;
  file_path: string | null;
  component_id: string | null;
}

export interface LoreSpecPassport extends LoreSpecRow {
  content_md: string | null;
  summary: string | null;
  version: string | null;
  valid_from: string | null;
}

export async function fetchLoreSpec(
  specId: string,
  signal?: AbortSignal,
): Promise<LoreSpecPassport | null> {
  const rows = await fetchLoreSlice<LoreSpecPassport>('spec_by_id', { id: specId }, signal);
  return rows[0] ?? null;
}

export interface LorePlanConfig {
  config_id: string;
  w0_date: string;
  weeks_total: number;
}

export interface LorePlanTrack {
  track_id: string;
  label: string;
  type: string | null;
}

export interface LorePlanSection {
  section_id: string;
  label: string;
  start_week: number;
  end_week: number;
  color: string;
}

export interface LorePlanCheckpoint {
  checkpoint_id: string;
  label: string;
  desc_md: string | null;
  milestone: string | null;
}

export interface LorePlanItem {
  item_id: string;
  label: string;
  track_id: string | null;
  week_start: number | null;
  week_end: number | null;
  bar_color: string | null;
  represents_sprint: string | null;
  status: string | null;
  milestone_id: string | null;
  /** Component ids the represented sprint BELONGS_TO (lane + bar icons). */
  components: string[] | null;
}

export type LorePlanItemStatus = 'todo' | 'planned' | 'backlog' | 'design' | 'active' | 'partial' | 'done' | 'blocked' | 'high' | 'cancelled' | 'ready_for_deploy';

export interface LoreStatusUpdateResponse {
  ok: boolean;
  entity_type: string;
  id: string;
  old_status: string | null;
  new_status: string;
  revision: { valid_from: string; plan_version?: string | null };
}

export async function postLoreStatus(
  entityType: 'plan_item' | 'sprint' | 'task' | 'checkpoint',
  id: string,
  status: LorePlanItemStatus,
): Promise<LoreStatusUpdateResponse> {
  const res = await fetch(`${LORE_BASE}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Seer-Role': 'admin',
    },
    body: JSON.stringify({ entity_type: entityType, id, status }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreStatusUpdateResponse>;
}

export interface LoreTaskWriteResponse {
  ok: boolean;
  task_uid: string;
  task_id: string | null;
  order_index: number | null;
}

export async function createLoreTask(
  sprintId: string,
  taskId: string,
  title: string,
  noteMd?: string | null,
): Promise<LoreTaskWriteResponse> {
  const res = await fetch(`${LORE_BASE}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, task_id: taskId, title, note_md: noteMd ?? null }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreTaskWriteResponse>;
}

export async function editLoreTask(
  taskUid: string,
  title: string,
  noteMd?: string | null,
): Promise<LoreTaskWriteResponse> {
  const res = await fetch(`${LORE_BASE}/task/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ task_uid: taskUid, title, note_md: noteMd ?? null }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreTaskWriteResponse>;
}

export interface LoreSprintRegisterResponse {
  ok: boolean;
  item_id: string;
  sprint_id: string;
  created: boolean;
}

/** Link or unlink a KnowSprint to a KnowGitProject (POST /lore/sprint/project). */
export async function linkTaskComponent(
  taskUid: string,
  componentId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; task_uid: string; component_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/task/component`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ task_uid: taskUid, component_id: componentId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; task_uid: string; component_id: string; action: string }>;
}

export async function linkSprintComponent(
  sprintId: string,
  componentId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; component_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/component`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, component_id: componentId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; component_id: string; action: string }>;
}

export async function linkSprintProject(
  sprintId: string,
  gitProject: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; git_project: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, git_project: gitProject, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; git_project: string; action: string }>;
}

/** Link or unlink a KnowSprint to a KnowMilestone (POST /lore/milestone/sprint). */
export async function linkSprintMilestone(
  sprintId: string,
  milestoneId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; milestone_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/milestone/sprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, milestone_id: milestoneId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; milestone_id: string; action: string }>;
}

/** Create or edit a KnowMilestone (POST /lore/milestone). */
export async function upsertMilestone(
  m: { milestone_id: string; label?: string; week?: number | null; date_display?: string | null; goal_md?: string | null },
): Promise<{ ok: boolean; milestone_id: string }> {
  const res = await fetch(`${LORE_BASE}/milestone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify(m),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; milestone_id: string }>;
}

/** Partial update of KnowSprint vertex fields (POST /lore/sprint/update). */
export async function setSprintTrack(
  sprintId: string,
  trackId: string | null,
): Promise<{ ok: boolean; sprint_id: string; track_id: string | null }> {
  const res = await fetch(`${LORE_BASE}/sprint/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, track_id: trackId }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; track_id: string | null }>;
}

export async function updateLoreSprint(
  sprintId: string,
  fields: { context_md?: string | null; outcome_md?: string | null; name?: string | null; priority?: string | null },
): Promise<{ ok: boolean; sprint_id: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({ sprint_id: sprintId, ...fields }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string }>;
}

/** Register a real sprint for a standalone plan-item placeholder (POST /lore/sprint). */
export async function registerLoreSprint(
  itemId: string,
  opts?: { sprintId?: string; name?: string; status?: string },
): Promise<LoreSprintRegisterResponse> {
  const res = await fetch(`${LORE_BASE}/sprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify({
      item_id: itemId,
      sprint_id: opts?.sprintId ?? null,
      name: opts?.name ?? null,
      status: opts?.status ?? 'active',
    }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreSprintRegisterResponse>;
}

export interface LoreRelease {
  release_id: string;
  release_uid: string | null;
  git_tag: string | null;
  version: string | null;
  type: 'major' | 'minor' | 'patch' | string | null;
  release_date: string | null;
  is_current: boolean | null;
  description_md: string | null;
  week: number | null;
  sprint_count: number | null;
  pr_count: number | null;
  git_project: string | null;
}

export interface LoreHistRow {
  valid_from: string | null;
  valid_to: string | null;
  content_hash: string | null;
  source_commit: string | null;
  status_raw?: string | null;
  week_start?: number | null;
  week_end?: number | null;
}

export interface LorePlanVersion {
  version_id: string;
  version_date: string | null;
  changelog_md: string | null;
}

export interface LoreKnowDocRow {
  doc_id: string;
  title: string | null;
  kind: 'fragment' | 'page' | null;
  has_ext_deps: boolean | null;
  component_id: string | null;
}

export interface LoreKnowDoc extends LoreKnowDocRow {
  content_html: string | null;
  valid_from: string | null;
}

export async function fetchLoreDoc(
  docId: string,
  signal?: AbortSignal,
): Promise<LoreKnowDoc | null> {
  const rows = await fetchLoreSlice<LoreKnowDoc>('doc_by_id', { id: docId }, signal);
  return rows[0] ?? null;
}
