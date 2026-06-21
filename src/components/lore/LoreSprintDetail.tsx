import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { marked } from 'marked';
import {
  fetchLoreSlice, postLoreStatus, createLoreTask, editLoreTask,
  type LoreSprintTask, type LorePlanItemStatus,
} from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';

interface SprintMeta {
  sprint_id: string;
  name: string;
  status_raw: string | null;
  pr_refs: string | null;
  release_ids: string[] | null;
  milestone_ids: string[] | null;
  depends_on: string[] | null;
}

interface PhaseRow {
  phase_uid: string;
  phase_id: string;
  order_index: number;
  valid_from: string | null;
  title: string | null;
  summary_md: string | null;
}

interface Props {
  sprintId: string;
  onError: (e: unknown) => void;
}

const NO_PHASE = '__no_phase__';
const GH_REPO  = 'https://github.com/NooriUta/AIDA';

function GhIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
               0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
               -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
               .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
               -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
               .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
               .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
               0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function extractVersion(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/v\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

// pr_refs comes from KnowSprintHist and is inconsistently shaped across sprints:
// a comma-joined string in some, an ArcadeDB LIST (string[]) in others. Accept any
// shape — a non-string here previously threw `s.split is not a function`, crashing
// the whole LoreSprintDetail render to a black page (e.g. SPRINT_LOOM_L2_REDESIGN).
function parsePrRefs(s: string | string[] | null | undefined): string[] {
  if (!s) return [];
  const parts = Array.isArray(s) ? s : [s];
  return parts
    .filter((x): x is string => typeof x === 'string')
    .flatMap(x => x.split(','))
    .map(x => x.trim())
    .filter(Boolean);
}

// Normalize sprint status by LEADING marker, so a "DONE" mentioned later in the
// line (e.g. "⬜ TODO — (V1 ✅ DONE 2026-05-04)") does not flip it to done.
function normalizeStatus(raw: string | null): string {
  if (!raw) return '';
  const s = raw.trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ|MERGED|ЗАКРЫТ)/i.test(s)) return 'done';
  if (s.startsWith('🔄') || s.startsWith('🟢') ||
      /^(IN.?PROGRESS|WIP|ACTIVE|READY)/i.test(s)) return 'in_progress';
  if (s.startsWith('🟡') || /^(PARTIAL|ЧАСТИЧ)/i.test(s)) return 'partial';
  if (s.startsWith('📋') || s.startsWith('⬜') || /^(TODO|PLANNED|STUB|DRAFT)/i.test(s)) return 'planned';
  if (s.startsWith('🟣') || s.startsWith('⏸') || s.startsWith('⬜ DEFERRED') ||
      /^(BACKLOG|DEFERRED|BLOCKED|ARCHIVED)/i.test(s)) return 'deferred';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return 'cancelled';
  return '';
}

// taskTick lives in ./lore-status (shared with LorePlanBoard) so the status mapping
// — including the 🔴 BLOCKED branch — stays in one place.

// Display status key → the canonical write token accepted by POST /lore/status.
function toToken(key: string): LorePlanItemStatus {
  if (key === 'done') return 'done';
  if (key === 'in_progress' || key === 'active') return 'active';
  if (key === 'partial') return 'partial';
  if (key === 'deferred' || key === 'blocked') return 'blocked';
  if (key === 'cancelled') return 'cancelled';
  return 'todo';
}

// Status options for the inline picker — localized RU labels + the status-key whose
// game-icon/colour (lore-status) the button shows.
const PICK_OPTS: { token: LorePlanItemStatus; statusKey: string; label: string }[] = [
  { token: 'todo',      statusKey: 'planned',     label: 'В план' },
  { token: 'active',    statusKey: 'in_progress', label: 'В работе' },
  { token: 'partial',   statusKey: 'partial',     label: 'Частично' },
  { token: 'done',      statusKey: 'done',        label: 'Готово' },
  { token: 'blocked',   statusKey: 'blocked',     label: 'Заблокировано' },
  { token: 'cancelled', statusKey: 'cancelled',   label: 'Отменено' },
];

// Inline status setter — admin-only write to system_aida_lore via POST /lore/status (SCD2).
// Renders as a small row of icon-buttons (consistent with the LORE status ticks),
// the active status highlighted; RU tooltips. No raw <select>.
function StatusPicker({ entityType, id, current, onChanged, onError }: {
  entityType: 'sprint' | 'task';
  id: string;
  current: LorePlanItemStatus;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function set(next: LorePlanItemStatus) {
    if (next === current || busy) return;
    setBusy(true);
    try { await postLoreStatus(entityType, id, next); onChanged(); }
    catch (err) { onError(err); }
    finally { setBusy(false); }
  }
  return (
    <span
      role="group" aria-label="Изменить статус"
      style={{ display: 'inline-flex', gap: 2, flexShrink: 0, opacity: busy ? 0.5 : 1 }}
    >
      {PICK_OPTS.map(o => {
        const meta = statusMeta(o.statusKey);
        const sel  = o.token === current;
        return (
          <button
            key={o.token} type="button" disabled={busy}
            title={o.label} aria-label={o.label} aria-pressed={sel}
            onClick={e => { e.stopPropagation(); void set(o.token); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 18, padding: 0, lineHeight: 0,
              cursor: busy ? 'default' : 'pointer', borderRadius: 3,
              background: sel ? `color-mix(in srgb, ${meta.color} 18%, transparent)` : 'transparent',
              border: sel ? `1px solid ${meta.color}` : '1px solid var(--bd)',
            }}
          >
            <GameIcon slug={meta.icon} size={12} style={{ color: meta.color }} />
          </button>
        );
      })}
    </span>
  );
}

// Status-count chips for the sprint header: one chip per present status (icon + count).
// Clicking a chip filters the task list to that status; clicking the active chip clears it.
const STATUS_COUNT_ORDER = ['done', 'active', 'partial', 'todo', 'blocked', 'cancelled'] as const;
const STATUS_COUNT_LABEL: Record<string, string> = {
  done: 'Готово', active: 'В работе', partial: 'Частично', todo: 'В плане', blocked: 'Заблокировано',
  cancelled: 'Отменено',
};

function StatusCounts({ tasks, filter, onFilter }: {
  tasks: LoreSprintTask[];
  filter: string | null;
  onFilter: (key: string | null) => void;
}) {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    const k = taskTick(t.status_raw).status;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const shown = STATUS_COUNT_ORDER.filter(k => counts[k]);
  if (shown.length === 0) return null;
  return (
    <span role="group" aria-label="Задачи по статусам (клик — фильтр)"
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {shown.map(k => {
        const meta = statusMeta(k);
        const active = filter === k;
        return (
          <button
            key={k} type="button" aria-pressed={active}
            title={`${STATUS_COUNT_LABEL[k]}: ${counts[k]} — ${active ? 'снять фильтр' : 'фильтровать'}`}
            aria-label={`${STATUS_COUNT_LABEL[k]}: ${counts[k]}`}
            onClick={() => onFilter(active ? null : k)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '0 6px', height: 18, borderRadius: 9, cursor: 'pointer',
              fontSize: 11, fontWeight: 700, lineHeight: 1, color: meta.color,
              background: active
                ? `color-mix(in srgb, ${meta.color} 22%, transparent)`
                : 'transparent',
              border: `1px solid color-mix(in srgb, ${meta.color} ${active ? 90 : 35}%, transparent)`,
            }}
          >
            <GameIcon slug={meta.icon} size={11} style={{ color: meta.color }} />
            {counts[k]}
          </button>
        );
      })}
    </span>
  );
}

const S = {
  root: {
    flex: 1, overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const,
    padding: '10px 16px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  sprintId:  { fontSize: 13, fontWeight: 700, color: 'var(--acc)', fontFamily: 'var(--mono)' },
  sprintName: {
    padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)',
    borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  meta: { fontSize: 11, color: 'var(--t3)' },
  section: { padding: '12px 16px' },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: 1,
    marginBottom: 8,
  },
  phase: {
    padding: '8px 10px', borderRadius: 3, marginBottom: 6,
    background: 'color-mix(in srgb, var(--b2) 50%, transparent)',
    borderLeft: '2px solid var(--acc)',
  },
  phaseId: { fontSize: 11, fontWeight: 600, color: 'var(--acc)', marginBottom: 3 },
  phaseSummary: { fontSize: 11, color: 'var(--t2)', lineHeight: 1.6, margin: '2px 0 4px' },
  task: {
    fontSize: 11, color: 'var(--t2)', lineHeight: 1.8, paddingLeft: 8,
    display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const,
  },
  tick: { flexShrink: 0 },
  taskId: { color: 'var(--acc)', fontFamily: 'var(--mono)', flexShrink: 0 },
  deps: { marginTop: 16 },
  depItem: { fontSize: 11, color: 'var(--t2)', paddingLeft: 4, lineHeight: 2 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  relLabel: {
    fontSize: 9, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em', flexShrink: 0,
  },
  releaseBadge: {
    fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 600,
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    cursor: 'pointer', fontFamily: 'var(--mono)', flexShrink: 0,
  },
  ghLink: {
    color: 'var(--t3)', textDecoration: 'none', flexShrink: 0,
    padding: '2px 4px', borderRadius: 3,
    border: '1px solid color-mix(in srgb, var(--bd) 70%, transparent)',
    display: 'inline-flex', alignItems: 'center',
  },
  prBar: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
    padding: '5px 16px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  prLabel: {
    fontSize: 9, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em', flexShrink: 0,
  },
  prLink: {
    fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--acc)', textDecoration: 'none',
    padding: '1px 4px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--acc) 20%, transparent)',
  },
};

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '3px 6px', borderRadius: 3,
  border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)',
  fontFamily: 'inherit',
};
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 18, padding: 0, lineHeight: 0, fontSize: 11,
  cursor: 'pointer', borderRadius: 3, background: 'transparent',
  border: '1px solid var(--bd)', color: 'var(--t2)', flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  fontSize: 11, padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
  border: '1px solid var(--acc)', color: 'var(--acc)',
  background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
};
const ghostBtn: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
  border: '1px solid var(--bd)', color: 'var(--t3)', background: 'transparent',
};
const mdBox: React.CSSProperties = {
  fontSize: 11, color: 'var(--t2)', lineHeight: 1.6,
  padding: '4px 8px 8px 26px', overflowX: 'auto',
};

function mdHtml(md: string | null | undefined): string {
  return md && md.trim() ? (marked.parse(md) as string) : '';
}

function TaskLine({ t, onChanged, onError }: {
  t: LoreSprintTask;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const meta = statusMeta(taskTick(t.status_raw).status);
  const hasDetail = !!(t.note_md && t.note_md.trim());
  const [editing, setEditing] = useState(false);
  const [title, setTitle]     = useState(t.title ?? '');
  const [note, setNote]       = useState(t.note_md ?? '');
  const [busy, setBusy]       = useState(false);

  async function save() {
    if (busy || !title.trim()) return;
    setBusy(true);
    try { await editLoreTask(t.task_uid, title.trim(), note); setEditing(false); onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  function cancel() {
    setEditing(false);
    setTitle(t.title ?? '');
    setNote(t.note_md ?? '');
  }

  return (
    <div style={{ borderBottom: '1px solid color-mix(in srgb, var(--b2) 45%, transparent)' }}>
      <div style={S.task}>
        <GameIcon slug={meta.icon} size={13} style={{ color: meta.color, alignSelf: 'center' }} />
        <span style={S.taskId}>{t.task_id}</span>
        {t.title && <span style={{ color: 'var(--t1)' }}>{t.title}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {t.effort_days != null && (
            <span style={{ color: 'var(--t3)', fontSize: 10 }}>{t.effort_days}d</span>
          )}
          <StatusPicker
            entityType="task" id={t.task_uid}
            current={toToken(taskTick(t.status_raw).status)}
            onChanged={onChanged} onError={onError}
          />
          <button type="button" style={iconBtn} title="Редактировать"
            onClick={() => setEditing(v => !v)}>✎</button>
        </span>
      </div>

      {editing && (
        <div style={{ padding: '4px 8px 8px 26px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Заголовок" style={inputStyle} />
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Описание (Markdown)" rows={5}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--mono)' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={primaryBtn} disabled={busy} onClick={save}>Сохранить</button>
            <button type="button" style={ghostBtn} onClick={cancel}>Отмена</button>
          </div>
        </div>
      )}

      {hasDetail && !editing && (
        <div style={mdBox} dangerouslySetInnerHTML={{ __html: mdHtml(t.note_md) }} />
      )}
    </div>
  );
}

// Inline "add task" control for a sprint.
function AddTaskForm({ sprintId, onAdded, onError }: {
  sprintId: string;
  onAdded: () => void;
  onError: (e: unknown) => void;
}) {
  const [show, setShow]   = useState(false);
  const [tid, setTid]     = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy]   = useState(false);

  async function add() {
    if (busy || !tid.trim() || !title.trim()) return;
    setBusy(true);
    try {
      await createLoreTask(sprintId, tid.trim(), title.trim());
      setTid(''); setTitle(''); setShow(false); onAdded();
    } catch (e) { onError(e); }
    finally { setBusy(false); }
  }

  if (!show) {
    return (
      <button type="button" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => setShow(true)}>
        + задача
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input value={tid} onChange={e => setTid(e.target.value)}
        placeholder="ID (SH-10)" style={{ ...inputStyle, width: 110, fontFamily: 'var(--mono)' }} />
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Заголовок" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
      <button type="button" style={primaryBtn} disabled={busy} onClick={add}>Добавить</button>
      <button type="button" style={ghostBtn} onClick={() => setShow(false)}>×</button>
    </div>
  );
}

export default function LoreSprintDetail({ sprintId, onError }: Props) {
  const [, setParams]         = useSearchParams();
  const [sprint,  setSprint]  = useState<SprintMeta | null>(null);
  const [phases,  setPhases]  = useState<PhaseRow[]>([]);
  const [tasks,   setTasks]   = useState<LoreSprintTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter]   = useState<string | null>(null);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  // Reset the status filter when switching sprints (not on in-place reloads).
  useEffect(() => { setFilter(null); }, [sprintId]);

  useEffect(() => {
    setLoading(true);
    setSprint(null);
    setPhases([]);
    setTasks([]);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<SprintMeta>('sprint_tree',         { id: sprintId },        ctrl.signal),
      fetchLoreSlice<PhaseRow>('phases_of_sprint',      { sprint_id: sprintId }, ctrl.signal),
      fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: sprintId }, ctrl.signal),
    ])
      .then(([metas, phaseRows, taskRows]) => {
        setSprint(metas[0] ?? null);
        setPhases(phaseRows);
        setTasks(taskRows);
        setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [sprintId, onError, reloadKey]);

  if (loading) return <div style={S.empty}>Загрузка {sprintId}…</div>;
  if (!sprint)  return <div style={S.empty}>Спринт {sprintId} не найден.</div>;

  const status  = normalizeStatus(sprint.status_raw);
  // Prefer the structured IMPLEMENTED_IN_RELEASE edge (accurate — ADR-bridge + curated
  // status ship-patterns); fall back to the version named in status_raw for sprints
  // that have no edge yet.
  const fallbackVer = extractVersion(sprint.status_raw);
  const releases = sprint.release_ids?.length
    ? sprint.release_ids
    : (fallbackVer ? [fallbackVer] : []);
  const prNums  = parsePrRefs(sprint.pr_refs);

  function goToRelease(v: string) {
    setParams(p => { p.set('section', 'releases'); p.set('q', v); p.delete('passport'); return p; });
  }

  // Optional status filter, driven by the header status-count chips.
  const visibleTasks = filter ? tasks.filter(t => taskTick(t.status_raw).status === filter) : tasks;

  // Group tasks by phase; tasks with no phase fall into NO_PHASE bucket.
  const byPhase = new Map<string, LoreSprintTask[]>();
  for (const t of visibleTasks) {
    const key = t.phase_uid ?? NO_PHASE;
    if (!byPhase.has(key)) byPhase.set(key, []);
    byPhase.get(key)!.push(t);
  }
  const orphanTasks = byPhase.get(NO_PHASE) ?? [];
  const doneTotal = tasks.filter(t => taskTick(t.status_raw).done).length;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.sprintId}>{sprint.sprint_id}</span>
        {status && <StatusChip status={status} />}
        <StatusPicker
          entityType="sprint"
          id={sprint.sprint_id}
          current={toToken(status)}
          onChanged={reload}
          onError={onError}
        />
        {tasks.length > 0 && (
          <>
            <StatusCounts tasks={tasks} filter={filter} onFilter={setFilter} />
            <span style={S.meta}>{doneTotal}/{tasks.length}</span>
          </>
        )}
        {sprint.milestone_ids?.length ? (
          <span style={S.meta}>→ {sprint.milestone_ids.join(', ')}</span>
        ) : null}
      </div>

      {sprint.name && <div style={S.sprintName}>{sprint.name}</div>}

      {releases.length > 0 && (
        <div style={S.prBar}>
          <span style={S.prLabel}>Релиз</span>
          {releases.map(v => (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <button onClick={() => goToRelease(v)} style={S.releaseBadge} title={`Перейти к релизу ${v}`}>
                {v}
              </button>
              <a
                href={`${GH_REPO}/releases/tag/${v}`}
                target="_blank" rel="noopener noreferrer"
                style={S.ghLink} title={`GitHub Release ${v}`}
              ><GhIcon /></a>
            </span>
          ))}
        </div>
      )}

      {prNums.length > 0 && (
        <div style={S.prBar}>
          <span style={S.prLabel}>PR</span>
          {prNums.map(n => (
            <a key={n} href={`${GH_REPO}/pull/${n}`} target="_blank" rel="noopener noreferrer" style={S.prLink}>
              #{n}
            </a>
          ))}
        </div>
      )}

      <div style={S.section}>
        {/* Phases (when present) each with their tasks */}
        {phases.length > 0 && (
          <>
            <div style={S.sectionLabel}>Фазы ({phases.length})</div>
            {phases.map(p => {
              const phaseTasks = byPhase.get(p.phase_uid) ?? [];
              if (filter && phaseTasks.length === 0) return null;
              return (
                <div key={p.phase_uid} style={S.phase}>
                  <div style={S.phaseId}>
                    {p.phase_id}
                    {p.title && <span style={{ color: 'var(--t1)', marginLeft: 6 }}>— {p.title}</span>}
                    {p.valid_from && (
                      <span style={{ ...S.meta, marginLeft: 8 }}>{p.valid_from.slice(0, 10)}</span>
                    )}
                    {phaseTasks.length > 0 && (
                      <span style={{ ...S.meta, marginLeft: 6 }}>· {phaseTasks.length} задач</span>
                    )}
                  </div>
                  {p.summary_md && <p style={S.phaseSummary}>{p.summary_md}</p>}
                  {phaseTasks.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {phaseTasks.map(t => (
                        <TaskLine key={t.task_uid} t={t} onChanged={reload} onError={onError} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Tasks not bound to any phase — the common case (most sprints have no phases) */}
        {orphanTasks.length > 0 && (
          <div style={{ marginTop: phases.length > 0 ? 12 : 0 }}>
            <div style={S.sectionLabel}>Задачи ({orphanTasks.length})</div>
            {orphanTasks.map(t => (
              <TaskLine key={t.task_uid} t={t} onChanged={reload} onError={onError} />
            ))}
          </div>
        )}

        {/* Truly empty sprint */}
        {phases.length === 0 && tasks.length === 0 && (
          <div style={S.empty}>Задачи не заведены.</div>
        )}

        {/* Filter matched nothing (sprint has tasks, just none in the picked status) */}
        {filter && tasks.length > 0 && visibleTasks.length === 0 && (
          <div style={S.empty}>
            Нет задач со статусом «{STATUS_COUNT_LABEL[filter]}».{' '}
            <button type="button" onClick={() => setFilter(null)}
              style={{ ...ghostBtn, padding: '1px 6px' }}>сбросить фильтр</button>
          </div>
        )}

        <AddTaskForm sprintId={sprint.sprint_id} onAdded={reload} onError={onError} />

        {sprint.depends_on?.length ? (
          <div style={S.deps}>
            <div style={S.sectionLabel}>Зависит от</div>
            {sprint.depends_on.map(d => (
              <div key={d} style={S.depItem}>· {d}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
