import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, loreMutate } from '../../api/lore';
import { parseRoutine, parseInvariants, parseGateSubtitle } from '../../lib/qgContentMd';
import { MartProse } from '../bench/MartProse';

interface QGDetail {
  qg_id: string;
  name: string;
  description: string | null;
  component_id: string | null;
  status: string | null;           // lifecycle: active/draft/deprecated/closed
  last_run_status: string | null;  // run result: active/blocked
  date_created: string | null;
  content_md: string | null;
  sprint_id: string | null;
}

interface Recommendation {
  rec_id: string;
  title: string;
  body_md: string | null;
  status: string | null;
  inv_id: string | null;
  severity: string | null;
  qg_id: string | null;
  // Populated client-side right after a successful promote — the backend
  // response carries where the task actually landed (qg/promote defaults to
  // this week's rotating SPRINT_QG_HOUSEKEEPING_<ISO week> unless the caller
  // overrides sprint_id).
  promoted_task_uid?: string;
  promoted_sprint_id?: string;
}

interface RoutineRun {
  run_id: string | null;
  routine_name: string;
  run_date: string | null;
  status: string | null;
  flags: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface RunMetric {
  metric_id: string | null;
  metric_key: string;
  value: number | null;
  unit: string | null;
  target: number | null;
  status: string | null;
  source: string | null;
}

const SEV_COLOR: Record<string, string> = {
  blocker: 'var(--danger)',
  major:   'var(--wrn)',
  minor:   'var(--inf)',
};
const STATUS_COLOR: Record<string, string> = {
  active:     'var(--suc)',
  draft:      'var(--wrn)',
  archived:   'var(--t3)',
  deprecated: 'var(--t3)',
  closed:     'var(--t3)',
};
const RUN_COLOR: Record<string, string> = {
  active:  'var(--suc)',
  blocked: 'var(--danger)',
};

function statusColor(s: string | null): string {
  return s === 'PASS' ? 'var(--suc)'
    : s === 'WARN' ? 'var(--wrn)'
    : s === 'FAIL' ? 'var(--danger)'
    : 'var(--t3)';
}


// ── Sparkline (ADR-QG-004 §2 dynamics) ───────────────────────────────────────
function Sparkline({ hist, target }: { hist: { v: number; status: string | null }[]; target: number | null }) {
  const { t } = useTranslation();
  const pres = hist.filter(h => h.v !== -1 && h.v != null);
  if (pres.length < 2) {
    return <div style={S.sparkEmpty}>{t('lore.qgDetail.sparkline.noData', 'нет данных')}</div>;
  }
  const w = 104, h = 28, pad = 4;
  const vals = pres.map(p => p.v);
  let lo = Math.min(...vals, target ?? vals[0]);
  let hi = Math.max(...vals, target ?? vals[0]);
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const rng = hi - lo;
  const n = hist.length;
  // map presence indices back to global x positions
  const idxOf: number[] = [];
  let gi = 0;
  hist.forEach(hh => { if (hh.v !== -1 && hh.v != null) idxOf.push(gi); gi++; });
  const X = (i: number) => pad + (n === 1 ? 0 : (i / (n - 1)) * (w - 2 * pad));
  const Y = (v: number) => pad + (1 - (v - lo) / rng) * (h - 2 * pad);
  const ty = target != null ? Y(target) : null;
  const poly = pres.map((p, k) => `${X(idxOf[k]).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const last = pres[pres.length - 1];
  const lastX = X(idxOf[idxOf.length - 1]);
  const lastY = Y(last.v);
  return (
    <svg width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
      {ty != null && (
        <line x1={pad} y1={ty.toFixed(1)} x2={w - pad} y2={ty.toFixed(1)}
          stroke="var(--bdh)" strokeWidth={1} strokeDasharray="3 2" />
      )}
      <polyline points={poly} fill="none" stroke="var(--t2)" strokeWidth={1.4} />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={3} fill={statusColor(last.status)} />
    </svg>
  );
}

interface Props {
  qgId: string;
  onError: (e: unknown) => void;
  onBack?: () => void;
  onNavigateToSprint?: (id: string) => void;
}

export default function LoreQGDetail({ qgId, onError, onBack, onNavigateToSprint }: Props) {
  const { t } = useTranslation();
  const [qg, setQg]             = useState<QGDetail | null>(null);
  const [recs, setRecs]         = useState<Recommendation[]>([]);
  const [loading, setLoading]   = useState(true);
  const [promoting, setPromoting]     = useState<string | null>(null);
  const [dismissing, setDismissing]   = useState<string | null>(null);
  const [runs, setRuns]               = useState<RoutineRun[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<RunMetric[]>([]);
  // metric_key -> ordered (oldest→newest) history across structured runs
  const [metricHist, setMetricHist]   = useState<Record<string, { v: number; status: string | null }[]>>({});
  // prev structured run's metrics (for "what changed")
  const [prevMetrics, setPrevMetrics] = useState<RunMetric[]>([]);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [methOpen, setMethOpen] = useState(false);

  const invariants = useMemo(() => parseInvariants(qg?.content_md ?? null), [qg]);
  const gateSubtitle = useMemo(() => parseGateSubtitle(qg?.content_md ?? null), [qg]);
  // routine resolved from content_md, NOT qg_id.toLowerCase() (ADR-QG-004 §contract)
  const routineName = useMemo(
    () => parseRoutine(qg?.content_md ?? null, qgId.toLowerCase()),
    [qg, qgId],
  );
  // keys belonging to THIS gate (for filtering aggregate routine runs)
  // Phase 1: load gate + recs (content_md gives us routineName)
  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<QGDetail>('quality_gate_by_id', { id: qgId }, ctrl.signal),
      fetchLoreSlice<Recommendation>('qg_recommendations', { qg_id: qgId }, ctrl.signal),
    ]).then(([qgRows, recRows]) => {
      setQg(qgRows[0] ?? null);
      setRecs(recRows);
      setLoading(false);
    }).catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [qgId, onError]);

  // Phase 2: once routineName known, load run history + per-metric dynamics
  useEffect(() => {
    if (!qg) return;
    const ctrl = new AbortController();
    fetchLoreSlice<RoutineRun>('qg_run_history', { routine_name: routineName }, ctrl.signal)
      .then(async runRows => {
        setRuns(runRows);
        // structured runs = those with a run_id (newest first from slice)
        const structured = runRows.filter(r => r.run_id);
        if (structured.length === 0) { setLatestMetrics([]); setPrevMetrics([]); setMetricHist({}); return; }
        // fetch metrics for up to last 8 structured runs
        const take = structured.slice(0, 8);
        const metricsByRun = await Promise.all(
          take.map(r =>
            fetchLoreSlice<RunMetric>('qg_run_metrics', { run_id: r.run_id! }, ctrl.signal)
              .catch(() => [] as RunMetric[]),
          ),
        );
        // newest first → latest + prev
        setLatestMetrics(metricsByRun[0] ?? []);
        setPrevMetrics(metricsByRun[1] ?? []);
        // build per-key history oldest→newest
        const hist: Record<string, { v: number; status: string | null }[]> = {};
        for (let i = metricsByRun.length - 1; i >= 0; i--) {
          for (const m of metricsByRun[i]) {
            (hist[m.metric_key] ||= []).push({ v: m.value ?? -1, status: m.status });
          }
        }
        setMetricHist(hist);
      })
      .catch(e => onError(e));
    return () => ctrl.abort();
  }, [qg, routineName, onError]);

  const handlePromote = async (rec: Recommendation) => {
    setPromoting(rec.rec_id);
    try {
      const res = await loreMutate<{ ok: boolean; task_uid: string; task_id: string; sprint_id: string }>(
        '/qg/promote', { rec_id: rec.rec_id, title: rec.title });
      setRecs(r => r.map(x => x.rec_id === rec.rec_id
        ? { ...x, status: 'promoted', promoted_task_uid: res.task_uid, promoted_sprint_id: res.sprint_id }
        : x));
    } catch (e) { onError(e); }
    finally { setPromoting(null); }
  };

  const handleDismiss = async (rec: Recommendation) => {
    setDismissing(rec.rec_id);
    try {
      await loreMutate('/qg/recommendation', { rec_id: rec.rec_id, job_id: '_', title: rec.title, status: 'dismissed' });
      setRecs(r => r.map(x => x.rec_id === rec.rec_id ? { ...x, status: 'dismissed' } : x));
    } catch (e) { onError(e); }
    finally { setDismissing(null); }
  };

  if (loading) return <div style={S.empty}>{t('lore.qgDetail.loading', 'Загрузка…')}</div>;
  if (!qg) return <div style={S.empty}>{t('lore.qgDetail.notFound', 'QG «{{qgId}}» не найден.', { qgId })}</div>;

  const stColor = STATUS_COLOR[qg.status ?? ''] ?? 'var(--t3)';
  const pendingRecs = recs.filter(r => r.status === 'pending');

  // join latest metric to each invariant key
  const metricByKey: Record<string, RunMetric> = {};
  for (const m of latestMetrics) metricByKey[m.metric_key] = m;
  const prevByKey: Record<string, RunMetric> = {};
  for (const m of prevMetrics) prevByKey[m.metric_key] = m;
  // recommendation by inv key (inv_id may carry bare key or inv_N_key).
  // A pending rec always wins the slot; otherwise the first promoted/dismissed
  // one found keeps showing here instead of silently disappearing once acted
  // on (QGRecommendation has no valid_from/supersede edge yet — see T14
  // QG-recommendations follow-up — so this is "first wins", not "latest
  // wins"; multiple non-pending recs for the same key beyond the first
  // still surface below in "Прочие рекомендации").
  const recByKey: Record<string, Recommendation> = {};
  for (const r of recs) {
    if (!r.inv_id) continue;
    const bare = r.inv_id.replace(/^inv_?\d+_/, '');
    if (!recByKey[bare] || r.status === 'pending') {
      recByKey[bare] = r; recByKey[r.inv_id] = r;
    }
  }
  // Only recs that actually render inline (mirrors the FAIL/WARN gate on the
  // inline card below) get excluded from "Прочие рекомендации" — a rec whose
  // invariant recovered to PASS (or has no run) after being promoted must
  // still surface somewhere, not disappear because recByKey claimed its slot.
  const inlineRecIds = new Set(
    invariants
      .filter(inv => {
        const st = metricByKey[inv.key]?.status;
        return recByKey[inv.key] && (st === 'FAIL' || st === 'WARN');
      })
      .map(inv => recByKey[inv.key].rec_id),
  );

  // status counts for latest structured run, restricted to this gate's keys
  const gateMetrics = invariants.map(i => metricByKey[i.key]).filter(Boolean) as RunMetric[];
  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 } as Record<string, number>;
  for (const m of gateMetrics) counts[m.status ?? 'SKIP'] = (counts[m.status ?? 'SKIP'] ?? 0) + 1;

  // "what changed" between latest & prev structured runs (this gate's keys)
  const changes = invariants
    .map(i => {
      const cur = metricByKey[i.key]?.status;
      const prev = prevByKey[i.key]?.status;
      if (cur && prev && cur !== prev) return { key: i.key, prev, cur };
      return null;
    })
    .filter(Boolean) as { key: string; prev: string; cur: string }[];

  const hasStructured = runs.some(r => r.run_id);

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        {onBack && <button style={S.backBtn} onClick={onBack}>←</button>}
        <div style={S.headerMain}>
          <div style={S.headerRow}>
            <span style={S.qgId}>{qg.qg_id}</span>
            <span style={S.statusBadge(stColor)}>{qg.status ?? '—'}</span>
            {qg.last_run_status && (
              <span style={S.statusBadge(RUN_COLOR[qg.last_run_status] ?? 'var(--t3)')}>
                {qg.last_run_status === 'blocked'
                  ? t('lore.qgDetail.header.lastFail', '✗ last fail')
                  : t('lore.qgDetail.header.lastPass', '✓ last pass')}
              </span>
            )}
            {qg.component_id && <span style={S.compBadge}>{qg.component_id}</span>}
            <span style={S.routineBadge}>{routineName}</span>
            {/* qg.sprint_id was fetched but never rendered — the QG's own
                home sprint had no link anywhere on this page. */}
            {qg.sprint_id && onNavigateToSprint && (
              <button style={S.sprintLink} onClick={() => onNavigateToSprint(qg.sprint_id!)}>
                {t('lore.qgDetail.header.sprintLink', '↗ {{sprintId}}', { sprintId: qg.sprint_id })}
              </button>
            )}
          </div>
          <div style={S.qgName}>{qg.name}</div>
          {(qg.description || gateSubtitle) && <div style={S.desc}>{qg.description ?? gateSubtitle}</div>}
          {/* §4 РЕГЛАМЕНТ — provenance */}
          <div style={S.provRow}>
            <span style={S.provLabel}>{t('lore.qgDetail.header.provenanceLabel', 'Регламент:')}</span>
            <span style={S.provChip} title={t('lore.qgDetail.header.provRoutineTitle', 'Архитектура рутин')}>
              {t('lore.qgDetail.header.provRoutineChip', 'ADR-QG-001 рутина')}
            </span>
            <span style={S.provChip} title={t('lore.qgDetail.header.provSmartTitle', 'Стандарт SMART-метрик (compute_status)')}>
              {t('lore.qgDetail.header.provSmartChip', 'ADR-QG-002 SMART')}
            </span>
            <span style={S.provChip} title={t('lore.qgDetail.header.provFormatTitle', 'Формат этого отчёта')}>
              {t('lore.qgDetail.header.provFormatChip', 'ADR-QG-004 формат')}
            </span>
          </div>
        </div>
      </div>

      <div style={S.body}>
        {/* §2 ДИНАМИКА — run history */}
        <section style={S.section}>
          <div style={S.secLabel}>
            {t('lore.qgDetail.runHistory.title', 'История прогонов')}
            {runs.length > 0 && (
              <span style={S.muted}>{t('lore.qgDetail.runHistory.recordsCount', '{{count}} записей', { count: runs.length })}</span>
            )}
          </div>
          {runs.length === 0 ? (
            <div style={S.emptySection}>
              {t('lore.qgDetail.runHistory.empty', 'Прогонов не найдено (routine: {{routineName}}).', { routineName })}
            </div>
          ) : (
            <div style={S.runList}>
              {runs.map((r, i) => {
                const rc = statusColor(r.status);
                const isLatest = i === 0;
                return (
                  <div key={r.run_id ?? `f${i}`} style={isLatest ? S.runRowLatest : S.runRow}>
                    <span style={S.badge(rc)}>{r.status ?? '?'}</span>
                    <span style={S.runDate}>
                      {(r.started_at ?? r.run_date)?.toString().slice(0, 10) ?? '—'}
                    </span>
                    {r.run_id
                      ? <span style={S.runId}>{r.run_id.slice(-20)}</span>
                      : <span style={S.runLegacy}>{t('lore.qgDetail.runHistory.legacyFlags', 'legacy flags')}</span>}
                    {!r.run_id && r.flags && <span style={S.runFlags}>{r.flags}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* §3 ПОЧЕМУ — methodology (compute_status, ADR-QG-002) */}
        <section style={S.section}>
          <button style={S.methToggle} onClick={() => setMethOpen(o => !o)}>
            <span style={S.methCaret}>{methOpen ? '▾' : '▸'}</span>
            <span style={S.secLabelInline}>{t('lore.qgDetail.methodology.title', 'Методика расчёта статуса')}</span>
            <span style={S.muted}>{t('lore.qgDetail.methodology.subtitle', 'ADR-QG-002 SMART-QG')}</span>
          </button>
          {methOpen && (
            <div style={S.methBody}>
              <div style={S.methLine}>
                <code style={S.methDir}>gte</code>
                {' '}
                {t('lore.qgDetail.methodology.gteLine', '(больше=лучше): ≥ цель → PASS · ≥ цель×0.9 → WARN · иначе FAIL')}
              </div>
              <div style={S.methLine}>
                <code style={S.methDir}>lte</code>
                {' '}
                {t('lore.qgDetail.methodology.lteLine', '(меньше=лучше): ≤ цель → PASS · ≤ цель×1.1 → WARN · иначе FAIL')}
              </div>
              <div style={S.methLine}>
                <code style={S.methSkip}>{t('lore.qgDetail.methodology.skipValue', 'value = −1')}</code>
                {' '}
                {t('lore.qgDetail.methodology.skipDesc', '→ SKIP (сервис недоступен).')}
                {' '}
                <b style={S.methStrong}>{t('lore.qgDetail.methodology.skipNeFail', 'SKIP ≠ FAIL')}</b>
                {' '}
                {t('lore.qgDetail.methodology.skipNote', '— не штрафует гейт.')}
              </div>
              <div style={S.methLine}>
                {t('lore.qgDetail.methodology.overallLine', 'Overall: FAIL если ≥1 FAIL · WARN если есть WARN/SKIP · все SKIP → SKIP · иначе PASS.')}
              </div>
              <div style={S.methNote}>
                {t('lore.qgDetail.methodology.conditionNotePrefix', 'Кастомные WARN-полосы заданы в')}
                {' '}
                <code style={S.methDir}>condition</code>
                {' '}
                {t('lore.qgDetail.methodology.conditionNoteSuffix', 'каждого инварианта ниже.')}
              </div>
            </div>
          )}
        </section>

        {/* §2 «что изменилось» */}
        {hasStructured && (
          <section style={S.section}>
            <div style={S.secLabel}>{t('lore.qgDetail.changes.title', 'Изменилось с прошлого прогона')}</div>
            {changes.length === 0 ? (
              <div style={S.emptySection}>{t('lore.qgDetail.changes.empty', 'Без изменений статусов.')}</div>
            ) : (
              <div style={S.changeRow}>
                {changes.map(c => (
                  <span key={c.key} style={S.changeChip(statusColor(c.cur))}>
                    <code style={S.changeKey}>{c.key}</code>
                    <span style={S.muted}>{c.prev}</span>
                    <span style={{ color: statusColor(c.cur), fontWeight: 700 }}>→ {c.cur}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* §1+§3 ИНВАРИАНТЫ (что + почему + динамика + рекомендация) */}
        <section style={S.section}>
          <div style={S.secLabel}>
            {t('lore.qgDetail.invariants.title', 'Инварианты')}
            {gateMetrics.length > 0 && (
              <span style={S.countRow}>
                {(['PASS', 'WARN', 'FAIL', 'SKIP'] as const).map(s =>
                  counts[s] ? <span key={s} style={S.countBadge(statusColor(s))}>{counts[s]} {s}</span> : null,
                )}
              </span>
            )}
          </div>
          {invariants.length === 0 ? (
            <div style={S.emptySection}>{t('lore.qgDetail.invariants.empty', 'В content_md нет распознанных INV-блоков.')}</div>
          ) : (
            <div style={S.invList}>
              {invariants.map(inv => {
                const m = metricByKey[inv.key];
                const st = m?.status ?? null;
                const sk = st === 'SKIP' || !m;
                const sc = statusColor(st);
                const lb = st === 'FAIL' ? 'var(--danger)' : st === 'WARN' ? 'var(--wrn)' : sk ? 'var(--t3)' : 'transparent';
                const rbg = sk ? 'color-mix(in srgb, var(--t3) 4%, transparent)'
                  : st === 'FAIL' ? 'color-mix(in srgb, var(--danger) 4%, transparent)' : 'transparent';
                const val = m?.value;
                const valStr = (val === -1 || val == null) ? null : `${val}${inv.unit ? ' ' + inv.unit : ''}`;
                const rec = recByKey[inv.key];
                const hist = metricHist[inv.key] ?? [];
                return (
                  <div key={inv.key} style={{ ...S.invCard, background: rbg, borderLeft: `3px solid ${lb}` }}>
                    <div style={S.invMain}>
                      <span style={S.invNo}>{inv.invNo}</span>
                      <div style={S.invContent}>
                        <div style={S.invHeadRow}>
                          <span style={S.badge(sc)}>{st ?? t('lore.qgDetail.invariants.noRun', 'нет прогона')}</span>
                          <span style={S.invKey(sk)}>{inv.key}</span>
                          {inv.direction && <span style={S.dirBadge}>{inv.direction}</span>}
                        </div>
                        {inv.descr && <div style={S.invDescr}>{inv.descr}</div>}
                        {/* §3 ПОЧЕМУ: condition + how_to_verify (методология из content_md) */}
                        {inv.condition && (
                          <div style={S.ruleLine}><span style={S.ruleTag}>{t('lore.qgDetail.invariants.ruleTag', 'правило')}</span>{inv.condition}</div>
                        )}
                        {inv.howToVerify && (
                          <div style={S.ruleLine}><span style={S.ruleTag}>{t('lore.qgDetail.invariants.verifyTag', 'проверка')}</span>{inv.howToVerify}</div>
                        )}
                        {/* §1 ЧТО: source evidence */}
                        {(m?.source || inv.source) && (
                          <div style={S.srcWrap}>
                            <span
                              style={S.srcToggle}
                              onClick={() => setExpandedSource(expandedSource === inv.key ? null : inv.key)}
                            >
                              {expandedSource === inv.key
                                ? t('lore.qgDetail.invariants.sourceExpanded', '▾ source')
                                : t('lore.qgDetail.invariants.sourceCollapsed', '▸ source')}
                            </span>
                            {expandedSource === inv.key && (
                              <pre style={S.srcPre}>{m?.source || inv.source}</pre>
                            )}
                          </div>
                        )}
                      </div>
                      {/* value / target */}
                      <div style={S.valBox}>
                        {sk ? (
                          <span style={S.valSkip}>{t('lore.qgDetail.invariants.unavailable', '— недоступно')}</span>
                        ) : (
                          <>
                            <span style={S.valNum(sc)}>{valStr}</span>
                            {inv.target != null && (
                              <div style={S.valTgt}>
                                {t('lore.qgDetail.invariants.targetLabel', 'цель')} {inv.direction === 'lte' ? '≤' : '≥'}{inv.target}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {/* §2 ДИНАМИКА: sparkline */}
                      <div style={S.sparkBox}>
                        <Sparkline hist={hist} target={inv.target} />
                        <div style={S.sparkLabel}>{t('lore.qgDetail.invariants.dynamicsLabel', 'динамика')}</div>
                      </div>
                    </div>
                    {/* inline recommendation under failing invariant — stays in
                        place (doesn't vanish) once promoted/dismissed, so
                        acting on it doesn't silently drop its info from view. */}
                    {rec && (st === 'FAIL' || st === 'WARN') && (
                      <div style={{ ...S.recInline, borderColor: `color-mix(in srgb, ${sc} 22%, transparent)`, background: `color-mix(in srgb, ${sc} 7%, transparent)`, borderLeft: `3px solid ${sc}` }}>
                        <div style={S.recInlineHead}>
                          <span style={{ ...S.recId, color: sc, fontWeight: 700 }}>{rec.rec_id}</span>
                          <span style={S.badge(sc)}>{rec.status ?? 'pending'}</span>
                        </div>
                        <div style={S.recTitle}>{rec.title}</div>
                        {rec.body_md && <MartProse text={rec.body_md} style={S.recBody} />}
                        {rec.status === 'promoted' ? (
                          rec.promoted_task_uid && rec.promoted_sprint_id ? (
                            <button
                              style={S.promotedLink}
                              onClick={() => onNavigateToSprint?.(rec.promoted_sprint_id!)}
                              title={t('lore.qgDetail.otherRecs.openSprintTitle', 'Открыть {{sprintId}}', { sprintId: rec.promoted_sprint_id })}
                            >
                              {t('lore.qgDetail.otherRecs.taskLink', '→ задача {{taskUid}}', { taskUid: rec.promoted_task_uid })}
                            </button>
                          ) : (
                            <div style={S.promotedNote}>{t('lore.qgDetail.otherRecs.taskCreated', '→ задача создана')}</div>
                          )
                        ) : rec.status === 'dismissed' ? null : (
                          <div style={S.recActions}>
                            <button style={S.promoteBtn} disabled={promoting === rec.rec_id} onClick={() => handlePromote(rec)}>
                              {promoting === rec.rec_id ? '…' : t('lore.qgDetail.recommendations.createTask', '✅ Создать задачу')}
                            </button>
                            <button style={S.dismissBtn} disabled={dismissing === rec.rec_id} onClick={() => handleDismiss(rec)}>
                              {dismissing === rec.rec_id ? '…' : t('lore.qgDetail.recommendations.dismiss', '✕ Отклонить')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recommendations not already shown inline under an invariant card
            above (either because their key has no matching invariant, or
            because a different rec for the same key already took that slot). */}
        {(() => {
          const orphan = recs.filter(r => !inlineRecIds.has(r.rec_id));
          if (orphan.length === 0) return null;
          return (
            <section style={S.section}>
              <div style={S.secLabel}>
                {t('lore.qgDetail.otherRecs.title', 'Прочие рекомендации')}
                {pendingRecs.length > 0 && (
                  <span style={S.badge('var(--wrn)')}>
                    {t('lore.qgDetail.otherRecs.pendingCount', '{{count}} pending', { count: pendingRecs.length })}
                  </span>
                )}
              </div>
              <div style={S.recList}>
                {orphan.map(rec => {
                  const isPending = rec.status === 'pending';
                  const isPromoted = rec.status === 'promoted';
                  const isDismissed = rec.status === 'dismissed';
                  const recColor = isPending ? 'var(--wrn)' : isPromoted ? 'var(--suc)' : 'var(--t3)';
                  return (
                    <div key={rec.rec_id} style={S.recCard(isDismissed)}>
                      <div style={S.recHeader}>
                        <span style={S.badge(recColor)}>{rec.status ?? 'pending'}</span>
                        {rec.severity && <span style={S.badge(SEV_COLOR[rec.severity] ?? 'var(--t3)')}>{rec.severity}</span>}
                        {rec.inv_id && <span style={S.recInv}>{rec.inv_id}</span>}
                        <span style={S.recId}>{rec.rec_id}</span>
                      </div>
                      <div style={S.recTitle}>{rec.title}</div>
                      {rec.body_md && <MartProse text={rec.body_md} style={S.recBody} />}
                      {isPending && (
                        <div style={S.recActions}>
                          <button style={S.promoteBtn} disabled={promoting === rec.rec_id} onClick={() => handlePromote(rec)}>
                            {promoting === rec.rec_id ? '…' : t('lore.qgDetail.otherRecs.confirmToHousekeeping', '✅ Подтвердить → housekeeping')}
                          </button>
                          <button style={S.dismissBtn} disabled={dismissing === rec.rec_id} onClick={() => handleDismiss(rec)}>
                            {dismissing === rec.rec_id ? '…' : t('lore.qgDetail.recommendations.dismiss', '✕ Отклонить')}
                          </button>
                        </div>
                      )}
                      {isPromoted && (
                        rec.promoted_task_uid && rec.promoted_sprint_id ? (
                          <button
                            style={S.promotedLink}
                            onClick={() => onNavigateToSprint?.(rec.promoted_sprint_id!)}
                            title={t('lore.qgDetail.otherRecs.openSprintTitle', 'Открыть {{sprintId}}', { sprintId: rec.promoted_sprint_id })}
                          >
                            {t('lore.qgDetail.otherRecs.taskLink', '→ задача {{taskUid}}', { taskUid: rec.promoted_task_uid })}
                          </button>
                        ) : (
                          <div style={S.promotedNote}>{t('lore.qgDetail.otherRecs.taskCreated', '→ задача создана')}</div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}
      </div>
    </div>
  );
}

const S = {
  root: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  header: {
    display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0,
    padding: '10px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)',
  },
  backBtn: {
    background: 'transparent', border: '1px solid var(--bd)', borderRadius: 4,
    color: 'var(--t2)', cursor: 'pointer', fontSize: 14, padding: '2px 8px',
    fontFamily: 'inherit', flexShrink: 0, alignSelf: 'center',
  },
  headerMain: { flex: 1, minWidth: 0 },
  headerRow:  { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginBottom: 3 },
  qgId:       { color: 'var(--t3)', fontSize: 11, fontFamily: 'var(--mono)' },
  qgName:     { color: 'var(--t1)', fontSize: 13, fontWeight: 600, marginBottom: 3 },
  desc:       { color: 'var(--t2)', fontSize: 11, marginBottom: 6 },
  statusBadge: (color: string) => ({
    fontSize: 9, padding: '1px 5px', borderRadius: 3,
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
  }),
  compBadge: {
    fontSize: 10, padding: '1px 6px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 28%, transparent)',
  },
  routineBadge: {
    fontSize: 10, padding: '1px 6px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--inf) 10%, transparent)',
    color: 'var(--inf)', border: '1px solid color-mix(in srgb, var(--inf) 26%, transparent)',
    fontFamily: 'var(--mono)',
  },
  sprintLink: {
    fontSize: 10, padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--mono)',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 26%, transparent)',
    cursor: 'pointer',
  },
  provRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  provLabel: { fontSize: 9.5, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  provChip: {
    fontSize: 10, padding: '1px 7px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--purple, #bc8cff) 9%, transparent)',
    color: 'var(--purple, #bc8cff)',
    border: '1px solid color-mix(in srgb, var(--purple, #bc8cff) 24%, transparent)',
  },
  body: { flex: 1, overflowY: 'auto' as const },
  section: { borderBottom: '1px solid var(--bd)', padding: '10px 16px 12px' },
  secLabel: {
    fontSize: 10, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
  },
  secLabelInline: {
    fontSize: 10, fontWeight: 700, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  },
  muted: { color: 'var(--t3)', fontWeight: 400, fontSize: 10 },
  badge: (color: string) => ({
    fontSize: 9, padding: '1px 5px', borderRadius: 3,
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap' as const,
  }),
  emptySection: { color: 'var(--t3)', fontSize: 11, fontStyle: 'italic' as const },

  // run history
  runList: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  runRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  runRowLatest: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'color-mix(in srgb, var(--acc) 5%, transparent)',
    borderRadius: 4, padding: '2px 4px', margin: '0 -4px',
  },
  runDate:  { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0 },
  runId:    { color: 'var(--t3)', fontSize: 9, fontFamily: 'var(--mono)', opacity: 0.6 },
  runLegacy:{ color: 'var(--t3)', fontSize: 9, fontStyle: 'italic' as const },
  runFlags: { color: 'var(--t2)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },

  // methodology
  methToggle: {
    width: '100%', textAlign: 'left' as const, background: 'none', border: 'none',
    padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit',
  },
  methCaret: { color: 'var(--inf)', fontSize: 11 },
  methBody: { paddingTop: 8, paddingLeft: 18, fontSize: 11, color: 'var(--t2)', lineHeight: 1.6 },
  methLine: { marginBottom: 5 },
  methDir: { fontFamily: 'var(--mono)', color: 'var(--suc)', fontSize: 10 },
  methSkip: { fontFamily: 'var(--mono)', color: 'var(--t3)', fontSize: 10 },
  methStrong: { fontWeight: 600, color: 'var(--t1)' },
  methNote: { marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)', color: 'var(--t3)' },

  // changes
  changeRow: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  changeChip: (c: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
    padding: '3px 8px', borderRadius: 4,
    background: `color-mix(in srgb, ${c} 9%, transparent)`,
    border: `1px solid color-mix(in srgb, ${c} 22%, transparent)`,
  }),
  changeKey: { fontFamily: 'var(--mono)', color: 'var(--t2)', fontSize: 10 },

  // invariants
  countRow: { display: 'flex', gap: 4, marginLeft: 'auto' },
  countBadge: (c: string) => ({
    fontSize: 10, padding: '1px 6px', borderRadius: 3,
    background: `color-mix(in srgb, ${c} 12%, transparent)`,
    color: c, border: `1px solid color-mix(in srgb, ${c} 25%, transparent)`, fontWeight: 600,
  }),
  invList: { display: 'flex', flexDirection: 'column' as const, gap: 0 },
  invCard: { padding: '11px 4px 11px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' },
  invMain: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  invNo: { fontSize: 11, color: 'var(--t3)', marginTop: 2, minWidth: 16, paddingLeft: 8 },
  invContent: { flex: 1, minWidth: 0 },
  invHeadRow: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' as const, marginBottom: 2 },
  invKey: (sk: boolean) => ({ fontFamily: 'var(--mono)', fontSize: 11, color: sk ? 'var(--t3)' : 'var(--t1)' }),
  dirBadge: {
    fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--inf)',
    background: 'color-mix(in srgb, var(--inf) 9%, transparent)', padding: '0 5px', borderRadius: 3,
  },
  invDescr: { fontSize: 11, color: 'var(--t3)', lineHeight: 1.4, marginBottom: 4 },
  ruleLine: { fontSize: 10.5, color: 'var(--t2)', lineHeight: 1.45, marginTop: 3, display: 'flex', gap: 6 },
  ruleTag: {
    fontSize: 8.5, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.04em',
    border: '1px solid var(--bd)', borderRadius: 3, padding: '0 4px', flexShrink: 0, alignSelf: 'flex-start',
    marginTop: 1,
  },
  srcWrap: { marginTop: 5 },
  srcToggle: { color: 'var(--inf)', fontSize: 10, cursor: 'pointer', userSelect: 'none' as const },
  srcPre: {
    margin: '5px 0 0', padding: '6px 9px', borderRadius: 5,
    background: 'var(--bg0)', border: '1px solid var(--bd)', fontSize: 10, fontFamily: 'var(--mono)',
    color: 'var(--t2)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
    maxHeight: 120, overflowY: 'auto' as const,
  },
  valBox: { flexShrink: 0, textAlign: 'right' as const, minWidth: 64 },
  valNum: (c: string) => ({ fontFamily: 'var(--mono)', fontSize: 13, color: c, fontWeight: 700 }),
  valTgt: { fontSize: 9, color: 'var(--t3)', marginTop: 1 },
  valSkip: { fontSize: 11, color: 'var(--t3)', fontStyle: 'italic' as const },
  sparkBox: { flexShrink: 0, textAlign: 'center' as const },
  sparkLabel: { fontSize: 8.5, color: 'var(--t3)', marginTop: 1 },
  sparkEmpty: {
    width: 104, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--t3)', fontSize: 9, fontStyle: 'italic' as const,
  },

  // recommendations
  recInline: { margin: '9px 0 1px 26px', padding: '10px 13px', borderRadius: 6, border: '1px solid var(--bd)' },
  recInlineHead: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 },
  recList: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  recCard: (dim: boolean) => ({
    background: dim ? 'transparent' : 'var(--bg2)',
    border: '1px solid var(--bd)', borderRadius: 6, padding: '8px 12px', opacity: dim ? 0.45 : 1,
  }),
  recHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' as const },
  recInv: { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)' },
  recId:  { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)' },
  recTitle: { color: 'var(--t1)', fontSize: 12, fontWeight: 600, marginBottom: 4 },
  recBody:  { color: 'var(--t2)', fontSize: 11, marginBottom: 6 },
  recActions: { display: 'flex', gap: 6, marginTop: 6 },
  promoteBtn: {
    padding: '3px 10px', fontSize: 11, border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)', color: 'var(--acc)',
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
  },
  dismissBtn: {
    padding: '3px 8px', fontSize: 11, border: '1px solid var(--bd)',
    background: 'transparent', color: 'var(--t3)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
  },
  promotedNote: { color: 'var(--suc)', fontSize: 10, marginTop: 4 },
  promotedLink: {
    color: 'var(--suc)', fontSize: 10, marginTop: 4, padding: 0,
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2,
  },
};
