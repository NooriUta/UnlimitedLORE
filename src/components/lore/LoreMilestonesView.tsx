import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchLoreSlice, linkSprintMilestone, upsertMilestone, createLoreTask,
  type LoreMilestone, type LoreSprintRow, type LoreSprintDoneDate, type LoreSprintTask,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta } from './lore-status';
import LoreSkeleton from './LoreSkeleton';
import TipTapField from './TipTapField';

const TODAY = new Date();
const RU_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const RU_MONTHS: Record<string, number> = {
  'янв': 0, 'фев': 1, 'мар': 2, 'апр': 3, 'май': 4, 'мая': 4, 'июн': 5,
  'июл': 6, 'авг': 7, 'сен': 8, 'окт': 9, 'ноя': 10, 'дек': 11,
};
const PRIORITIES = ['', 'P0', 'P1', 'P2', 'P3'];
function daysLeftOf(dd: string | null | undefined): number | null {
  const m = (dd ?? '').match(/(\d+)\s+([а-я]+)/i);
  if (!m) return null;
  const mo = RU_MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (mo === undefined) return null;
  return Math.round((new Date(2026, mo, parseInt(m[1])).getTime() - TODAY.getTime()) / 86400000);
}
function fmtRuDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${parseInt(m[3])} ${RU_MON[parseInt(m[2]) - 1]}` : iso;
}
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
}
function isDone(s: LoreSprintRow): boolean {
  return /DONE|CLOSED|ЗАВЕРШ|✅/i.test(s.status_raw ?? '') || !!s.done_date;
}
function classify(s: string | null): string {
  const u = (s ?? '').toUpperCase();
  if (/DONE|CLOSED|ЗАВЕРШ|✅/.test(u)) return 'done';
  if (/PROGRESS|WIP/.test(u))          return 'in_progress';
  if (/BLOCK|ЗАБЛОК/.test(u))          return 'blocked';
  if (/CANCEL|ОТМЕН/.test(u))          return 'cancelled';
  if (/PARTIAL|ЧАСТИЧ/.test(u))        return 'partial';
  if (/PLAN/.test(u))                  return 'planned';
  return 'todo';
}
const projShort = (p: string | null | undefined) => (p ?? '').split('/').pop() ?? '';

// tasks_of_sprints_batch passes sprint_ids in the URL — too long for big milestones.
// Fetch in chunks of 20 and merge so even 60-sprint milestones load their tasks.
async function fetchTasksChunked(ids: string[]): Promise<(LoreSprintTask & { sprint_id: string })[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  const results = await Promise.all(chunks.map(c =>
    fetchLoreSlice<LoreSprintTask & { sprint_id: string }>('tasks_of_sprints_batch', { sprint_ids: c.join(',') }).catch(() => [])));
  return results.flat();
}

// SPRINT_PLANITEM_RETIRE (T-21): "planned" ids no longer come from the
// backend slice (retired PlanItem hop) — callers pass the pre-computed
// per-milestone list derived from the already-fetched `sprints` state
// (see plannedByMilestone below), keeping this a pure function.
function msIds(planIds: string[], m: LoreMilestone): string[] {
  return [...new Set([...planIds, ...(m.direct_sprint_ids ?? [])].filter(Boolean))];
}
function pct(d: number, t: number) { return t > 0 ? Math.round((100 * d) / t) : 0; }

// Captioned field wrapper. `caption` is passed pre-translated by callers.
function Field({ caption, w, children }: { caption: string; w: number | string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, width: w, flexShrink: 0 }}>
      <span style={{ fontSize: 8, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{caption}</span>
      {children}
    </label>
  );
}

interface Props { onError: (e: unknown) => void; onNavigateToSprint?: (id: string) => void }
interface EditState { label: string; date_display: string; week: string; priority: string; goal_md: string }

export default function LoreMilestonesView({ onError, onNavigateToSprint }: Props) {
  const { t } = useTranslation();
  const [milestones, setMilestones] = useState<LoreMilestone[]>([]);
  const [sprints, setSprints]       = useState<LoreSprintRow[]>([]);
  const [doneDates, setDoneDates]   = useState<LoreSprintDoneDate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [reload, setReload]         = useState(0);
  const [selId, setSelId]           = useState<string | null>(null);
  const [editMode, setEditMode]     = useState(false);  // edit header only via button
  const [edit, setEdit]             = useState<EditState>({ label: '', date_display: '', week: '', priority: '', goal_md: '' });
  const [tasks, setTasks]           = useState<(LoreSprintTask & { sprint_id: string })[]>([]);
  const [busy, setBusy]             = useState<string | null>(null);
  const [err, setErr]               = useState<string | null>(null);
  const [pick, setPick]             = useState('');                       // sprint to link
  const [newTask, setNewTask]       = useState<{ sprint_id: string; title: string }>({ sprint_id: '', title: '' });
  const [addOpen, setAddOpen]       = useState(false);
  const [draft, setDraft]           = useState<EditState & { milestone_id: string }>({ milestone_id: '', label: '', date_display: '', week: '', priority: '', goal_md: '' });

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreMilestone>('milestones', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintRow>('sprints', undefined, ctrl.signal),
      fetchLoreSlice<LoreSprintDoneDate>('sprint_done_dates', undefined, ctrl.signal),
    ]).then(([ms, sp, dd]) => { setMilestones(ms); setSprints(sp); setDoneDates(dd); setLoading(false); })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setLoading(false); } });
    return () => ctrl.abort();
  }, [onError, reload]);

  const doneSet = useMemo(() => new Set(sprints.filter(isDone).map(s => s.sprint_id)), [sprints]);
  const byId    = useMemo(() => new Map(sprints.map(s => [s.sprint_id, s])), [sprints]);
  // SPRINT_PLANITEM_RETIRE (T-21): sprint.planned_milestone_id is the new
  // source of truth for "which milestone is this sprint planned under" —
  // group once here instead of a backend PlanItem-hop per milestone row.
  const plannedByMilestone = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of sprints) {
      if (!s.planned_milestone_id) continue;
      const arr = map.get(s.planned_milestone_id);
      if (arr) arr.push(s.sprint_id); else map.set(s.planned_milestone_id, [s.sprint_id]);
    }
    return map;
  }, [sprints]);
  const selM    = useMemo(() => milestones.find(m => m.milestone_id === selId) ?? null, [milestones, selId]);
  const orphans = useMemo(() => {
    const linked = new Set<string>();
    milestones.forEach(m => msIds(plannedByMilestone.get(m.milestone_id) ?? [], m).forEach(id => linked.add(id)));
    return sprints.filter(s => !linked.has(s.sprint_id)).sort((a, b) => a.sprint_id.localeCompare(b.sprint_id));
  }, [milestones, sprints, plannedByMilestone]);

  const avgVelocity = useMemo(() => {
    const wk = new Map<string, number>();
    doneDates.forEach(d => { const dt = parseDate(d.done_date); if (dt) { const k = `${dt.getFullYear()}-${Math.floor(dt.getTime() / 6048e5)}`; wk.set(k, (wk.get(k) ?? 0) + 1); } });
    const last = [...wk.values()].slice(-11);
    return last.length ? last.reduce((s, n) => s + n, 0) / last.length : 0;
  }, [doneDates]);

  const rows = useMemo(() => {
    let foundCurrent = false;
    return [...milestones].sort((a, b) => (a.week ?? 0) - (b.week ?? 0)).map(m => {
      // plan vs direct breakdown
      const planIds    = plannedByMilestone.get(m.milestone_id) ?? [];
      const directIds  = (m.direct_sprint_ids ?? []).filter(Boolean);
      const ids = msIds(planIds, m);
      const done = ids.filter(i => doneSet.has(i)).length;
      const open = ids.length - done;
      const goalDone = (m.goal_md ?? '').includes('✅');
      let status: 'done' | 'current' | 'future';
      if ((ids.length > 0 && open === 0) || goalDone) status = 'done';
      else if (!foundCurrent) { status = 'current'; foundCurrent = true; }
      else status = 'future';
      const dleft = status === 'done' ? null : daysLeftOf(m.date_display);
      const projects = [...new Set(ids.flatMap(id => (byId.get(id)?.git_projects ?? []).map(projShort)).filter(Boolean))];
      const planDone   = planIds.filter(i => doneSet.has(i)).length;
      const directDone = directIds.filter(i => doneSet.has(i)).length;
      return { m, ids, done, open, status, dleft, projects, planIds, directIds, planDone, directDone };
    });
  }, [milestones, doneSet, byId, plannedByMilestone]);

  function selectMilestone(m: LoreMilestone) {
    if (selId === m.milestone_id) { setSelId(null); return; }
    setSelId(m.milestone_id); setEditMode(false);
    setEdit({ label: m.label ?? '', date_display: m.date_display ?? '', week: m.week != null ? String(m.week) : '', priority: m.priority ?? '', goal_md: m.goal_md ?? '' });
    setPick(''); setNewTask({ sprint_id: '', title: '' }); setTasks([]);
    const ids = msIds(plannedByMilestone.get(m.milestone_id) ?? [], m);
    if (ids.length) fetchTasksChunked(ids).then(setTasks).catch(() => {});
  }
  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); setReload(k => k + 1); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }
  // Re-sync edit form + tasks after reload when a milestone stays selected.
  useEffect(() => {
    if (selM) {
      const ids = msIds(plannedByMilestone.get(selM.milestone_id) ?? [], selM);
      if (ids.length) fetchTasksChunked(ids).then(setTasks).catch(() => {});
      else setTasks([]);
    }
  }, [milestones]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoreSkeleton />;

  const sel = selM ? rows.find(r => r.m.milestone_id === selM.milestone_id) : null;
  const selIds = selM ? msIds(plannedByMilestone.get(selM.milestone_id) ?? [], selM) : [];

  return (
    <div style={S.root}>
      <div style={S.header}>
        <GameIcon slug="crossed-axes" size={18} style={{ color: 'var(--acc)' }} />
        <span style={S.h1}>{t('lore.milestonesView.title', 'Вехи проекта')}</span>
        <span style={S.dim}>· {t('lore.milestonesView.countSummary', '{{count}} вех · avg velocity {{velocity}} Sp/нед', { count: milestones.length, velocity: avgVelocity.toFixed(1) })}</span>
        <button style={{ ...S.btnPrimary, marginLeft: 'auto' }} onClick={() => setAddOpen(o => !o)}>{addOpen ? t('lore.milestonesView.cancel', '× Отмена') : t('lore.milestonesView.addMilestone', '+ Веха')}</button>
      </div>
      {err && <div style={S.err}>{err}</div>}

      {addOpen && (
        <div style={S.editBox}>
          <div style={S.row}>
            <Field caption={t('lore.milestonesView.field.milestoneId', 'ID вехи')} w={110}><input style={{ ...S.in, width: '100%' }} placeholder="M8" value={draft.milestone_id} onChange={e => setDraft({ ...draft, milestone_id: e.target.value })} /></Field>
            <Field caption={t('lore.milestonesView.field.name', 'Название')} w={180}><input style={{ ...S.in, width: '100%' }} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field caption={t('lore.milestonesView.field.week', 'Неделя')} w={56}><input style={{ ...S.in, width: '100%' }} value={draft.week} onChange={e => setDraft({ ...draft, week: e.target.value })} /></Field>
            <Field caption={t('lore.milestonesView.field.date', 'Дата')} w={150}>
              <div style={{ display: 'flex', gap: 3 }}>
                <input style={{ ...S.in, flex: 1, minWidth: 0 }} placeholder={t('lore.milestonesView.field.datePlaceholder', '6 июл')} value={draft.date_display} onChange={e => setDraft({ ...draft, date_display: e.target.value })} />
                <input type="date" title={t('lore.milestonesView.field.pickFromCalendar', 'выбрать из календаря')} style={{ ...S.in, width: 26, padding: 2 }} onChange={e => e.target.value && setDraft({ ...draft, date_display: fmtRuDate(e.target.value) })} />
              </div>
            </Field>
            <Field caption={t('lore.milestonesView.field.priority', 'Приоритет')} w={80}><select style={{ ...S.in, width: '100%' }} value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map(p => <option key={p} value={p}>{p || '—'}</option>)}</select></Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={S.btnPrimary} disabled={!draft.milestone_id.trim() || busy === 'create'}
              onClick={() => run('create', async () => {
                await upsertMilestone({ milestone_id: draft.milestone_id.trim(), label: draft.label || draft.milestone_id, week: draft.week ? parseInt(draft.week) : null, date_display: draft.date_display || null, priority: draft.priority || null });
                setAddOpen(false); setDraft({ milestone_id: '', label: '', date_display: '', week: '', priority: '', goal_md: '' });
              })}>{busy === 'create' ? '…' : t('lore.milestonesView.createMilestone', 'Создать веху')}</button>
          </div>
        </div>
      )}

      {/* Master: simple cards — name, deadline, bar, projects */}
      <div style={S.cards}>
        {rows.map(({ m, ids, done, open, status, dleft, projects, planIds, directIds, planDone, directDone }) => {
          const col = status === 'done' ? 'var(--suc)' : status === 'current' ? 'var(--acc)' : 'var(--t2)';
          const p = pct(done, ids.length);
          const isSel = selId === m.milestone_id;
          // Risk block: нед_нужно = open / avgVelocity; дн_осталось = dleft; дефицит = нужно - осталось
          const riskBlock = (() => {
            if (status === 'done' || open === 0 || !avgVelocity || dleft == null) return null;
            const weeksNeeded = open / avgVelocity;
            const daysNeeded  = Math.round(weeksNeeded * 7);
            const deficit     = daysNeeded - Math.max(0, dleft);
            const riskLevel   = deficit > 7 ? 'high' : deficit > 0 ? 'mid' : 'ok';
            const riskCol     = riskLevel === 'high' ? 'var(--dng)' : riskLevel === 'mid' ? 'var(--wrn)' : 'var(--suc)';
            const riskLabel   = riskLevel === 'ok' ? t('lore.milestonesView.risk.onTime', '✓ в срок') : t('lore.milestonesView.risk.deficitDays', '⚠ −{{days}} дн', { days: deficit });
            return { weeksNeeded, daysNeeded, deficit, riskLevel, riskCol, riskLabel };
          })();
          return (
            <button key={m.milestone_id} onClick={() => selectMilestone(m)}
              style={{ ...S.card, borderColor: isSel ? 'var(--acc)' : status === 'current' ? 'color-mix(in srgb,var(--acc) 40%,var(--bd))' : 'var(--bd)',
                boxShadow: isSel ? '0 0 0 1px var(--acc)' : 'none' }}>
              <div style={S.cardHead}>
                <span style={{ fontSize: 12, color: col }}>{status === 'done' ? '✓' : status === 'current' ? '▶' : '○'}</span>
                <span style={S.mLabel}>{m.label}</span>
                {m.priority && <span style={{ ...S.prio, color: m.priority === 'P0' ? 'var(--dng)' : m.priority === 'P1' ? 'var(--wrn)' : 'var(--inf)' }}>{m.priority}</span>}
                {dleft != null && <span style={{ ...S.dl, color: dleft < 0 ? 'var(--dng)' : dleft <= 7 ? 'var(--wrn)' : 'var(--t3)' }}>{dleft >= 0 ? t('lore.milestonesView.daysLeft', '{{days}}д', { days: dleft }) : t('lore.milestonesView.overdue', 'просроч.')}</span>}
                {riskBlock && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: riskBlock.riskCol,
                    background: `color-mix(in srgb, ${riskBlock.riskCol} 12%, transparent)`,
                    borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' as const }}>
                    {riskBlock.riskLabel}
                  </span>
                )}
              </div>
              <div style={S.dim2}>{m.date_display}{m.week != null ? ` · w${m.week}` : ''}</div>
              <div style={S.progRow}>
                <div style={S.bar}><div style={{ height: '100%', width: `${p}%`, background: col, borderRadius: 3 }} /></div>
                <span style={S.progNum}>{done}/{ids.length} · {p}%</span>
              </div>
              {(planIds.length > 0 || directIds.length > 0) && (
                <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column' as const, gap: 3 }}>
                  {planIds.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 8, color: 'var(--t3)', width: 32, textAlign: 'right' as const, flexShrink: 0 }}>plan</span>
                      <div style={{ flex: 1, height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct(planDone, planIds.length)}%`, background: col, borderRadius: 2, opacity: 0.7 }} />
                      </div>
                      <span style={{ fontSize: 8, color: 'var(--t3)', fontFamily: 'var(--mono)', width: 36, flexShrink: 0 }}>
                        {planDone}/{planIds.length}
                      </span>
                    </div>
                  )}
                  {directIds.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 8, color: 'var(--t3)', width: 32, textAlign: 'right' as const, flexShrink: 0 }}>direct</span>
                      <div style={{ flex: 1, height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct(directDone, directIds.length)}%`, background: 'var(--acc)', borderRadius: 2, opacity: 0.7 }} />
                      </div>
                      <span style={{ fontSize: 8, color: 'var(--t3)', fontFamily: 'var(--mono)', width: 36, flexShrink: 0 }}>
                        {directDone}/{directIds.length}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {riskBlock && (
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--t3)', display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                  <span>{t('lore.milestonesView.risk.remaining', 'осталось')} <b style={{ color: 'var(--t2)' }}>{t('lore.milestonesView.risk.sp', '{{count}} Sp', { count: open })}</b></span>
                  <span>{t('lore.milestonesView.risk.needed', 'нужно')} <b style={{ color: riskBlock.riskCol }}>{t('lore.milestonesView.risk.days', '{{count}} дн', { count: riskBlock.daysNeeded })}</b> @ {t('lore.milestonesView.risk.spPerWeek', '{{velocity}} Sp/нед', { velocity: avgVelocity.toFixed(1) })}</span>
                  {riskBlock.deficit > 0
                    ? <span style={{ color: riskBlock.riskCol }}>{t('lore.milestonesView.risk.deficit', 'дефицит')} <b>{t('lore.milestonesView.risk.days', '{{count}} дн', { count: riskBlock.deficit })}</b></span>
                    : <span style={{ color: 'var(--suc)' }}>{t('lore.milestonesView.risk.buffer', 'запас')} <b>{t('lore.milestonesView.risk.days', '{{count}} дн', { count: -riskBlock.deficit })}</b></span>}
                </div>
              )}
              {projects.length > 0 && <div style={S.projWrap}>{projects.map(pr => <span key={pr} style={S.projTag}>{pr}</span>)}</div>}
            </button>
          );
        })}
      </div>

      {/* Detail: header edit + sprints + planned tasks for the selected milestone */}
      {selM && sel && (
        <section style={S.detail}>
          {/* Header — read by default, edit only via button */}
          {!editMode ? (
            <div style={S.detailHead}>
              <span style={S.detMid}>{selM.milestone_id}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{selM.label}</span>
              {selM.priority && <span style={{ ...S.prio, color: selM.priority === 'P0' ? 'var(--dng)' : selM.priority === 'P1' ? 'var(--wrn)' : 'var(--inf)' }}>{selM.priority}</span>}
              <span style={S.dim}>{selM.date_display}{selM.week != null ? ` · w${selM.week}` : ''}</span>
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button style={S.btnPrimary} onClick={() => setEditMode(true)}>{t('lore.milestonesView.edit', '✎ Редактировать')}</button>
                <button style={S.btn} onClick={() => setSelId(null)}>{t('lore.milestonesView.close', '× закрыть')}</button>
              </div>
            </div>
          ) : (
            <>
              <div style={S.detailHead}>
                <span style={S.detMid}>{selM.milestone_id}</span>
                <Field caption={t('lore.milestonesView.field.name', 'Название')} w={200}><input style={{ ...S.in, width: '100%' }} value={edit.label} onChange={e => setEdit({ ...edit, label: e.target.value })} /></Field>
                <Field caption={t('lore.milestonesView.field.week', 'Неделя')} w={56}><input style={{ ...S.in, width: '100%' }} value={edit.week} onChange={e => setEdit({ ...edit, week: e.target.value })} /></Field>
                <Field caption={t('lore.milestonesView.field.date', 'Дата')} w={150}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <input style={{ ...S.in, flex: 1, minWidth: 0 }} value={edit.date_display} placeholder={t('lore.milestonesView.field.dateExamplePlaceholder', 'напр. 6 июл')} onChange={e => setEdit({ ...edit, date_display: e.target.value })} />
                    <input type="date" title={t('lore.milestonesView.field.pickFromCalendar', 'выбрать из календаря')} style={{ ...S.in, width: 26, padding: 2 }} onChange={e => e.target.value && setEdit({ ...edit, date_display: fmtRuDate(e.target.value) })} />
                  </div>
                </Field>
                <Field caption={t('lore.milestonesView.field.priority', 'Приоритет')} w={80}><select style={{ ...S.in, width: '100%' }} value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value })}>{PRIORITIES.map(p => <option key={p} value={p}>{p || '—'}</option>)}</select></Field>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginLeft: 'auto' }}>
                  <button style={S.btnPrimary} disabled={busy === 'edit'}
                    onClick={() => run('edit', async () => { await upsertMilestone({ milestone_id: selM.milestone_id, label: edit.label, week: edit.week ? parseInt(edit.week) : null, date_display: edit.date_display || null, priority: edit.priority || null, goal_md: edit.goal_md || null }); setEditMode(false); })}>
                    {busy === 'edit' ? '…' : t('lore.milestonesView.save', 'Сохранить')}
                  </button>
                  <button style={S.btn} onClick={() => setEditMode(false)}>{t('lore.milestonesView.cancelLower', 'отмена')}</button>
                </div>
              </div>
              <Field caption={t('lore.milestonesView.field.goalDescription', 'Описание / цель вехи')} w={'100%'}>
                <TipTapField value={edit.goal_md} onChange={v => setEdit({ ...edit, goal_md: v })} minHeight={60}
                  enableImages={false} enableHtmlMode={false} />
              </Field>
            </>
          )}

          <div style={S.twoCol}>
            {/* Sprints */}
            <div style={S.col}>
              <div style={S.colTitle}>{t('lore.milestonesView.milestoneSprints', 'Спринты вехи · {{count}}', { count: selIds.length })}</div>
              <div style={S.sprList}>
                {selIds.length === 0 && <div style={S.muted}>{t('lore.milestonesView.noneAddOnRight', 'нет — добавьте справа')}</div>}
                {selIds.map(sid => {
                  const s = byId.get(sid); const k = classify(s?.status_raw ?? null); const proj = projShort(s?.git_projects?.[0]);
                  return (
                    <div key={sid} style={S.sprRow}>
                      <GameIcon slug={statusMeta(k).icon} size={11} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                      <span style={S.sprId} onClick={() => onNavigateToSprint?.(sid)} role={onNavigateToSprint ? 'button' : undefined}>{sid}</span>
                      <span style={S.sprName}>{s?.name ?? ''}</span>
                      {proj && <span style={S.projTag}>{proj}</span>}
                      <button style={S.x} disabled={busy === 'u' + sid} onClick={() => run('u' + sid, () => linkSprintMilestone(sid, selM.milestone_id, 'remove'))}>×</button>
                    </div>
                  );
                })}
              </div>
              <select style={{ ...S.in, marginTop: 6 }} value={pick}
                onChange={e => { const sid = e.target.value; if (sid) run('link', async () => { await linkSprintMilestone(sid, selM.milestone_id, 'add'); setPick(''); }); }}>
                <option value="">{t('lore.milestonesView.linkSprintPlaceholder', '+ привязать спринт…')}</option>
                {sprints.filter(s => !selIds.includes(s.sprint_id)).map(s =>
                  <option key={s.sprint_id} value={s.sprint_id}>{s.sprint_id}{s.git_projects?.[0] ? ` · ${projShort(s.git_projects[0])}` : ''} · {classify(s.status_raw)}</option>)}
              </select>
            </div>

            {/* Planned tasks */}
            <div style={S.col}>
              <div style={S.colTitle}>{t('lore.milestonesView.milestoneTasks', 'Задачи вехи · {{count}}', { count: tasks.length })}</div>
              <div style={S.sprList}>
                {tasks.length === 0 && <div style={S.muted}>{t('lore.milestonesView.noTasks', 'нет задач')}</div>}
                {tasks.map(t => {
                  const k = classify(t.status_raw ?? null);
                  return (
                    <div key={t.task_uid} style={S.sprRow} title={`${t.sprint_id}`}>
                      <GameIcon slug={statusMeta(k).icon} size={10} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                      <span style={{ ...S.sprId, fontSize: 9 }}>{t.task_id}</span>
                      <span style={S.sprName}>{t.title ?? ''}</span>
                    </div>
                  );
                })}
              </div>
              {selIds.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <select style={{ ...S.in, width: 130 }} value={newTask.sprint_id} onChange={e => setNewTask({ ...newTask, sprint_id: e.target.value })}>
                    <option value="">{t('lore.milestonesView.intoSprintPlaceholder', 'в спринт…')}</option>
                    {selIds.map(sid => <option key={sid} value={sid}>{sid}</option>)}
                  </select>
                  <input style={{ ...S.in, flex: 1 }} placeholder={t('lore.milestonesView.newTaskPlaceholder', 'новая задача')} value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} />
                  <button style={S.btn} disabled={!newTask.sprint_id || !newTask.title.trim() || busy === 'task'}
                    onClick={() => run('task', async () => {
                      const tid = (newTask.title.trim().slice(0, 18).replace(/[^\w]+/g, '_').toUpperCase() || 'TASK') + '_' + Math.random().toString(36).slice(2, 5);
                      await createLoreTask(newTask.sprint_id, tid, newTask.title.trim());
                      setNewTask({ sprint_id: '', title: '' });
                    })}>{t('lore.milestonesView.addTask', '+ задача')}</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Footer: sprints without any milestone — assign for planning */}
      <section style={{ ...S.detail, borderColor: orphans.length ? 'color-mix(in srgb,var(--wrn) 40%,var(--bd))' : 'var(--bd)' }}>
        <div style={{ ...S.colTitle, color: orphans.length ? 'var(--wrn)' : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <GameIcon slug="hourglass" size={12} style={{ color: orphans.length ? 'var(--wrn)' : 'var(--t3)' }} />
          {t('lore.milestonesView.sprintsWithoutMilestones', 'Спринты без вех · {{count}}', { count: orphans.length })}
        </div>
        {orphans.length === 0
          ? <div style={{ fontSize: 11, color: 'var(--suc)' }}>{t('lore.milestonesView.allSprintsLinked', 'Все спринты привязаны к вехам ✓')}</div>
          : (
            <div style={{ ...S.sprList, maxHeight: 320 }}>
              {orphans.map(s => {
                const k = classify(s.status_raw); const proj = projShort(s.git_projects?.[0]);
                return (
                  <div key={s.sprint_id} style={S.sprRow}>
                    <GameIcon slug={statusMeta(k).icon} size={11} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                    <span style={S.sprId} onClick={() => onNavigateToSprint?.(s.sprint_id)} role={onNavigateToSprint ? 'button' : undefined}>{s.sprint_id}</span>
                    <span style={S.sprName}>{s.name}</span>
                    {proj && <span style={S.projTag}>{proj}</span>}
                    <select style={{ ...S.in, fontSize: 9, padding: '2px 4px', flexShrink: 0 }} value=""
                      onChange={e => { const mid = e.target.value; if (mid) run('assign' + s.sprint_id, () => linkSprintMilestone(s.sprint_id, mid, 'add')); }}>
                      <option value="">{t('lore.milestonesView.intoMilestonePlaceholder', '→ в веху…')}</option>
                      {milestones.map(m => <option key={m.milestone_id} value={m.milestone_id}>{m.milestone_id}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
      </section>
    </div>
  );
}

const S = {
  root:    { flex: 1, overflowY: 'auto' as const, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  header:  { display: 'flex', alignItems: 'center', gap: 8 },
  h1:      { fontSize: 15, fontWeight: 700, color: 'var(--t1)' },
  dim:     { fontSize: 11, color: 'var(--t3)' },
  dim2:    { fontSize: 9, color: 'var(--t3)' },
  err:     { fontSize: 10, color: 'var(--dng)' },
  cards:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 },
  card:    { textAlign: 'left' as const, cursor: 'pointer', background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 5 },
  cardHead:{ display: 'flex', alignItems: 'center', gap: 6 },
  mLabel:  { fontSize: 12, fontWeight: 700, color: 'var(--t1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  prio:    { fontSize: 8, fontWeight: 700, fontFamily: 'var(--mono)' },
  dl:      { fontSize: 9, fontFamily: 'var(--mono)' },
  progRow: { display: 'flex', alignItems: 'center', gap: 6 },
  bar:     { flex: 1, height: 6, borderRadius: 3, background: 'var(--b3)', overflow: 'hidden' },
  progNum: { fontSize: 9, color: 'var(--t2)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const },
  projWrap:{ display: 'flex', flexWrap: 'wrap' as const, gap: 3 },
  projTag: { fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--t2)', background: 'var(--b3)', borderRadius: 3, padding: '1px 5px', border: '1px solid var(--bd)' },
  detail:  { background: 'var(--b1)', border: '1px solid var(--acc)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  detailHead: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  detMid:  { fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--acc)' },
  twoCol:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  col:     { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  colTitle:{ fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 700, marginBottom: 2 },
  sprList: { display: 'flex', flexDirection: 'column' as const, gap: 1, maxHeight: 260, overflowY: 'auto' as const },
  sprRow:  { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '2px 4px', borderRadius: 4, background: 'var(--b2)' },
  sprId:   { fontFamily: 'var(--mono)', color: 'var(--acc)', flexShrink: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, cursor: 'pointer' },
  sprName: { color: 'var(--t3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  muted:   { fontSize: 10, color: 'var(--t4)', fontStyle: 'italic' as const, padding: '2px 0' },
  x:       { border: 'none', background: 'transparent', color: 'var(--dng)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 },
  in:      { fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)' },
  ta:      { fontSize: 11, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)', minHeight: 44, resize: 'vertical' as const, fontFamily: 'inherit' },
  editBox: { display: 'flex', flexDirection: 'column' as const, gap: 6, padding: 8, background: 'var(--b2)', borderRadius: 8 },
  row:     { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  btn:     { fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer' },
  btnPrimary: { fontSize: 10, padding: '4px 12px', borderRadius: 4, border: '1px solid color-mix(in srgb,var(--acc) 35%,transparent)', background: 'color-mix(in srgb,var(--acc) 12%,transparent)', color: 'var(--acc)', cursor: 'pointer', fontWeight: 600 },
};
