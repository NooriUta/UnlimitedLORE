// GanttCanvas — renders system_aida_lore plan data as a Gantt chart.
// Spec: PLAN_AS_DB_RENDER.md v1.1 · LAL-23 · write-path LAL-23a · time-travel LAL-25
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchLoreSlice, postLoreStatus,
  type LorePlanConfig, type LorePlanTrack, type LorePlanSection,
  type LorePlanItem, type LorePlanCheckpoint, type LoreMilestone, type LoreRelease,
  type LorePlanItemStatus, type LorePlanVersion,
  type LoreSprintDoneDate, type LoreSprintTask,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';

// ── Layout constants ──────────────────────────────────────────────────────────
const LABEL_W = 156;
const ROW_H   = 22;
const MS_H    = 30;
const HDR_H   = 20;

// ── Status accent colours + cycle ────────────────────────────────────────────
// Theme + palette aware: reuse the semantic design tokens (tokens.css). Only these
// four keys carry an outline colour; todo/null intentionally has none.
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

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function addWeeks(base: Date, w: number): Date {
  return new Date(base.getTime() + w * 7 * 86400 * 1000);
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
  const [showCps,    setShowCps]    = useState(true);
  const [W,          setW]          = useState(() => {
    // Auto-fit initial zoom to fill available chart area (sidebar ≈148, labels=156)
    const approxChartPx = window.innerWidth - 148 - LABEL_W;
    return Math.max(8, Math.min(40, Math.floor(approxChartPx / 32)));
  });

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

  // ── Synced scroll ──────────────────────────────────────────────────────────
  const labelsRef = useRef<HTMLDivElement>(null);
  const chartRef  = useRef<HTMLDivElement>(null);

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

  // Lazy-load tasks of the sprint behind the selected card
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

  // ── Status cycling (Shift+click, LAL-23a) ──────────────────────────────────
  function handleStatusCycle(item: LorePlanItem, e: React.MouseEvent): boolean {
    if (!e.shiftKey) return false;
    e.stopPropagation();
    const newStatus = cycleStatus(item.status);
    setItems(prev => prev.map(it =>
      it.item_id === item.item_id ? { ...it, status: newStatus } : it
    ));
    if (sprintCard?.item_id === item.item_id) {
      setSprintCard(prev => prev ? { ...prev, status: newStatus } : prev);
    }
    postLoreStatus('plan_item', item.item_id, newStatus).catch(err => {
      console.error('[lore status cycle]', err);
      setItems(prev => prev.map(it =>
        it.item_id === item.item_id ? { ...it, status: item.status } : it
      ));
      if (sprintCard?.item_id === item.item_id) {
        setSprintCard(prev => prev ? { ...prev, status: item.status } : prev);
      }
    });
    return true;
  }

  const handleChartScroll = () => {
    if (labelsRef.current && chartRef.current)
      labelsRef.current.scrollTop = chartRef.current.scrollTop;
  };

  if (loading) return <div style={S.empty}>Loading plan…</div>;
  if (!config)  return <div style={S.empty}>Plan config not found in system_aida_lore.</div>;

  // ── Derived ────────────────────────────────────────────────────────────────
  const w0         = new Date(config.w0_date);
  const totalWeeks = (config.weeks_total ?? 30) + 2;
  const chartW     = totalWeeks * W;
  const W_NOW      = Math.round((Date.now() - w0.getTime()) / (7 * 86400 * 1000));
  const nowDate    = addWeeks(w0, W_NOW);
  const nowLabel   = `${nowDate.getDate()} ${MONTHS[nowDate.getMonth()]}`;

  // Parity: fraction of items with position data (SAGA coverage vs plan)
  const itemsWithPos = items.filter(it => it.week_start != null && it.week_end != null).length;
  const parityPct    = items.length > 0 ? Math.round(itemsWithPos / items.length * 100) : 0;

  const visibleItems = items.filter(item => {
    if (cropPast && (item.week_end ?? 0) < W_NOW) return false;
    const isDone = item.status === 'done';
    if (!showDone && isDone)   return false;
    if (!showActive && !isDone) return false;
    return true;
  });

  const itemsByTrack = new Map<string, LorePlanItem[]>();
  for (const item of visibleItems) {
    const tid = item.track_id ?? '__untracked__';
    if (!itemsByTrack.has(tid)) itemsByTrack.set(tid, []);
    itemsByTrack.get(tid)!.push(item);
  }

  // Lane assignment: parallel items on one track stack into sub-lanes
  // (greedy first-fit by week_start), the track row grows to fit all lanes.
  const trackLayout = new Map<string, { placed: { item: LorePlanItem; lane: number }[]; lanes: number }>();
  for (const tr of tracks) {
    const rowItems = [...(itemsByTrack.get(tr.track_id) ?? [])]
      .sort((a, b) => (a.week_start ?? 0) - (b.week_start ?? 0));
    const laneEnds: number[] = [];
    const placed: { item: LorePlanItem; lane: number }[] = [];
    for (const item of rowItems) {
      const ws = item.week_start ?? 0;
      const we = Math.max(item.week_end ?? ws + 1, ws + 1);
      let lane = laneEnds.findIndex(end => end <= ws);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(we); }
      else laneEnds[lane] = we;
      placed.push({ item, lane });
    }
    trackLayout.set(tr.track_id, { placed, lanes: Math.max(1, laneEnds.length) });
  }

  // Cumulative row tops (rows have variable height once lanes > 1)
  const trackTops = new Map<string, number>();
  let yCursor = 0;
  for (const tr of tracks) {
    trackTops.set(tr.track_id, yCursor);
    yCursor += (trackLayout.get(tr.track_id)?.lanes ?? 1) * ROW_H;
  }
  const tracksH = yCursor;

  // Month ticks for week header
  const monthTicks: { x: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < totalWeeks; w += 1) {
    const d = addWeeks(w0, w);
    const m = d.getMonth();
    if (m !== lastMonth) {
      monthTicks.push({ x: w * W, label: `${MONTHS[m]} ${d.getFullYear()}` });
      lastMonth = m;
    }
  }

  // Checkpoints grouped per milestone — strip shows a count badge, full list in panel
  const cpsByMs = new Map<string, LorePlanCheckpoint[]>();
  for (const cp of cps) {
    if (!cp.milestone) continue;
    if (!cpsByMs.has(cp.milestone)) cpsByMs.set(cp.milestone, []);
    cpsByMs.get(cp.milestone)!.push(cp);
  }

  const totalH = MS_H + HDR_H + tracksH;

  return (
    <div style={S.root}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <Tog active={showActive} onClick={() => setShowActive(v => !v)}>Активные</Tog>
        <Tog active={showDone}   onClick={() => setShowDone(v => !v)}>Done</Tog>
        <Tog active={!cropPast}  onClick={() => setCropPast(v => !v)}>Прошлые</Tog>
        <Tog active={showCps}    onClick={() => setShowCps(v => !v)}>Плашки</Tog>
        <span style={{ flex: 1 }} />
        <span style={S.zlabel}>Zoom</span>
        <input type="range" min={6} max={40} step={1} value={W}
          onChange={e => setW(Number(e.target.value))}
          style={{ width: 72, cursor: 'pointer', accentColor: 'var(--acc)' }} />
        <span style={S.zlabel}>{W}px/w</span>
        <span style={{ flex: 1 }} />
        <span style={S.stat}>{visibleItems.length} / {items.length} баров · {tracks.length} дорожек</span>

        {/* Time-travel version selector (LAL-25) */}
        {versions.length > 0 && (
          <select
            value={selectedVer}
            onChange={e => setSelectedVer(e.target.value)}
            style={S.verSel}
            title="Версия плана (time-travel LAL-25)"
          >
            {versions.map(v => (
              <option key={v.version_id} value={v.version_id}>
                {v.version_id}
                {v.version_date ? ' · ' + v.version_date.slice(0, 10) : ''}
              </option>
            ))}
          </select>
        )}

        {/* Parity indicator: current week + position coverage (LAL-25) */}
        <span
          style={{ ...S.zlabel, color: 'var(--acc)', opacity: 0.8, fontWeight: 600 }}
          title={`Текущая неделя плана (W0 = ${config.w0_date})`}
        >
          W{W_NOW} · {nowLabel}
        </span>
        <span style={S.stat} title="Паритет: доля баров с позицией (SAGA↔план)">
          {parityPct}% parity
        </span>

        <span style={{ ...S.zlabel, opacity: 0.6 }}>⇧+click = цикл статуса</span>
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div style={S.main}>

        {/* Track labels (left, fixed) */}
        <div ref={labelsRef} style={S.labels}>
          <div style={{ height: MS_H + HDR_H, flexShrink: 0 }} />
          {tracks.map(tr => (
            <div key={tr.track_id}
              style={{ ...S.labelRow, height: (trackLayout.get(tr.track_id)?.lanes ?? 1) * ROW_H }}
              title={tr.label}>
              <span style={S.labelText}>{tr.label}</span>
            </div>
          ))}
        </div>

        {/* Scrollable chart area */}
        <div ref={chartRef} style={S.chartScroll} onScroll={handleChartScroll}>
          <div style={{ position: 'relative', width: chartW, height: totalH, minHeight: '100%' }}>

            {/* Section background bands */}
            {sections.map(sec => (
              <div key={sec.section_id} style={{
                position: 'absolute',
                left: sec.start_week * W,
                width: Math.max(0, (sec.end_week - sec.start_week) * W),
                top: MS_H + HDR_H, height: tracksH,
                background: sec.color + '14',
                borderLeft: `1px solid ${sec.color}28`,
                pointerEvents: 'none',
              }} />
            ))}

            {/* Current-week indicator */}
            {W_NOW >= 0 && W_NOW <= totalWeeks && (
              <div style={{
                position: 'absolute', left: W_NOW * W, top: 0,
                width: 1, height: totalH,
                background: '#ef535040', pointerEvents: 'none', zIndex: 1,
              }} />
            )}

            {/* Release markers */}
            {releases.map(rel => rel.week == null ? null : (
              <div key={rel.release_id}
                title={`${rel.git_tag ?? rel.release_id} · W${rel.week}`}
                style={{
                  position: 'absolute', left: rel.week * W, top: MS_H,
                  width: 1, height: HDR_H + tracksH,
                  background: rel.is_current
                    ? 'color-mix(in srgb, var(--wrn) 45%, transparent)'
                    : 'color-mix(in srgb, var(--t1) 8%, transparent)',
                  pointerEvents: 'none',
                }} />
            ))}

            {/* Week / month header */}
            <div style={{
              position: 'absolute', top: MS_H, left: 0,
              height: HDR_H, width: chartW,
              borderBottom: '1px solid var(--b2)',
            }}>
              {monthTicks.map(t => (
                <span key={t.x} style={{
                  position: 'absolute', left: t.x + 3, top: 4,
                  fontSize: 9, color: 'var(--t3)', whiteSpace: 'nowrap',
                }}>
                  {t.label}
                </span>
              ))}
            </div>

            {/* Milestone strip */}
            <div style={{
              position: 'absolute', top: 0, left: 0,
              height: MS_H, width: chartW,
              borderBottom: '1px solid var(--b2)',
            }}>
              {mss.map(ms => {
                if (ms.week == null) return null;
                const x = ms.week * W;
                const active = msPanel?.milestone_id === ms.milestone_id;
                return (
                  <div key={ms.milestone_id} style={{ position: 'absolute', left: x }}>
                    {/* Diamond marker */}
                    <div
                      onClick={() => { setSprintCard(null); setMsPanel(active ? null : ms); }}
                      title={`${ms.milestone_id}: ${ms.label}\nW${ms.week} · ${ms.date_display ?? ''}`}
                      style={{
                        position: 'absolute', top: 8, left: -5,
                        width: 10, height: 10,
                        background: active ? 'var(--acc)' : 'var(--b3)',
                        border: '2px solid var(--acc)',
                        transform: 'rotate(45deg)',
                        borderRadius: 1, cursor: 'pointer', zIndex: 2,
                      }}
                    />
                    <span style={{
                      position: 'absolute', top: 4, left: 8,
                      fontSize: 9, color: 'var(--acc)',
                      whiteSpace: 'nowrap', pointerEvents: 'none',
                    }}>
                      {ms.milestone_id}
                    </span>
                  </div>
                );
              })}

              {/* Checkpoint count badges — one per milestone, list opens in panel */}
              {showCps && [...cpsByMs.entries()].map(([msId, grp]) => {
                const ms = mss.find(m => m.milestone_id === msId);
                if (ms?.week == null) return null;
                return (
                  <div key={msId}
                    onClick={() => { setSprintCard(null); setMsPanel(ms); }}
                    title={grp.map(c => '✓ ' + c.label).join('\n')}
                    style={{
                      position: 'absolute', left: ms.week * W - 5, top: 19,
                      fontSize: 8, lineHeight: '10px', padding: '0 4px', borderRadius: 2,
                      background: 'color-mix(in srgb, var(--acc) 15%, transparent)',
                      color: 'var(--acc)', whiteSpace: 'nowrap', cursor: 'pointer',
                      zIndex: 2,
                    }}
                  >
                    ⚑{grp.length}
                  </div>
                );
              })}
            </div>

            {/* Track rows with bars */}
            {tracks.map(tr => {
              const layout = trackLayout.get(tr.track_id);
              const rowH   = (layout?.lanes ?? 1) * ROW_H;
              return (
                <div key={tr.track_id} style={{
                  position: 'absolute',
                  top: MS_H + HDR_H + (trackTops.get(tr.track_id) ?? 0),
                  left: 0, width: chartW, height: rowH,
                  borderBottom: '1px solid var(--b2)',
                }}>
                  {(layout?.placed ?? []).map(({ item, lane }) => {
                    const ws      = item.week_start ?? 0;
                    const wePlan  = item.week_end   ?? ws + 1;
                    const isDone  = item.status === 'done';
                    // Actual close week from the sprint's SCD2 done-date, when known.
                    const doneIso = isDone && item.represents_sprint
                      ? doneBySprint.get(item.represents_sprint) : undefined;
                    const weAct   = doneIso != null
                      ? Math.max(ws + 1, Math.round((new Date(doneIso).getTime() - w0.getTime()) / (7 * 86400 * 1000)))
                      : null;
                    const we      = weAct ?? wePlan;
                    const barW    = Math.max(4, (we - ws) * W - 2);
                    const showGhost = weAct != null && Math.abs(weAct - wePlan) >= 1;
                    const outline = STATUS_COLOR[item.status ?? ''];
                    const isSelected = sprintCard?.item_id === item.item_id;
                    const top = lane * ROW_H + 3;
                    const tip = `${item.label}\nплан W${ws}–${wePlan}`
                      + (weAct != null ? `\nфакт закрытия W${weAct}` : '')
                      + (item.represents_sprint ? `\n${item.represents_sprint}` : '')
                      + `\n⇧+click → цикл статуса`;
                    return (
                      <Fragment key={item.item_id}>
                        {/* Planned-span ghost when actual close differs from plan */}
                        {showGhost && (
                          <div style={{
                            position: 'absolute',
                            left: ws * W + 1, top,
                            width: Math.max(4, (wePlan - ws) * W - 2), height: ROW_H - 6,
                            border: '1px dashed var(--t3)', borderRadius: 2,
                            opacity: 0.5, pointerEvents: 'none', boxSizing: 'border-box',
                          }} />
                        )}
                        <div
                          onClick={(e) => {
                            if (handleStatusCycle(item, e)) return;
                            setMsPanel(null);
                            setSprintCard(isSelected ? null : item);
                          }}
                          title={tip}
                          style={{
                            position: 'absolute',
                            left: ws * W + 1, top,
                            width: barW, height: ROW_H - 6,
                            background: item.bar_color ?? 'var(--acc)',
                            opacity: isDone ? 0.45 : 1,
                            borderRadius: 2,
                            outline: isSelected
                              ? '2px solid var(--acc)'
                              : outline ? `1px solid ${outline}` : 'none',
                            cursor: 'pointer', overflow: 'hidden',
                            display: 'flex', alignItems: 'center',
                            boxSizing: 'border-box', zIndex: 1,
                          }}
                        >
                          {barW > 32 && (
                            <span style={{
                              fontSize: 8, paddingLeft: 3,
                              whiteSpace: 'nowrap', overflow: 'hidden',
                              color: '#fff', textShadow: '0 0 4px #0006',
                              userSelect: 'none', pointerEvents: 'none',
                            }}>
                              {cleanLabel(item.label)}
                            </span>
                          )}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              );
            })}

          </div>
        </div>

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
                <PRow k="Sprint" v={sprintCard.represents_sprint}
                  color="var(--acc)" />
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
                  onClick={() => {
                    const newStatus = cycleStatus(sprintCard.status);
                    const updated = { ...sprintCard, status: newStatus };
                    setSprintCard(updated);
                    setItems(prev => prev.map(it =>
                      it.item_id === sprintCard.item_id ? { ...it, status: newStatus } : it
                    ));
                    postLoreStatus('plan_item', sprintCard.item_id, newStatus).catch(err => {
                      console.error('[lore status panel]', err);
                      setSprintCard(sprintCard);
                      setItems(prev => prev.map(it =>
                        it.item_id === sprintCard.item_id ? { ...it, status: sprintCard.status } : it
                      ));
                    });
                  }}
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
  // Items linked to this milestone via milestone_id field (from CONTRIBUTES_TO edge)
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
  labels: {
    width: LABEL_W, flexShrink: 0,
    overflowY: 'hidden' as const, overflowX: 'hidden' as const,
    borderRight: '1px solid var(--b2)',
    display: 'flex', flexDirection: 'column' as const,
  },
  labelRow: {
    height: ROW_H, display: 'flex', alignItems: 'center',
    padding: '0 8px', borderBottom: '1px solid var(--b2)',
    flexShrink: 0,
  },
  labelText: {
    fontSize: 10, color: 'var(--t2)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  chartScroll: {
    flex: 1, minWidth: 0,
    overflowX: 'auto' as const, overflowY: 'auto' as const,
  },
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
