// LorePlanBoard — renders system_aida_lore plan data as a readable swimlane
// timeline (vis-timeline). Tracks → groups, plan items → range bars, milestones
// → boxes, releases → points, sections → background bands. Built-in zoom/pan
// (Ctrl+wheel zoom, wheel/drag pan) replaces the old hand-rolled Gantt canvas.
// Spec: PLAN_AS_DB_RENDER.md · write-path LAL-23a · time-travel LAL-25
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import type { TimelineOptions, TimelineItem, TimelineGroup } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import './lore-timeline.css';
import {
  fetchLoreSlice, postLoreStatus,
  type LorePlanConfig, type LorePlanTrack, type LorePlanSection,
  type LorePlanItem, type LorePlanCheckpoint, type LoreMilestone, type LoreRelease,
  type LorePlanItemStatus, type LorePlanVersion,
  type LoreSprintDoneDate, type LoreSprintTask,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';

// ── Status accent colours + cycle ────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  done:    'var(--suc)',
  active:  'var(--inf)',
  high:    'var(--wrn)',
  blocked: 'var(--danger)',
};

const STATUS_CYCLE: LorePlanItemStatus[] = ['todo', 'active', 'done'];
function cycleStatus(current: string | null): LorePlanItemStatus {
  const idx = STATUS_CYCLE.indexOf((current ?? 'todo') as LorePlanItemStatus);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

const MS_GROUP = '__ms__';
const UNTRACKED = '__untracked__';
const WEEK_MS = 7 * 86400 * 1000;
function addWeeks(base: Date, w: number): Date {
  return new Date(base.getTime() + w * WEEK_MS);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  onError: (e: unknown) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LorePlanBoard({ onError }: Props) {
  const [config,   setConfig]   = useState<LorePlanConfig | null>(null);
  const [tracks,   setTracks]   = useState<LorePlanTrack[]>([]);
  const [sections, setSections] = useState<LorePlanSection[]>([]);
  const [items,    setItems]    = useState<LorePlanItem[]>([]);
  const [cps,      setCps]      = useState<LorePlanCheckpoint[]>([]);
  const [mss,      setMss]      = useState<LoreMilestone[]>([]);
  const [releases, setReleases] = useState<LoreRelease[]>([]);
  const [versions, setVersions] = useState<LorePlanVersion[]>([]);
  const [doneBySprint, setDoneBySprint] = useState<Map<string, string>>(new Map());
  const [loading,  setLoading]  = useState(true);

  // ── Toggles ────────────────────────────────────────────────────────────────
  const [showDone,   setShowDone]   = useState(true);
  const [showActive, setShowActive] = useState(true);
  const [cropPast,   setCropPast]   = useState(false);

  // ── Time-travel (LAL-25) ───────────────────────────────────────────────────
  const [selectedVer, setSelectedVer] = useState('');

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [sprintCard, setSprintCard] = useState<LorePlanItem | null>(null);
  const [msPanel,    setMsPanel]    = useState<LoreMilestone | null>(null);

  // Tasks of the sprint behind the selected card (lazy, keyed by represents_sprint)
  const [cardTasks,        setCardTasks]        = useState<LoreSprintTask[]>([]);
  const [cardTasksLoading, setCardTasksLoading] = useState(false);
  const [cardSprintStatus, setCardSprintStatus] = useState<string | null>(null);
  const [cardReleases,     setCardReleases]     = useState<string[]>([]);

  // ── Timeline plumbing ────────────────────────────────────────────────────────
  const hostRef     = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const itemsDSRef  = useRef<DataSet<TimelineItem> | null>(null);
  // id → source object lookups for the select handler
  const itemByIdRef = useRef<Map<string, LorePlanItem>>(new Map());
  const msByIdRef   = useRef<Map<string, LoreMilestone>>(new Map());

  // ── Load all plan slices ─────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LorePlanConfig>('plan_config',      undefined, ctrl.signal),
      fetchLoreSlice<LorePlanTrack>('plan_tracks',       undefined, ctrl.signal),
      fetchLoreSlice<LorePlanSection>('plan_sections',   undefined, ctrl.signal),
      fetchLoreSlice<LorePlanItem>('plan_items',         undefined, ctrl.signal),
      fetchLoreSlice<LorePlanCheckpoint>('plan_checkpoints', undefined, ctrl.signal),
      fetchLoreSlice<LoreMilestone>('milestones',        undefined, ctrl.signal),
      fetchLoreSlice<LoreRelease>('releases',            undefined, ctrl.signal),
      fetchLoreSlice<LorePlanVersion>('plan_versions',   undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
    ])
      .then(([cfgs, trks, secs, its, chkps, milestones, rels, vers, dones]) => {
        setConfig(cfgs[0] ?? null);
        setTracks(trks);
        setSections(secs);
        setItems(its);
        setCps(chkps);
        setMss(milestones);
        setReleases(rels.filter(r => r.week != null));
        setVersions(vers);
        setDoneBySprint(new Map(
          dones.filter(d => d.done_date).map(d => [d.sprint_id, d.done_date as string])
        ));
        if (vers[0]) setSelectedVer(vers[0].version_id);
        setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // ── Lazy-load tasks of the sprint behind the selected card ───────────────────
  useEffect(() => {
    const sprintId = sprintCard?.represents_sprint;
    if (!sprintId) { setCardTasks([]); setCardSprintStatus(null); setCardReleases([]); return; }
    setCardTasksLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: sprintId }, ctrl.signal),
      fetchLoreSlice<{ status_raw: string | null; release_ids: string[] | null }>('sprint_tree', { id: sprintId }, ctrl.signal),
    ])
      .then(([tasks, trees]) => {
        setCardTasks(tasks);
        setCardSprintStatus(trees[0]?.status_raw ?? null);
        setCardReleases(trees[0]?.release_ids ?? []);
        setCardTasksLoading(false);
      })
      .catch(() => { setCardTasks([]); setCardTasksLoading(false); });
    return () => ctrl.abort();
  }, [sprintCard?.represents_sprint]);

  // ── Derived scalars ──────────────────────────────────────────────────────────
  const w0 = useMemo(() => config ? new Date(config.w0_date) : null, [config]);
  const W_NOW = w0 ? Math.round((Date.now() - w0.getTime()) / WEEK_MS) : 0;
  const nowLabel = useMemo(() => {
    if (!w0) return '';
    const d = addWeeks(w0, W_NOW);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }, [w0, W_NOW]);

  const itemsWithPos = items.filter(it => it.week_start != null && it.week_end != null).length;
  const parityPct    = items.length > 0 ? Math.round(itemsWithPos / items.length * 100) : 0;

  // Tracks that actually carry items (avoid a forest of empty swimlanes)
  const usedTracks = useMemo(() => {
    const ids = new Set(items.map(it => it.track_id ?? UNTRACKED));
    const list = tracks.filter(t => ids.has(t.track_id));
    if (ids.has(UNTRACKED)) list.push({ track_id: UNTRACKED, label: '— без дорожки —', type: null });
    return list;
  }, [tracks, items]);

  // ── Create the Timeline once data is loaded ──────────────────────────────────
  useEffect(() => {
    if (loading || !config || !w0 || !hostRef.current) return;

    const groups = new DataSet<TimelineGroup>([]);
    if (mss.length) {
      groups.add({ id: MS_GROUP, content: '◆ Вехи', order: -1 } as TimelineGroup);
    }
    usedTracks.forEach((tr, i) =>
      groups.add({ id: tr.track_id, content: tr.label, order: i } as TimelineGroup));

    const itemsDS = new DataSet<TimelineItem>([]);
    itemsDSRef.current = itemsDS;

    const options: TimelineOptions = {
      stack: true,
      orientation: { axis: 'top', item: 'top' },
      groupOrder: 'order',
      zoomMin: 3 * 86400 * 1000,           // 3 days
      zoomMax: 3 * 365 * 86400 * 1000,     // ~3 years
      margin: { item: { horizontal: 2, vertical: 4 }, axis: 6 },
      showCurrentTime: true,
      selectable: true,
      multiselect: false,
      horizontalScroll: true,
      verticalScroll: true,
      zoomKey: 'ctrlKey',
      maxHeight: '100%',
      tooltip: { followMouse: true, overflowMethod: 'flip' },
    };

    const tl = new Timeline(hostRef.current, itemsDS, groups, options);
    timelineRef.current = tl;

    // Initial window: w0 .. w0 + weeks_total, with a small lead-in
    const span = (config.weeks_total ?? 30) + 2;
    tl.setWindow(addWeeks(w0, -1), addWeeks(w0, span), { animation: false });

    tl.on('select', (props: { items: Array<string | number> }) => {
      const id = props.items[0];
      if (id == null) { setSprintCard(null); setMsPanel(null); return; }
      const sid = String(id);
      if (sid.startsWith('ms_')) {
        const ms = msByIdRef.current.get(sid.slice(3)) ?? null;
        setSprintCard(null); setMsPanel(ms);
      } else {
        const it = itemByIdRef.current.get(sid) ?? null;
        setMsPanel(null); setSprintCard(it);
      }
    });

    // vis measures the container at construction; under flex the real size only
    // resolves after layout, so redraw when the host's dimensions actually
    // change (guarded to avoid a scrollbar-flutter redraw loop).
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (Math.round(width) === lastW && Math.round(height) === lastH) return;
      lastW = Math.round(width); lastH = Math.round(height);
      tl.redraw();
    });
    ro.observe(hostRef.current);

    return () => { ro.disconnect(); tl.destroy(); timelineRef.current = null; itemsDSRef.current = null; };
    // Re-create only when the structural inputs change.
  }, [loading, config, w0, usedTracks, mss.length, releases.length]);

  // ── (Re)populate items whenever data / toggles change ────────────────────────
  useEffect(() => {
    const ds = itemsDSRef.current;
    if (!ds || !w0) return;

    const itemById = new Map<string, LorePlanItem>();
    const msById   = new Map<string, LoreMilestone>();
    const next: TimelineItem[] = [];

    // Section background bands
    for (const sec of sections) {
      next.push({
        id: 'sec_' + sec.section_id,
        content: sec.label,
        start: addWeeks(w0, sec.start_week),
        end:   addWeeks(w0, sec.end_week),
        type: 'background',
        className: 'sec',
        style: `background-color:${sec.color}14;border-color:${sec.color}40;`,
      } as TimelineItem);
    }

    // Plan-item bars
    for (const item of items) {
      const ws = item.week_start;
      const we = item.week_end;
      if (ws == null || we == null) continue;                 // unpositioned → skip
      if (cropPast && we < W_NOW) continue;
      const isDone = item.status === 'done';
      if (!showDone && isDone) continue;
      if (!showActive && !isDone) continue;

      itemById.set(item.item_id, item);

      // Actual close week from the sprint's SCD2 done-date, when known
      const doneIso = isDone && item.represents_sprint
        ? doneBySprint.get(item.represents_sprint) : undefined;
      const weAct = doneIso != null
        ? Math.max(ws + 1, Math.round((new Date(doneIso).getTime() - w0.getTime()) / WEEK_MS))
        : we;
      const end = Math.max(ws + 1, weAct);
      const bg  = item.bar_color ?? 'var(--acc)';
      const outline = STATUS_COLOR[item.status ?? ''] ?? bg;

      next.push({
        id: item.item_id,
        group: item.track_id ?? UNTRACKED,
        content: cleanLabel(item.label),
        start: addWeeks(w0, ws),
        end:   addWeeks(w0, end),
        type: 'range',
        className: 'it' + (isDone ? ' done' : ''),
        style: `background-color:${bg};border-color:${outline};`,
        title: `${item.label}\nплан W${ws}–${we}`
          + (doneIso != null ? `\nфакт закрытия W${weAct}` : '')
          + (item.represents_sprint ? `\n${item.represents_sprint}` : '')
          + (item.status ? `\nстатус: ${item.status}` : ''),
      } as TimelineItem);
    }

    // Milestones (box) + their checkpoints count in the tooltip
    for (const ms of mss) {
      if (ms.week == null) continue;
      msById.set(ms.milestone_id, ms);
      const grp = cps.filter(c => c.milestone === ms.milestone_id);
      next.push({
        id: 'ms_' + ms.milestone_id,
        group: MS_GROUP,
        content: ms.milestone_id,
        start: addWeeks(w0, ms.week),
        type: 'box',
        className: 'ms',
        title: `${ms.milestone_id}: ${ms.label}\nW${ms.week}${ms.date_display ? ' · ' + ms.date_display : ''}`
          + (grp.length ? `\n⚑ ${grp.length} плашек` : ''),
      } as TimelineItem);
    }

    // Releases → thin vertical guide-lines spanning every track (background,
    // no group). A swimlane of 71 stacked points would dwarf the real tracks.
    for (const rel of releases) {
      if (rel.week == null) continue;
      const at = addWeeks(w0, rel.week);
      next.push({
        id: 'rel_' + rel.release_id,
        start: at,
        end: new Date(at.getTime() + WEEK_MS * 0.12),
        type: 'background',
        className: 'rel' + (rel.is_current ? ' cur' : ''),
        title: `${rel.git_tag ?? rel.release_id}\nW${rel.week}${rel.release_date ? ' · ' + rel.release_date.slice(0, 10) : ''}`,
      } as TimelineItem);
    }

    itemByIdRef.current = itemById;
    msByIdRef.current   = msById;
    ds.clear();
    ds.add(next);
  }, [items, sections, mss, cps, releases, doneBySprint, w0,
      showDone, showActive, cropPast, W_NOW]);

  // ── Status cycling helper (panel button) ─────────────────────────────────────
  function applyStatusCycle(target: LorePlanItem) {
    const newStatus = cycleStatus(target.status);
    const prevStatus = target.status;
    setItems(prev => prev.map(it =>
      it.item_id === target.item_id ? { ...it, status: newStatus } : it));
    setSprintCard(prev => prev && prev.item_id === target.item_id
      ? { ...prev, status: newStatus } : prev);
    postLoreStatus('plan_item', target.item_id, newStatus).catch(err => {
      console.error('[lore status cycle]', err);
      setItems(prev => prev.map(it =>
        it.item_id === target.item_id ? { ...it, status: prevStatus } : it));
      setSprintCard(prev => prev && prev.item_id === target.item_id
        ? { ...prev, status: prevStatus } : prev);
    });
  }

  if (loading) return <div style={S.empty}>Loading plan…</div>;
  if (!config)  return <div style={S.empty}>Plan config not found in system_aida_lore.</div>;

  const shownBars = items.filter(it => {
    if (it.week_start == null || it.week_end == null) return false;
    if (cropPast && it.week_end < W_NOW) return false;
    const isDone = it.status === 'done';
    if (!showDone && isDone) return false;
    if (!showActive && !isDone) return false;
    return true;
  }).length;

  return (
    <div style={S.root}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <Tog active={showActive} onClick={() => setShowActive(v => !v)}>Активные</Tog>
        <Tog active={showDone}   onClick={() => setShowDone(v => !v)}>Done</Tog>
        <Tog active={!cropPast}  onClick={() => setCropPast(v => !v)}>Прошлые</Tog>
        <button style={S.btn} onClick={() => timelineRef.current?.fit({ animation: true })}>
          Уместить
        </button>
        <button style={S.btn} onClick={() => {
          if (!w0) return;
          timelineRef.current?.moveTo(addWeeks(w0, W_NOW), { animation: true });
        }}>
          Сегодня
        </button>

        <span style={{ flex: 1 }} />

        <span style={S.stat}>{shownBars} / {items.length} баров · {usedTracks.length} дорожек</span>

        {versions.length > 0 && (
          <select
            value={selectedVer}
            onChange={e => setSelectedVer(e.target.value)}
            style={S.verSel}
            title="Версия плана (time-travel LAL-25)"
          >
            {versions.map(v => (
              <option key={v.version_id} value={v.version_id}>
                {v.version_id}{v.version_date ? ' · ' + v.version_date.slice(0, 10) : ''}
              </option>
            ))}
          </select>
        )}

        <span
          style={{ ...S.zlabel, color: 'var(--acc)', opacity: 0.85, fontWeight: 600 }}
          title={`Текущая неделя плана (W0 = ${config.w0_date})`}
        >
          W{W_NOW} · {nowLabel}
        </span>
        <span style={S.stat} title="Паритет: доля баров с позицией (SAGA↔план)">
          {parityPct}% parity
        </span>
        <span style={{ ...S.zlabel, opacity: 0.6 }}>Ctrl+колесо = зум</span>
      </div>

      {/* ── Main: timeline host + side panel ───────────────────────────────── */}
      <div style={S.main}>
        <div ref={hostRef} className="lore-tl" style={S.host} />

        {/* Sprint card panel */}
        {sprintCard && (
          <div style={S.panel}>
            <div style={S.panelHdr}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 12,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sprintCard.label}
              </span>
              <button style={S.closeBtn} onClick={() => setSprintCard(null)}>✕</button>
            </div>
            <div style={S.panelBody}>
              <PRow k="ID"     v={sprintCard.item_id} />
              {sprintCard.represents_sprint && (
                <PRow k="Sprint" v={sprintCard.represents_sprint} color="var(--acc)" />
              )}
              {(sprintCard.week_start != null || sprintCard.week_end != null) && (
                <PRow k="Weeks"  v={`W${sprintCard.week_start ?? '?'}–${sprintCard.week_end ?? '?'}`} />
              )}
              {sprintCard.track_id && (
                <PRow k="Track"
                  v={tracks.find(t => t.track_id === sprintCard.track_id)?.label ?? sprintCard.track_id} />
              )}
              {cardReleases.length > 0 && (
                <PRow k="Релиз" v={cardReleases.join(', ')} color="var(--acc)" />
              )}

              {/* Status cycling badge */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>Статус</div>
                <button
                  onClick={() => applyStatusCycle(sprintCard)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
                    fontSize: 11, fontWeight: 600,
                    background: 'color-mix(in srgb, ' +
                      (STATUS_COLOR[sprintCard.status ?? ''] ?? 'var(--acc)') + ' 18%, transparent)',
                    color: STATUS_COLOR[sprintCard.status ?? ''] ?? 'var(--t2)',
                    border: '1px solid ' + (STATUS_COLOR[sprintCard.status ?? ''] ?? 'var(--b3)'),
                  }}
                >
                  {sprintCard.status ?? 'todo'}
                  <span style={{ opacity: 0.7, fontSize: 9 }}>
                    → {cycleStatus(sprintCard.status)}
                  </span>
                </button>
              </div>

              {/* Tasks of the represented sprint */}
              {sprintCard.represents_sprint && (
                <div style={{ marginTop: 14 }}>
                  {(() => {
                    const total = cardTasks.length;
                    const done  = cardTasks.filter(t => taskTick(t.status_raw).done).length;
                    return (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--t3)' }}>Задачи</span>
                        {total > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--t2)' }}>{done}/{total}</span>
                        )}
                        {cardSprintStatus && (
                          <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 'auto',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}
                            title={cardSprintStatus}>
                            {cardSprintStatus}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {cardTasksLoading && <div style={{ fontSize: 11, color: 'var(--t3)' }}>Загрузка…</div>}
                  {!cardTasksLoading && cardTasks.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Задачи не заведены.</div>
                  )}
                  {!cardTasksLoading && cardTasks.map(t => {
                    const meta = statusMeta(taskTick(t.status_raw).status);
                    return (
                      <div key={t.task_uid} style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 11, lineHeight: 1.7, color: 'var(--t2)',
                      }}>
                        <GameIcon slug={meta.icon} size={12} style={{ color: meta.color }} />
                        <span style={{ color: 'var(--acc)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                          {t.task_id}
                        </span>
                        {t.title && <span style={{ color: 'var(--t1)' }}>{t.title}</span>}
                        {t.effort_days != null && (
                          <span style={{ color: 'var(--t3)', fontSize: 9, marginLeft: 'auto' }}>{t.effort_days}d</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Milestone panel — "Что закрыть" */}
        {msPanel && (
          <div style={S.panel}>
            <div style={S.panelHdr}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 12, color: 'var(--acc)' }}>
                {msPanel.milestone_id} · {msPanel.label}
              </span>
              <button style={S.closeBtn} onClick={() => setMsPanel(null)}>✕</button>
            </div>
            <div style={S.panelBody}>
              {msPanel.date_display && (
                <div style={{ color: 'var(--t3)', marginBottom: 10, fontSize: 11 }}>
                  W{msPanel.week} · {msPanel.date_display}
                </div>
              )}
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11 }}>Что закрыть:</div>
              {renderMsGroups(msPanel, items, cps, setMsPanel, setSprintCard)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

// Strip emoji (renders as boxes/CJK at small sizes on some systems)
function cleanLabel(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// Infer status from label when HAS_STATUS edges are not populated (LAL-23a deferred)
function inferStatus(item: LorePlanItem): string {
  if (item.status) return item.status;
  const l = item.label ?? '';
  if (/DONE|✅|CLOSED|FINISHED/i.test(l)) return 'done';
  if (/ACTIVE|IN.?PROGRESS|WIP/i.test(l)) return 'active';
  if (/PARTIAL|ЧАСТИЧ|🟡/i.test(l)) return 'partial';
  if (/BACKLOG|postpone|ОТЛОЖЕН|blocked|DEFERRED/i.test(l)) return 'blocked';
  return 'todo';
}

function renderMsGroups(
  ms: LoreMilestone,
  items: LorePlanItem[],
  cps: LorePlanCheckpoint[],
  setMsPanel: (m: LoreMilestone | null) => void,
  setSprintCard: (i: LorePlanItem | null) => void,
) {
  const msItems = items.filter(it => it.milestone_id === ms.milestone_id);
  const grouped = new Map<string, LorePlanItem[]>();
  for (const item of msItems) {
    const st = inferStatus(item);
    if (!grouped.has(st)) grouped.set(st, []);
    grouped.get(st)!.push(item);
  }
  const msCps = cps.filter(cp => cp.milestone === ms.milestone_id);
  return (
    <>
      {msItems.length === 0 && msCps.length === 0 && (
        <div style={{ color: 'var(--t3)', fontSize: 11, padding: '4px 0' }}>
          Нет связанных задач.
        </div>
      )}
      {[...grouped.entries()].map(([st, grp]) => (
        <div key={st} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            color: STATUS_COLOR[st] ?? 'var(--t3)', marginBottom: 3 }}>
            {st} ({grp.length})
          </div>
          {grp.map(it => (
            <div key={it.item_id}
              onClick={() => { setMsPanel(null); setSprintCard(it); }}
              style={{ paddingLeft: 8, color: 'var(--t2)', lineHeight: '1.7',
                fontSize: 11, cursor: 'pointer' }}>
              · {cleanLabel(it.label)}
            </div>
          ))}
        </div>
      ))}
      {msCps.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            color: 'var(--acc)', marginBottom: 3 }}>
            Плашки ({msCps.length})
          </div>
          {msCps.map(cp => (
            <div key={cp.checkpoint_id}
              title={cp.desc_md ?? ''}
              style={{ paddingLeft: 8, color: 'var(--t2)', lineHeight: '1.7', fontSize: 10 }}>
              ✓ {cp.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Tog({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      height: 22, padding: '0 8px',
      border: '1px solid var(--b3)', borderRadius: 3,
      fontSize: 10, cursor: 'pointer',
      background: active ? 'color-mix(in srgb, var(--acc) 20%, transparent)' : 'var(--b2)',
      color: active ? 'var(--acc)' : 'var(--t3)',
    }}>
      {children}
    </button>
  );
}

function PRow({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 11 }}>
      <span style={{ color: 'var(--t3)', minWidth: 52, flexShrink: 0 }}>{k}</span>
      <span style={{ color: color ?? 'var(--t1)', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    flex: 1, overflow: 'hidden', minWidth: 0,
    display: 'flex', flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
    padding: '5px 12px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  btn: {
    height: 22, padding: '0 8px',
    border: '1px solid var(--b3)', borderRadius: 3,
    fontSize: 10, cursor: 'pointer',
    background: 'var(--b2)', color: 'var(--t2)',
  },
  zlabel: { fontSize: 10, color: 'var(--t3)' },
  stat:   { fontSize: 10, color: 'var(--t3)' },
  verSel: {
    height: 22, padding: '0 6px', fontSize: 10,
    border: '1px solid var(--b3)', borderRadius: 3,
    background: 'var(--b2)', color: 'var(--t2)',
    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
    maxWidth: 200,
  },
  main: {
    flex: 1, display: 'flex', overflow: 'hidden',
    position: 'relative' as const, minWidth: 0,
  },
  host: { flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' },
  panel: {
    width: 272, flexShrink: 0,
    borderLeft: '1px solid var(--b2)',
    background: 'var(--b1)', overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const,
  },
  panelHdr: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '8px 12px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  panelBody: { padding: '10px 12px', overflowY: 'auto' as const, flex: 1 },
  closeBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--t3)', fontSize: 12, padding: '0 4px',
  },
};
