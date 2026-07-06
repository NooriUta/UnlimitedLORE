import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { parsePrRefs, normalizeStatus, formatEffortDays } from './loreUtils';
import { marked } from 'marked';
import { sanitizeMd } from './sanitizeHtml';
import {
  fetchLoreSlice, postLoreStatus, createLoreTask, editLoreTask, updateLoreSprint, updateSprintPlan,
  linkSprintProject, linkSprintComponent, linkTaskComponent, linkSprintMilestone, linkSprintRelease,
  type LoreSprintTask, type LorePlanItemStatus,
} from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';
import { areaColor } from './LoreComponentList';
import TipTapField from './TipTapField';

interface SprintMeta {
  sprint_id: string;
  name: string;
  status_raw: string | null;
  priority: string | null;
  pr_refs: string | null;
  release_ids: string[] | null;
  milestone_ids: string[] | null;
  depends_on: string[] | null;
  blocks: string[] | null;
  components: string[] | null;
  adr_ids: string[] | null;
  context_md: string | null;
  git_projects: string[] | null;
  created_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  planned_milestone_id: string | null;
  no_release_required: boolean | null;
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
  onNavigateToComponent?: (componentId: string) => void;
  onNavigateToSprint?: (sprintId: string) => void;
  onNavigateToAdr?: (adrId: string) => void;
}

// A component is "linked" to a sprint by the same naming convention the component
// passport uses in reverse (component_sprints: sprint_id LIKE '%<key>%'). Here we
// derive each component's key and keep those whose key appears in the sprint_id.
interface CompRow {
  component_id: string;
  full_name: string | null;
  area: string | null;
  game_icon: string | null;
}

// Milestone labels are frequently just the id repeated (e.g. label:"M0" for
// milestone_id:"M0") -- showing "M0 — M0" in a picker reads as a bug even
// though it's a data gap. Only append the label when it adds information.
function milestoneOptionLabel(m: { id: string; label: string }): string {
  return m.label && m.label !== m.id ? `${m.id} — ${m.label}` : m.id;
}

function componentKey(c: CompRow): string {
  // Mirror LoreComponentPassport: short ids fall back to the first full_name word.
  return (c.component_id.length < 4
    ? (c.full_name?.split(/\s+/)[0] ?? c.component_id)
    : c.component_id).toUpperCase();
}

const NO_PHASE = '__no_phase__';

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

// taskTick lives in ./lore-status (shared with LorePlanBoard) so the status mapping
// — including the 🔴 BLOCKED branch — stays in one place.

// Display status key → the canonical write token accepted by POST /lore/status.
function toToken(key: string): LorePlanItemStatus {
  if (key === 'done') return 'done';
  if (key === 'in_progress' || key === 'active') return 'active';
  if (key === 'partial') return 'partial';
  if (key === 'ready_for_deploy') return 'ready_for_deploy';
  if (key === 'blocked') return 'blocked';
  if (key === 'cancelled') return 'cancelled';
  if (key === 'planned' || key === 'deferred') return 'planned';
  if (key === 'backlog') return 'backlog';
  if (key === 'design') return 'design';
  return 'todo';
}

type PickOpt = { token: LorePlanItemStatus; statusKey: string; label: string; gi: string; c: string; abbr: string };

function buildSprintPickOpts(t: (k: string, d: string) => string): PickOpt[] {
  return [
    { token: 'todo',             statusKey: 'todo',             label: t('lore.sprintDetail.status.todo', 'TODO'),          gi: 'checkbox-tree',  c: '#665C48', abbr: 'TODO' },
    { token: 'planned',          statusKey: 'planned',          label: t('lore.sprintDetail.status.planned', 'Запланировано'), gi: 'calendar',        c: '#D4922A', abbr: 'PLN'  },
    { token: 'backlog',          statusKey: 'backlog',          label: t('lore.sprintDetail.status.backlog', 'Беклог'),        gi: 'tied-scroll',     c: '#9A8C6E', abbr: 'BL'   },
    { token: 'design',           statusKey: 'design',           label: t('lore.sprintDetail.status.design', 'Дизайн'),         gi: 'magic-swirl',     c: '#D4922A', abbr: 'DS'   },
    { token: 'active',           statusKey: 'in_progress',      label: t('lore.sprintDetail.status.active', 'В работе'),       gi: 'progression',     c: '#88B8A8', abbr: 'WIP'  },
    { token: 'partial',          statusKey: 'partial',          label: t('lore.sprintDetail.status.partial', 'Частично'),      gi: 'battery-50',      c: '#D4922A', abbr: 'PART' },
    { token: 'ready_for_deploy', statusKey: 'ready_for_deploy', label: t('lore.sprintDetail.status.readyForDeploy', 'К деплою'), gi: 'wave-crest',      c: '#7DBF78', abbr: 'RD'   },
    { token: 'done',             statusKey: 'done',             label: t('lore.sprintDetail.status.done', 'Готово'),           gi: 'divided-spiral',  c: '#7DBF78', abbr: 'DONE' },
    { token: 'blocked',          statusKey: 'blocked',          label: t('lore.sprintDetail.status.blocked', 'Заблокировано'), gi: 'handcuffed',      c: '#C85848', abbr: 'BLK'  },
    { token: 'cancelled',        statusKey: 'cancelled',        label: t('lore.sprintDetail.status.cancelled', 'Отменено'),    gi: 'cross-mark',      c: '#C85848', abbr: 'CNC'  },
  ];
}

const TASK_PICK_TOKENS = ['todo', 'active', 'partial', 'ready_for_deploy', 'done', 'blocked', 'cancelled'];

function StatusPicker({ entityType, id, current, onChanged, onError }: {
  entityType: 'sprint' | 'task' | 'phase';
  id: string;
  current: LorePlanItemStatus;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const sprintOpts = buildSprintPickOpts(t);
  const opts    = entityType === 'sprint' ? sprintOpts : sprintOpts.filter(o => TASK_PICK_TOKENS.includes(o.token));
  const compact = entityType !== 'sprint';
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
      role="group" aria-label={t('lore.sprintDetail.statusPicker.ariaLabel', 'Изменить статус')}
      style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, flexShrink: 0, opacity: busy ? 0.5 : 1 }}
    >
      {opts.map(o => {
        const sel = o.token === current;
        return (
          <button
            key={o.token} type="button" disabled={busy}
            title={o.label} aria-label={o.label} aria-pressed={sel}
            onClick={e => { e.stopPropagation(); void set(o.token); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: compact ? 0 : 3,
              padding: compact ? '0 4px' : '0 6px', height: 18,
              cursor: busy ? 'default' : 'pointer', borderRadius: 3,
              opacity: sel ? 1 : 0.42,
              background: sel ? `color-mix(in srgb, ${o.c} 16%, transparent)` : 'transparent',
              border: `1px solid ${sel ? o.c : 'transparent'}`,
            }}
          >
            <GameIcon slug={o.gi} size={compact ? 12 : 13} style={{ color: o.c }} />
            {!compact && (
              <span style={{
                fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1, letterSpacing: '0.03em',
                color: o.c,
                fontWeight: sel ? 600 : 400,
              }}>{o.abbr}</span>
            )}
          </button>
        );
      })}
    </span>
  );
}

function buildPriorityOpts(t: (k: string, d: string) => string) {
  return [
    { value: 'P0', label: t('lore.sprintDetail.priority.p0', 'P0 — критично'), color: '#E24B4A' },
    { value: 'P1', label: t('lore.sprintDetail.priority.p1', 'P1 — высокий'),  color: '#ef9f27' },
    { value: 'P2', label: t('lore.sprintDetail.priority.p2', 'P2 — обычный'),  color: 'var(--t3)' },
  ];
}

function PriorityPicker({ sprintId, current, onChanged, onError }: {
  sprintId: string;
  current: string | null;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const PRIORITY_OPTS = buildPriorityOpts(t);
  const [busy, setBusy] = useState(false);
  async function set(next: string | null) {
    if (busy) return;
    const val = next === current ? null : next; // повторный клик — сброс
    setBusy(true);
    try { await updateSprintPlan(sprintId, { priority: val }); onChanged(); }
    catch (err) { onError(err); }
    finally { setBusy(false); }
  }
  return (
    <span role="group" aria-label={t('lore.sprintDetail.priority.ariaLabel', 'Приоритет')} style={{ display: 'inline-flex', gap: 2, opacity: busy ? 0.5 : 1 }}>
      {PRIORITY_OPTS.map(o => {
        const sel = o.value === current;
        return (
          <button
            key={o.value} type="button" disabled={busy}
            title={o.label} aria-label={o.label} aria-pressed={sel}
            onClick={e => { e.stopPropagation(); void set(o.value); }}
            style={{
              padding: '0 6px', height: 18, borderRadius: 3, fontSize: 10,
              fontWeight: sel ? 600 : 400, cursor: busy ? 'default' : 'pointer',
              fontFamily: 'var(--mono)',
              color: sel ? o.color : 'var(--t3)',
              background: sel ? `color-mix(in srgb, ${o.color} 15%, transparent)` : 'transparent',
              border: sel ? `1px solid ${o.color}` : '1px solid var(--bd)',
            }}
          >{o.value}</button>
        );
      })}
    </span>
  );
}

// Status-count chips for the sprint header: one chip per present status (icon + count).
// Multi-select: click chips to show only those statuses; click again to deselect.
const STATUS_COUNT_ORDER = [
  'done', 'ready_for_deploy', 'active', 'partial', 'design',
  'planned', 'todo', 'deferred', 'backlog', 'blocked', 'cancelled',
] as const;
function buildStatusCountLabel(t: (k: string, d: string) => string): Record<string, string> {
  return {
    done: t('lore.sprintDetail.status.done', 'Готово'),
    ready_for_deploy: t('lore.sprintDetail.status.readyForDeploy', 'К деплою'),
    active: t('lore.sprintDetail.status.active', 'В работе'),
    partial: t('lore.sprintDetail.status.partial', 'Частично'),
    design: t('lore.sprintDetail.status.design', 'Дизайн'),
    planned: t('lore.sprintDetail.status.planned', 'Запланировано'),
    todo: t('lore.sprintDetail.status.todoPlan', 'В плане'),
    deferred: t('lore.sprintDetail.status.deferred', 'Отложено'),
    backlog: t('lore.sprintDetail.status.backlog', 'Беклог'),
    blocked: t('lore.sprintDetail.status.blocked', 'Заблокировано'),
    cancelled: t('lore.sprintDetail.status.cancelled', 'Отменено'),
  };
}

function StatusCounts({ tasks, filter, onFilter }: {
  tasks: LoreSprintTask[];
  filter: Set<string>;
  onFilter: (key: string) => void;
}) {
  const { t } = useTranslation();
  const STATUS_COUNT_LABEL = buildStatusCountLabel(t);
  const counts: Record<string, number> = {};
  for (const t2 of tasks) {
    const k = taskTick(t2.status_raw).status;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const shown = STATUS_COUNT_ORDER.filter(k => counts[k]);
  if (shown.length === 0) return null;
  return (
    <span role="group" aria-label={t('lore.sprintDetail.statusCounts.ariaLabel', 'Задачи по статусам (мультивыбор)')}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {shown.map(k => {
        const meta = statusMeta(k);
        const active = filter.has(k);
        const actionLabel = active
          ? t('lore.sprintDetail.statusCounts.unset', 'снять')
          : t('lore.sprintDetail.statusCounts.filter', 'фильтровать');
        return (
          <button
            key={k} type="button" aria-pressed={active}
            title={`${STATUS_COUNT_LABEL[k]}: ${counts[k]} — ${actionLabel}`}
            aria-label={`${STATUS_COUNT_LABEL[k]}: ${counts[k]}`}
            onClick={() => onFilter(k)}
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
    padding: '10px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  sprintId:  { fontSize: 13, fontWeight: 700, color: 'var(--acc)', fontFamily: 'var(--mono)' },
  sprintName: {
    padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--t1)',
    borderBottom: '1px solid var(--bd)', flexShrink: 0,
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
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const,
    padding: '4px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  linkGroup: {
    display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
  },
  barDivider: {
    width: 1, alignSelf: 'stretch' as const, background: 'var(--bd)', flexShrink: 0,
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
// Shared "+ link…" lookup combobox style — was duplicated 3x (projects/
// milestones/modules), each independently editable and prone to drift.
// One constant so they stay pixel-identical (общий стиль).
const lookupSelectStyle: React.CSSProperties = {
  fontSize: 11, padding: '2px 20px 2px 6px', borderRadius: 5,
  background: 'var(--bg2)', border: '1px solid var(--bd)',
  color: 'var(--t2)', cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6'%3E%3Cpath fill='%23888' d='M0 0l4 6 4-6z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 5px center',
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
  return md && md.trim() ? sanitizeMd(marked.parse(md) as string) : '';
}

function TaskLine({ t: task, allComps, onChanged, onError }: {
  t: LoreSprintTask;
  allComps: CompRow[];
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const meta = statusMeta(taskTick(task.status_raw).status);
  const hasDetail = !!(task.note_md && task.note_md.trim());
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle]     = useState(task.title ?? '');
  const [note, setNote]       = useState(task.note_md ?? '');
  const [busy, setBusy]       = useState(false);
  const [compPicker, setCompPicker] = useState(false);
  const [compBusy, setCompBusy]     = useState<string | null>(null);
  const linkedIds = new Set(task.component_ids ?? []);

  async function toggleComp(componentId: string) {
    if (compBusy) return;
    const action = linkedIds.has(componentId) ? 'remove' : 'add';
    setCompBusy(componentId);
    try {
      await linkTaskComponent(task.task_uid, componentId, action);
      onChanged();
    } catch (e) { onError(e); }
    finally { setCompBusy(null); }
  }

  async function save() {
    if (busy || !title.trim()) return;
    setBusy(true);
    try { await editLoreTask(task.task_uid, title.trim(), note); setEditing(false); onChanged(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  function cancel() {
    setEditing(false);
    setTitle(task.title ?? '');
    setNote(task.note_md ?? '');
  }

  return (
    <div style={{ borderBottom: '1px solid color-mix(in srgb, var(--b2) 45%, transparent)' }}>
      <div
        style={{ ...S.task, cursor: hasDetail && !editing ? 'pointer' : 'default' }}
        onClick={() => { if (hasDetail && !editing) setExpanded(v => !v); }}
      >
        <GameIcon slug={meta.icon} size={13} style={{ color: meta.color, alignSelf: 'center' }} />
        <span style={S.taskId}>{task.task_id}</span>
        {task.title && <span style={{ color: 'var(--t1)' }}>{task.title}</span>}
        {hasDetail && !editing && (
          <span style={{ fontSize: 9, color: 'var(--t3)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
        )}
        {/* Component tags */}
        {Array.from(linkedIds).map(cid => {
          const c = allComps.find(x => x.component_id === cid);
          const color = areaColor(c?.area ?? '');
          return (
            <span key={cid}
              title={c?.full_name ?? cid}
              style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: `color-mix(in srgb, ${color} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                color, fontFamily: 'var(--mono)', flexShrink: 0, cursor: 'default',
              }}
              onClick={e => e.stopPropagation()}
            >{cid}</span>
          );
        })}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {task.effort_days != null && (
            <span style={{ color: 'var(--t3)', fontSize: 10 }}>{formatEffortDays(task.effort_days)}</span>
          )}
          <StatusPicker
            entityType="task" id={task.task_uid}
            current={toToken(taskTick(task.status_raw).status)}
            onChanged={onChanged} onError={onError}
          />
          <button type="button" style={iconBtn} title={t('lore.sprintDetail.task.componentsTitle', 'Компоненты')}
            onClick={e => { e.stopPropagation(); setCompPicker(v => !v); }}>⊕</button>
          <button type="button" style={iconBtn} title={t('lore.sprintDetail.task.editTitle', 'Редактировать')}
            onClick={e => { e.stopPropagation(); setEditing(v => !v); }}>✎</button>
        </span>
      </div>

      {compPicker && allComps.length > 0 && (
        <div style={{ padding: '4px 8px 6px 26px', display: 'flex', flexWrap: 'wrap', gap: 4 }}
          onClick={e => e.stopPropagation()}>
          {allComps.map(c => {
            const linked = linkedIds.has(c.component_id);
            const color  = areaColor(c.area ?? '');
            const loading = compBusy === c.component_id;
            return (
              <button key={c.component_id} type="button" disabled={!!compBusy}
                title={c.full_name ?? c.component_id}
                onClick={() => void toggleComp(c.component_id)}
                style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3, cursor: compBusy ? 'default' : 'pointer',
                  opacity: loading ? 0.5 : (linked ? 1 : 0.45),
                  background: linked ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                  border: `1px solid color-mix(in srgb, ${color} ${linked ? 40 : 25}%, transparent)`,
                  color, fontFamily: 'var(--mono)',
                }}
              >{c.component_id}</button>
            );
          })}
        </div>
      )}

      {editing && (
        <div style={{ padding: '4px 8px 8px 26px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder={t('lore.sprintDetail.task.titlePlaceholder', 'Заголовок')} style={inputStyle} />
          <TipTapField value={note} onChange={setNote} minHeight={100}
            placeholder={t('lore.sprintDetail.task.descriptionPlaceholder', 'Описание (Markdown)')}
            enableImages={false} enableHtmlMode={false} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={primaryBtn} disabled={busy} onClick={save}>{t('lore.sprintDetail.task.save', 'Сохранить')}</button>
            <button type="button" style={ghostBtn} onClick={cancel}>{t('lore.sprintDetail.task.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}

      {hasDetail && !editing && expanded && (
        <div className="lore-md" style={mdBox} dangerouslySetInnerHTML={{ __html: mdHtml(task.note_md) }} />
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
  const { t } = useTranslation();
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
        {t('lore.sprintDetail.addTask.trigger', '+ задача')}
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input value={tid} onChange={e => setTid(e.target.value)}
        placeholder={t('lore.sprintDetail.addTask.idPlaceholder', 'ID (SH-10)')} style={{ ...inputStyle, width: 110, fontFamily: 'var(--mono)' }} />
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder={t('lore.sprintDetail.task.titlePlaceholder', 'Заголовок')} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
      <button type="button" style={primaryBtn} disabled={busy} onClick={add}>{t('lore.sprintDetail.addTask.submit', 'Добавить')}</button>
      <button type="button" style={ghostBtn} onClick={() => setShow(false)}>×</button>
    </div>
  );
}

function RelatedSprintRow({
  id, meta, onNavigate, accent = 'var(--t2)',
}: {
  id: string;
  meta?: { status_raw: string | null; task_total: number; task_done: number };
  onNavigate?: (id: string) => void;
  accent?: string;
}) {
  const tick = meta ? taskTick(meta.status_raw) : null;
  const sm = tick ? statusMeta(tick.status) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <button
        onClick={() => onNavigate?.(id)}
        disabled={!onNavigate}
        style={{ background: 'none', border: 'none', padding: 0, cursor: onNavigate ? 'pointer' : 'default',
          fontFamily: 'var(--mono)', fontSize: 11, color: accent, textAlign: 'left' as const,
          textDecoration: onNavigate ? 'underline' : 'none', textDecorationStyle: 'dotted' as const }}
      >· {id}</button>
      {sm && <GameIcon slug={sm.icon} size={10} style={{ color: sm.color, flexShrink: 0 }} />}
      {meta && (
        <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
          {meta.task_done}/{meta.task_total}
        </span>
      )}
    </div>
  );
}

export default function LoreSprintDetail({ sprintId, onError, onNavigateToComponent, onNavigateToSprint, onNavigateToAdr }: Props) {
  const { t } = useTranslation();
  const [, setParams]         = useSearchParams();
  const [sprint,  setSprint]  = useState<SprintMeta | null>(null);
  const [allComps, setAllComps] = useState<CompRow[]>([]);
  const [phases,  setPhases]  = useState<PhaseRow[]>([]);
  const [tasks,   setTasks]   = useState<LoreSprintTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter]   = useState<Set<string>>(new Set());
  const [ctxEdit, setCtxEdit] = useState(false);
  const [ctxDraft, setCtxDraft] = useState('');
  const [ctxSaving, setCtxSaving] = useState(false);
  const [projLinking, setProjLinking]   = useState(false);
  const [compLinking, setCompLinking] = useState(false);
  const [compQuery, setCompQuery]     = useState('');
  const [compPickerOpen, setCompPickerOpen] = useState(false);
  const [compPickerPos, setCompPickerPos] = useState<{ top: number; left: number } | null>(null);
  const compInputRef = useRef<HTMLInputElement>(null);

  // The portaled dropdown is position:fixed anchored to the input's screen
  // rect — recompute on every scroll/resize while open, or it visually
  // detaches from the input as soon as any ancestor (this sidebar column
  // scrolls, or the drag-resizable metaRightW column changes width) moves.
  useEffect(() => {
    if (!compPickerOpen) { setCompPickerPos(null); return; }
    const update = () => {
      const el = compInputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCompPickerPos({ top: r.bottom + 2, left: r.left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [compPickerOpen]);
  const [msLinking, setMsLinking]     = useState(false);
  const [planBusy, setPlanBusy]       = useState(false);
  const [relLinking, setRelLinking]   = useState(false);
  const [allProjects, setAllProjects] = useState<string[]>([]);
  const [allMilestones, setAllMilestones] = useState<{ id: string; label: string }[]>([]);
  const [allReleases, setAllReleases] = useState<{ id: string; gitProject: string }[]>([]);
  const [relatedMeta, setRelatedMeta] = useState<Map<string, { status_raw: string | null; task_total: number; task_done: number }>>(new Map());
  const [metaRightW, setMetaRightW] = useState(320);
  const metaDragRef = useRef<{ x: number; w: number } | null>(null);
  const [topBlockH, setTopBlockH] = useState(220);
  const topDragRef = useRef<{ y: number; h: number } | null>(null);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  // Drag-resize the right meta column (projects/milestones/modules/ADR) — same
  // pattern as LorePage's list-panel resize handle.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!metaDragRef.current) return;
      const dx = metaDragRef.current.x - e.clientX; // dragging left grows the right column
      setMetaRightW(Math.min(560, Math.max(200, metaDragRef.current.w + dx)));
    };
    const onUp = () => { metaDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Drag-resize the top meta block's height (shared by CONTEXT + META RIGHT),
  // which in turn grows/shrinks the task list below it.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!topDragRef.current) return;
      const dy = e.clientY - topDragRef.current.y;
      setTopBlockH(Math.min(700, Math.max(100, topDragRef.current.h + dy)));
    };
    const onUp = () => { topDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  function toggleFilter(k: string) {
    setFilter(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // Reset the status filter when switching sprints (not on in-place reloads).
  useEffect(() => { setFilter(new Set()); }, [sprintId]);

  // Load available projects from DB once (not per-sprint).
  useEffect(() => {
    fetchLoreSlice<{ slug: string }>('git_projects', {})
      .then(rows => setAllProjects(rows.map(r => r.slug).filter(Boolean)))
      .catch(() => {});
  }, []);

  // Load all components once for the reverse sprint→modules badges.
  useEffect(() => {
    fetchLoreSlice<CompRow>('components', {})
      .then(rows => setAllComps(rows ?? []))
      .catch(() => {});
  }, []);

  // Load milestones once (for the sprint↔milestone linker).
  useEffect(() => {
    fetchLoreSlice<{ milestone_id: string; label: string }>('milestones', {})
      .then(rows => setAllMilestones((rows ?? []).map(r => ({ id: r.milestone_id, label: r.label }))))
      .catch(() => {});
  }, []);

  // Load releases once (for the sprint↔release linker) — release_uid is
  // "<git_project>#<release_id>", split it since the slice has no separate
  // git_project column.
  useEffect(() => {
    fetchLoreSlice<{ release_id: string; release_uid: string }>('releases', {})
      .then(rows => setAllReleases((rows ?? []).map(r => ({
        id: r.release_id, gitProject: r.release_uid?.split('#')[0] ?? 'NooriUta/AIDA',
      }))))
      .catch(() => {});
  }, []);

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
        const s = metas[0] ?? null;
        setSprint(s);
        setPhases(phaseRows);
        setTasks(taskRows);
        setLoading(false);
        // Load related sprint meta (depends_on + blocks): status + task counts
        const relIds = [...(s?.depends_on ?? []), ...(s?.blocks ?? [])];
        if (relIds.length > 0) {
          Promise.all(relIds.map(id =>
            Promise.all([
              fetchLoreSlice<SprintMeta>('sprint_tree', { id }, ctrl.signal),
              fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: id }, ctrl.signal),
            ]).then(([mRow, tRows]) => {
              const meta = mRow[0];
              if (!meta) return null;
              const task_total = tRows.length;
              const task_done  = tRows.filter(t => taskTick(t.status_raw).done).length;
              return { id, status_raw: meta.status_raw, task_total, task_done };
            })
          )).then(results => {
            const m = new Map<string, { status_raw: string | null; task_total: number; task_done: number }>();
            results.forEach(r => { if (r) m.set(r.id, r); });
            setRelatedMeta(m);
          }).catch(() => {});
        }
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [sprintId, onError, reloadKey]);

  if (loading) return <div style={S.empty}>{t('lore.sprintDetail.loading', 'Загрузка {{sprintId}}…', { sprintId })}</div>;
  if (!sprint)  return <div style={S.empty}>{t('lore.sprintDetail.notFound', 'Спринт {{sprintId}} не найден.', { sprintId })}</div>;

  const status  = normalizeStatus(sprint.status_raw);
  const ghSlug  = sprint.git_projects?.[0] ?? 'NooriUta/AIDA';
  const ghBase  = ghSlug.startsWith('http') ? ghSlug : `https://github.com/${ghSlug}`;
  // Prefer the structured IMPLEMENTED_IN_RELEASE edge (accurate — ADR-bridge + curated
  // status ship-patterns); fall back to the version named in status_raw for sprints
  // that have no edge yet.
  const fallbackVer = extractVersion(sprint.status_raw);
  const releases = sprint.release_ids?.length
    ? sprint.release_ids
    : (fallbackVer ? [fallbackVer] : []);
  const prNums  = parsePrRefs(sprint.pr_refs);

  // Modules for this sprint. Explicit BELONGS_TO links (sprint.components, from the
  // sprint_tree slice) are authoritative — when present, show ONLY those. Otherwise
  // fall back to the naming-convention reverse match (component key ⊂ sprint_id,
  // key length ≥ 3 to avoid noisy 1–2 char matches).
  const sprintIdUpper = sprint.sprint_id.toUpperCase();
  const explicit = sprint.components ?? [];
  const linkedComps = (explicit.length
    ? allComps.filter(c => explicit.includes(c.component_id))
    : allComps.filter(c => { const k = componentKey(c); return k.length >= 3 && sprintIdUpper.includes(k); })
  ).sort((a, b) => componentKey(b).length - componentKey(a).length);

  function goToRelease(v: string) {
    setParams(p => { p.set('section', 'releases'); p.set('q', v); p.delete('passport'); return p; });
  }

  // Optional status filter — multi-select; empty set = show all.
  const visibleTasks = filter.size === 0 ? tasks : tasks.filter(t => filter.has(taskTick(t.status_raw).status));

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
        <PriorityPicker
          sprintId={sprint.sprint_id}
          current={sprint.priority}
          onChanged={reload}
          onError={onError}
        />
        {tasks.length > 0 && (
          <>
            <StatusCounts tasks={tasks} filter={filter} onFilter={toggleFilter} />
            <span style={S.meta}>{doneTotal}/{tasks.length}</span>
            {(() => {
              const effortSum = visibleTasks.reduce((s, tk) => s + (tk.effort_days ?? 0), 0);
              const label = filter.size > 0 ? t('lore.sprintDetail.header.effortSelected', 'выбр.') : 'Σ';
              return effortSum > 0
                ? <span style={S.meta} title={t('lore.sprintDetail.header.effortSumTitle', 'Сумма effort_days по отображаемым задачам')}>{label} <b style={{ color: 'var(--acc)' }}>{formatEffortDays(effortSum)}</b></span>
                : null;
            })()}
          </>
        )}
        {sprint.milestone_ids?.length ? (
          <span style={S.meta}>→ {sprint.milestone_ids.join(', ')}</span>
        ) : null}
      </div>

      {sprint.name && <div style={S.sprintName}>{sprint.name}</div>}

      {(() => {
        // `releases` (top of render) falls back to a version string parsed out of
        // status_raw when there's no real IMPLEMENTED_IN_RELEASE edge — only
        // sprint.release_ids are real edges and thus unlinkable/addable here.
        const linkedReleases = sprint.release_ids ?? [];
        const displayReleases = releases; // real edges, else the parsed fallback
        const sprintProjects = sprint.git_projects ?? [];
        const releaseOptions = allReleases.filter(r =>
          !linkedReleases.includes(r.id) &&
          (sprintProjects.length === 0 || sprintProjects.includes(r.gitProject)));
        const showRelease = displayReleases.length > 0 || releaseOptions.length > 0;
        const showPr = prNums.length > 0;
        if (!showRelease && !showPr) return null;
        // Релиз + PR merged into one row (was two separately-bordered/padded
        // bars) — same info, half the vertical space.
        return (
          <div style={S.prBar}>
            {showRelease && (
              <span style={S.linkGroup}>
                <span style={S.prLabel}>{t('lore.sprintDetail.releaseBar.label', 'Релиз')}</span>
                {displayReleases.map(v => (
                  <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <button onClick={() => goToRelease(v)} style={S.releaseBadge} title={t('lore.sprintDetail.releaseBar.goToRelease', 'Перейти к релизу {{v}}', { v })}>
                      {v}
                    </button>
                    <a
                      href={`${ghBase}/releases/tag/${v}`}
                      target="_blank" rel="noopener noreferrer"
                      style={S.ghLink} title={t('lore.sprintDetail.releaseBar.githubRelease', 'GitHub Release {{v}}', { v })}
                    ><GhIcon /></a>
                    {linkedReleases.includes(v) && (
                      <button
                        disabled={relLinking}
                        title={t('lore.sprintDetail.releaseBar.unlink', 'Отвязать {{v}}', { v })}
                        onClick={async () => {
                          setRelLinking(true);
                          try {
                            await linkSprintRelease(sprint.sprint_id, v, sprintProjects[0] ?? ghSlug, 'remove');
                            setSprint(s => s ? { ...s, release_ids: (s.release_ids ?? []).filter(x => x !== v) } : s);
                          } catch (e) { onError(e); } finally { setRelLinking(false); }
                        }}
                        style={{ background: 'none', border: 'none', cursor: relLinking ? 'default' : 'pointer',
                          color: 'var(--t3)', fontSize: 10, padding: 0, lineHeight: 1, opacity: 0.7 }}
                      >✕</button>
                    )}
                  </span>
                ))}
                {releaseOptions.length > 0 && (() => {
                  // F-22: release options were a flat list of bare tags filtered
                  // only by git project — hard to pick and unclear which repo/
                  // component a release belongs to. Group by project (optgroup)
                  // and carry "<project>#<id>" as the value so cross-project tag
                  // collisions (AIDA#v1.3.0 vs seidr-site#v1.3.0) link the right one.
                  const projShort = (p: string) => p?.split('/').pop() ?? p;
                  const byProj = new Map<string, typeof releaseOptions>();
                  releaseOptions.forEach(r => { const a = byProj.get(r.gitProject) ?? []; a.push(r); byProj.set(r.gitProject, a); });
                  const projs = [...byProj.keys()].sort();
                  return (
                  <select
                    disabled={relLinking}
                    value=""
                    onChange={async e => {
                      const hi = e.target.value.indexOf('#');
                      const gp = e.target.value.slice(0, hi), rid = e.target.value.slice(hi + 1);
                      const opt = releaseOptions.find(r => r.gitProject === gp && r.id === rid);
                      if (!opt) return;
                      setRelLinking(true);
                      try {
                        await linkSprintRelease(sprint.sprint_id, opt.id, opt.gitProject, 'add');
                        setSprint(s => s ? { ...s, release_ids: [...(s.release_ids ?? []), opt.id] } : s);
                      } catch (err) { onError(err); } finally { setRelLinking(false); }
                    }}
                    style={lookupSelectStyle}
                  >
                    <option value="">{t('lore.sprintDetail.releaseBar.linkPlaceholder', '+ привязать релиз…')}</option>
                    {projs.length > 1
                      ? projs.map(pr => (
                          <optgroup key={pr} label={projShort(pr)}>
                            {byProj.get(pr)!.map(r => <option key={pr + '#' + r.id} value={pr + '#' + r.id}>{r.id}</option>)}
                          </optgroup>
                        ))
                      : releaseOptions.map(r => <option key={r.gitProject + '#' + r.id} value={r.gitProject + '#' + r.id}>{r.id} · {projShort(r.gitProject)}</option>)}
                  </select>
                  );
                })()}
                {relLinking && <span style={{ fontSize: 10, color: 'var(--t3)' }}>…</span>}
              </span>
            )}
            {showRelease && showPr && <span style={S.barDivider} />}
            {showPr && (
              <span style={S.linkGroup}>
                <span style={S.prLabel}>{t('lore.sprintDetail.prBar.label', 'PR')}</span>
                {prNums.map(n => (
                  <a key={n} href={`${ghBase}/pull/${n}`} target="_blank" rel="noopener noreferrer" style={S.prLink}>
                    #{n}
                  </a>
                ))}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Top meta block: context (left) + projects/milestones/modules (right) ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>

      {/* CONTEXT — left, flexible. maxHeight+overflow caps its growth so a long
          context_md can never crowd out the task list below (both this block and
          the task list live in the same flex column; without a cap, a large
          context — flexShrink:0 — pushes the flex:1 task list toward 0 height). */}
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--bd)', padding: '8px 14px 10px', maxHeight: topBlockH, overflowY: 'auto' as const }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.sprintDetail.context.label', 'Контекст')}</span>
          {!ctxEdit && (
            <button onClick={() => { setCtxDraft(sprint.context_md ?? ''); setCtxEdit(true); }}
              style={{ fontSize: 10, padding: '1px 6px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t2)', cursor: 'pointer' }}>{t('lore.sprintDetail.context.editButton', '✎ ред.')}</button>
          )}
        </div>
        {ctxEdit ? (
          <div>
            <TipTapField value={ctxDraft} onChange={setCtxDraft} minHeight={120}
              placeholder={t('lore.sprintDetail.context.placeholder', 'Зачем этот спринт, ключевые решения, ссылки на ADR/доки...')}
              enableImages={false} enableHtmlMode={false} />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button disabled={ctxSaving} onClick={async () => {
                setCtxSaving(true);
                try { await updateLoreSprint(sprint.sprint_id, { context_md: ctxDraft || null }); setSprint(s => s ? { ...s, context_md: ctxDraft || null } : s); setCtxEdit(false); }
                catch (e) { onError(e); } finally { setCtxSaving(false); }
              }} style={{ fontSize: 11, padding: '2px 10px', background: 'var(--acc)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}>{ctxSaving ? '…' : t('lore.sprintDetail.context.save', 'Сохранить')}</button>
              <button onClick={() => setCtxEdit(false)} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--t2)', cursor: 'pointer' }}>{t('lore.sprintDetail.context.cancel', 'Отмена')}</button>
            </div>
          </div>
        ) : sprint.context_md ? (
          <div className="lore-md" style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: mdHtml(sprint.context_md) }} />
        ) : (
          <div style={{ fontSize: 11, color: 'var(--t4)', fontStyle: 'italic' }}>{t('lore.sprintDetail.context.empty', 'Контекст не заполнен')}</div>
        )}
      </div>

      {/* Drag handle — resizes META RIGHT (mirrors LorePage's .lore-resize-handle) */}
      <div
        className="lore-resize-handle"
        onMouseDown={e => { metaDragRef.current = { x: e.clientX, w: metaRightW }; e.preventDefault(); }}
      />

      {/* META RIGHT — projects + milestones + modules */}
      <div style={{ width: metaRightW, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, maxHeight: topBlockH, overflowY: 'auto' as const }}>

      {/* ── Projects section ───────────────────────────────────────────────── */}
      {(() => {
        const linked = sprint.git_projects ?? [];
        const unlinked = allProjects.filter(g => !linked.includes(g));
        const projLabel = (slug: string) => slug.split('/').pop() ?? slug;
        return (
          <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.sprintDetail.projects.label', 'Проекты')}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
              {linked.map(g => (
                <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                  padding: '2px 8px', borderRadius: 10, background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)', color: 'var(--acc)' }}>
                  {projLabel(g)}
                  <button
                    disabled={projLinking}
                    onClick={async () => {
                      setProjLinking(true);
                      try {
                        await linkSprintProject(sprint.sprint_id, g, 'remove');
                        setSprint(s => s ? { ...s, git_projects: (s.git_projects ?? []).filter(x => x !== g) } : s);
                      } catch (e) { onError(e); }
                      finally { setProjLinking(false); }
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
                      fontSize: 10, padding: 0, lineHeight: 1, opacity: 0.7 }}
                    title={t('lore.sprintDetail.projects.unlink', 'Отвязать {{g}}', { g })}
                  >✕</button>
                </span>
              ))}
              {unlinked.length > 0 && (
                <select
                  disabled={projLinking}
                  value=""
                  onChange={async e => {
                    const g = e.target.value;
                    if (!g) return;
                    setProjLinking(true);
                    try {
                      await linkSprintProject(sprint.sprint_id, g, 'add');
                      setSprint(s => s ? { ...s, git_projects: [...(s.git_projects ?? []), g] } : s);
                    } catch (err) { onError(err); }
                    finally { setProjLinking(false); }
                  }}
                  style={lookupSelectStyle}
                >
                  <option value="">{t('lore.sprintDetail.projects.linkPlaceholder', '+ привязать…')}</option>
                  {unlinked.map(g => <option key={g} value={g}>{projLabel(g)}</option>)}
                </select>
              )}
              {projLinking && <span style={{ fontSize: 10, color: 'var(--t3)' }}>…</span>}
            </div>
          </div>
        );
      })()}

      {/* ── Planning section (planned_start/end date, planned milestone, created_date)
          — plain SCD2-tracked KnowSprintHist fields, edited via /lore/sprint/plan.
          Not to be confused with the "Вехи" section below, which is the ACTUAL
          milestone (TARGETS_MILESTONE edge) — that one already existed. */}
      <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <GameIcon slug="compass" size={11} style={{ color: 'var(--t3)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.sprintDetail.plan.label', 'Планирование')}</span>
          {planBusy && <span style={{ fontSize: 10, color: 'var(--t3)' }}>…</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5 }}>
          {sprint.created_date && (
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>
              {t('lore.sprintDetail.plan.created', 'Создан')}: <span style={{ color: 'var(--t2)', fontFamily: 'var(--mono)' }}>{sprint.created_date.slice(0, 10)}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" disabled={planBusy} style={lookupSelectStyle}
              value={sprint.planned_start_date ?? ''}
              title={t('lore.sprintDetail.plan.start', 'Плановая дата старта')}
              onChange={async e => {
                const v = e.target.value || null;
                setPlanBusy(true);
                try {
                  await updateSprintPlan(sprint.sprint_id, { planned_start_date: v });
                  setSprint(s => s ? { ...s, planned_start_date: v } : s);
                } catch (err) { onError(err); } finally { setPlanBusy(false); }
              }} />
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>→</span>
            <input type="date" disabled={planBusy} style={lookupSelectStyle}
              value={sprint.planned_end_date ?? ''}
              title={t('lore.sprintDetail.plan.end', 'Плановая дата завершения')}
              onChange={async e => {
                const v = e.target.value || null;
                setPlanBusy(true);
                try {
                  await updateSprintPlan(sprint.sprint_id, { planned_end_date: v });
                  setSprint(s => s ? { ...s, planned_end_date: v } : s);
                } catch (err) { onError(err); } finally { setPlanBusy(false); }
              }} />
          </div>
          {/* Planned vs. actual milestone used to be two separate controls
              (planned_milestone_id plain field vs. TARGETS_MILESTONE edge) —
              in practice they're always the same value, so one control now
              drives both: it links/unlinks the actual edge AND keeps
              planned_milestone_id in sync for the forecast/analytics that
              still read it. */}
          <select disabled={planBusy || msLinking} style={lookupSelectStyle}
            value={(sprint.milestone_ids ?? [])[0] ?? sprint.planned_milestone_id ?? ''}
            title={t('lore.sprintDetail.plan.milestone', 'Веха')}
            onChange={async e => {
              const v = e.target.value || null;
              setPlanBusy(true); setMsLinking(true);
              try {
                const prevLinked = sprint.milestone_ids ?? [];
                for (const mid of prevLinked) {
                  if (mid !== v) await linkSprintMilestone(sprint.sprint_id, mid, 'remove');
                }
                if (v) await linkSprintMilestone(sprint.sprint_id, v, 'add');
                await updateSprintPlan(sprint.sprint_id, { planned_milestone_id: v });
                setSprint(s => s ? { ...s, milestone_ids: v ? [v] : [], planned_milestone_id: v } : s);
              } catch (err) { onError(err); } finally { setPlanBusy(false); setMsLinking(false); }
            }}>
            <option value="">{t('lore.sprintDetail.plan.milestonePlaceholder', '— веха —')}</option>
            {allMilestones.map(m => <option key={m.id} value={m.id}>{milestoneOptionLabel(m)}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--t2)', cursor: planBusy ? 'default' : 'pointer' }}>
            <input type="checkbox" disabled={planBusy}
              checked={!!sprint.no_release_required}
              title={t('lore.sprintDetail.plan.noReleaseHint', 'Не учитывать в метриках незарелиженности/deploy-lag (доки, research, внутренний тулинг — никогда не выходит отдельным релизом)')}
              onChange={async e => {
                const v = e.target.checked;
                setPlanBusy(true);
                try {
                  await updateLoreSprint(sprint.sprint_id, { no_release_required: v });
                  setSprint(s => s ? { ...s, no_release_required: v } : s);
                } catch (err) { onError(err); } finally { setPlanBusy(false); }
              }} />
            {t('lore.sprintDetail.plan.noReleaseRequired', 'Не требует релиза')}
          </label>
        </div>
      </div>

      {/* ── Modules section (sprint→component links) ────────────────────────── */}
      {(() => {
        const unlinkedComps = allComps.filter(c => !explicit.includes(c.component_id));
        const q = compQuery.trim().toLowerCase();
        const filteredUnlinked = q
          ? unlinkedComps.filter(c =>
              c.component_id.toLowerCase().includes(q) || (c.full_name ?? '').toLowerCase().includes(q))
          : unlinkedComps;
        const addComp = async (cid: string) => {
          setCompLinking(true);
          try {
            await linkSprintComponent(sprint.sprint_id, cid, 'add');
            setSprint(s => s ? { ...s, components: [...(s.components ?? []), cid] } : s);
            setCompQuery(''); setCompPickerOpen(false);
          } catch (err) { onError(err); }
          finally { setCompLinking(false); }
        };
        return (
          <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.sprintDetail.modules.label', 'Модули')}</span>
              {linkedComps.length > 0 && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{linkedComps.length}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
              {linkedComps.map(c => {
                const col = areaColor(c.area);
                const isExplicit = explicit.includes(c.component_id);
                const name = c.full_name || c.component_id;
                return (
                  <span key={c.component_id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    padding: '3px', borderRadius: 10,
                    background: `color-mix(in srgb, ${col} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${col} 30%, transparent)`,
                    color: col,
                  }}>
                    <button
                      onClick={onNavigateToComponent ? () => onNavigateToComponent(c.component_id) : undefined}
                      disabled={!onNavigateToComponent}
                      title={onNavigateToComponent ? t('lore.sprintDetail.modules.openTitle', 'Открыть {{name}}', { name }) : name}
                      aria-label={onNavigateToComponent ? t('lore.sprintDetail.modules.openTitle', 'Открыть {{name}}', { name }) : name}
                      style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none',
                        color: 'inherit', cursor: onNavigateToComponent ? 'pointer' : 'default', padding: 0, lineHeight: 0 }}
                    >
                      <GameIcon slug={c.game_icon} size={13} style={{ color: 'inherit' }} />
                    </button>
                    {isExplicit && (
                      <button
                        disabled={compLinking}
                        title={t('lore.sprintDetail.modules.unlink', 'Отвязать {{cid}}', { cid: c.component_id })}
                        onClick={async () => {
                          setCompLinking(true);
                          try {
                            await linkSprintComponent(sprint.sprint_id, c.component_id, 'remove');
                            setSprint(s => s ? { ...s, components: (s.components ?? []).filter(x => x !== c.component_id) } : s);
                          } catch (e) { onError(e); }
                          finally { setCompLinking(false); }
                        }}
                        style={{ background: 'none', border: 'none', cursor: compLinking ? 'default' : 'pointer',
                          color: 'inherit', fontSize: 10, padding: '0 1px', lineHeight: 1, opacity: 0.65 }}
                      >✕</button>
                    )}
                  </span>
                );
              })}
              {unlinkedComps.length > 0 && (
                <div style={{ position: 'relative' as const }}>
                  <input
                    ref={compInputRef}
                    type="text"
                    disabled={compLinking}
                    value={compQuery}
                    placeholder={t('lore.sprintDetail.modules.linkPlaceholder', '+ привязать…')}
                    onFocus={() => setCompPickerOpen(true)}
                    onChange={e => { setCompQuery(e.target.value); setCompPickerOpen(true); }}
                    onBlur={() => setTimeout(() => setCompPickerOpen(false), 150)}
                    style={{ ...lookupSelectStyle, width: 140 }}
                  />
                  {/* Portaled to <body> with position:fixed anchored to the input's
                      real screen rect — this sidebar column scrolls
                      (overflowY:auto), and an absolutely-positioned popup here
                      would get clipped/unclickable as soon as Модули isn't the
                      last visible section (the bug this replaced). */}
                  {compPickerOpen && filteredUnlinked.length > 0 && compPickerPos && createPortal(
                    <div style={{
                      position: 'fixed' as const,
                      top: compPickerPos.top,
                      left: compPickerPos.left,
                      zIndex: 1000,
                      minWidth: 180, maxHeight: 200, overflowY: 'auto' as const,
                      background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 4,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    }}>
                      {filteredUnlinked.map(c => (
                        <div
                          key={c.component_id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => addComp(c.component_id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                            fontSize: 11, color: 'var(--t1)', cursor: 'pointer' }}
                        >
                          <GameIcon slug={c.game_icon} size={12} style={{ color: areaColor(c.area) }} />
                          {c.full_name || c.component_id}
                        </div>
                      ))}
                    </div>,
                    document.body,
                  )}
                </div>
              )}
              {compLinking && <span style={{ fontSize: 10, color: 'var(--t3)' }}>…</span>}
            </div>
          </div>
        );
      })()}

      {/* ── ADR section (reverse of ADR's IMPLEMENTED_IN — which ADRs implement in this sprint) ── */}
      {sprint.adr_ids != null && sprint.adr_ids.length > 0 && (
        <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('lore.sprintDetail.adr.label', 'ADR')}</span>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>{sprint.adr_ids.length}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            {sprint.adr_ids.map(id => (
              <button
                key={id}
                onClick={onNavigateToAdr ? () => onNavigateToAdr(id) : undefined}
                disabled={!onNavigateToAdr}
                title={onNavigateToAdr ? t('lore.sprintDetail.adr.openTitle', 'Открыть {{id}}', { id }) : id}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                  padding: '2px 8px', borderRadius: 10,
                  background: 'color-mix(in srgb, #4a90d9 14%, transparent)',
                  border: '1px solid color-mix(in srgb, #4a90d9 30%, transparent)',
                  color: '#4a90d9', cursor: onNavigateToAdr ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                }}
              >
                <GameIcon slug="scroll-quill" size={12} style={{ color: 'inherit' }} />
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      </div>{/* END META RIGHT */}
      </div>{/* END TOP META BLOCK */}

      {/* Drag handle — resizes the top meta block's height (grows/shrinks the
          task list below it). Vertical counterpart of the META RIGHT handle. */}
      <div
        className="lore-resize-handle-h"
        onMouseDown={e => { topDragRef.current = { y: e.clientY, h: topBlockH }; e.preventDefault(); }}
      />

      {/* ── Tasks (full width, scrollable) ── */}
      <div style={{ flex: 1, overflowY: 'auto' as const }}>
      <div style={S.section}>
        {/* Phases (when present) each with their tasks */}
        {phases.length > 0 && (
          <>
            <div style={S.sectionLabel}>{t('lore.sprintDetail.phases.sectionLabel', 'Фазы ({{count}})', { count: phases.length })}</div>
            {phases.map(p => {
              const phaseTasks = byPhase.get(p.phase_uid) ?? [];
              if (filter && phaseTasks.length === 0) return null;
              // p.title is NOT a human title — phases_of_sprint reads it straight
              // from the phase's own HAS_STATE.status_raw (same SCD2 field task/
              // sprint use). Editable via the same /lore/status endpoint + entity_type
              // "phase" the backend has supported all along — this used to only be
              // client-side-derived from child tasks and non-editable.
              const phaseToken = toToken(taskTick(p.title).status);
              return (
                <div key={p.phase_uid} style={S.phase}>
                  <div style={S.phaseId}>
                    {p.phase_id}
                    <StatusPicker
                      entityType="phase"
                      id={p.phase_uid}
                      current={phaseToken}
                      onChanged={reload}
                      onError={onError}
                    />
                    {p.valid_from && (
                      <span style={{ ...S.meta, marginLeft: 8 }}>{p.valid_from.slice(0, 10)}</span>
                    )}
                    {phaseTasks.length > 0 && (
                      <span style={{ ...S.meta, marginLeft: 6 }}>{t('lore.sprintDetail.phases.taskCount', '· {{count}} задач', { count: phaseTasks.length })}</span>
                    )}
                  </div>
                  {p.summary_md && <p style={S.phaseSummary}>{p.summary_md}</p>}
                  {phaseTasks.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {phaseTasks.map(tk => (
                        <TaskLine key={tk.task_uid} t={tk} allComps={allComps} onChanged={reload} onError={onError} />
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
            <div style={S.sectionLabel}>{t('lore.sprintDetail.tasks.sectionLabel', 'Задачи ({{count}})', { count: orphanTasks.length })}</div>
            {orphanTasks.map(tk => (
              <TaskLine key={tk.task_uid} t={tk} allComps={allComps} onChanged={reload} onError={onError} />
            ))}
          </div>
        )}

        {/* Effort footer */}
        {visibleTasks.length > 0 && (() => {
          const effortSum = visibleTasks.reduce((s, tk) => s + (tk.effort_days ?? 0), 0);
          const effortTotal = tasks.reduce((s, tk) => s + (tk.effort_days ?? 0), 0);
          if (effortSum === 0) return null;
          return (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--t3)' }}>
              <span>{t('lore.sprintDetail.effortFooter.label', 'Итого effort:')}</span>
              <b style={{ color: 'var(--acc)', fontFamily: 'var(--mono)' }}>{formatEffortDays(effortSum)}</b>
              {filter.size > 0 && effortTotal !== effortSum && (
                <span style={{ color: 'var(--t3)' }}>{t('lore.sprintDetail.effortFooter.ofTotalFmt', '/ {{total}} всего', { total: formatEffortDays(effortTotal) })}</span>
              )}
            </div>
          );
        })()}

        {/* Truly empty sprint */}
        {phases.length === 0 && tasks.length === 0 && (
          <div style={S.empty}>{t('lore.sprintDetail.tasks.emptyState', 'Задачи не заведены.')}</div>
        )}

        {/* Filter matched nothing (sprint has tasks, just none in the picked status) */}
        {filter.size > 0 && tasks.length > 0 && visibleTasks.length === 0 && (
          <div style={S.empty}>
            {t('lore.sprintDetail.tasks.filterEmpty', 'Нет задач с выбранными статусами.')}{' '}
            <button type="button" onClick={() => setFilter(new Set())}
              style={{ ...ghostBtn, padding: '1px 6px' }}>{t('lore.sprintDetail.tasks.resetFilter', 'сбросить фильтр')}</button>
          </div>
        )}

        <AddTaskForm sprintId={sprint.sprint_id} onAdded={reload} onError={onError} />

        {sprint.depends_on?.length ? (
          <div style={S.deps}>
            <div style={S.sectionLabel}>{t('lore.sprintDetail.deps.dependsOn', 'Зависит от')}</div>
            {sprint.depends_on.map(d => <RelatedSprintRow key={d} id={d} meta={relatedMeta.get(d)} onNavigate={onNavigateToSprint} />)}
          </div>
        ) : null}

        {sprint.blocks?.length ? (
          <div style={S.deps}>
            <div style={{ ...S.sectionLabel, color: 'var(--wrn)' }}>{t('lore.sprintDetail.deps.blocks', 'Блокирует')}</div>
            {sprint.blocks.map(d => <RelatedSprintRow key={d} id={d} meta={relatedMeta.get(d)} onNavigate={onNavigateToSprint} accent="var(--wrn)" />)}
          </div>
        ) : null}
      </div>
      </div>{/* END TASKS SECTION */}
    </div>
  );
}
