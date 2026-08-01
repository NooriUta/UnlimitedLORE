// SCD2 history viewer — LAL-24
// LHR-01: no auto-load · LHR-03: status icon · LHR-04: HH:MM time
// LHR-05: diff column  · LHR-06: master-detail · LHR-08: summary header
// AL-30: diff was hardcoded to status_raw only, while the backend already sent
// every versioned field (priority/dates/track/pr_refs/bodies for sprint,
// bodies for adr, effort_days/note_md for task — see history_sprint/adr_history/
// history_task in LoreSlices.java). Owner's complaint ("вижу только статус")
// was about THIS component, not a missing backend field. Diff is now
// data-driven per kind: short scalar fields show "old → new", long markdown
// bodies show a "changed" badge (full diff is a re-open, not a table cell).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreHistRow } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta } from './lore-status';
import { normalizeStatus } from './loreUtils';

type EntityKind = 'sprint' | 'adr' | 'task';

const SLICE: Record<EntityKind, string> = {
  sprint: 'history_sprint',
  adr:    'adr_history',
  task:   'history_task',
};

const ENTITY: Record<EntityKind, { slice: string; id: string; label?: string }> = {
  sprint: { slice: 'sprints',   id: 'sprint_id', label: 'name' },
  adr:    { slice: 'adrs',      id: 'adr_id' },
  task:   { slice: 'all_tasks', id: 'task_uid',  label: 'title' },
};

// Fields tracked per revision, beyond valid_from/valid_to/content_hash/source_commit.
// hasStatus: rendered via the existing status-icon column + status diff badge.
// short: scalar/short-string fields — diff badge shows "old → new".
// long: markdown bodies — diff badge shows only "изменено" (no cell can hold a body diff).
interface KindFieldConfig {
  hasStatus: boolean;
  short: { key: keyof LoreHistRow; label: string }[];
  long: { key: keyof LoreHistRow; label: string }[];
}

const FIELDS: Record<EntityKind, KindFieldConfig> = {
  sprint: {
    hasStatus: true,
    short: [
      { key: 'priority',           label: 'приоритет' },
      { key: 'planned_start_date', label: 'начало' },
      { key: 'planned_end_date',   label: 'конец' },
      { key: 'track_id',           label: 'трек' },
      { key: 'pr_refs',            label: 'PR' },
    ],
    long: [
      { key: 'context_md', label: 'контекст' },
      { key: 'outcome_md', label: 'итог' },
    ],
  },
  adr: {
    hasStatus: false,
    short: [],
    long: [
      { key: 'context_md',       label: 'контекст' },
      { key: 'decision_md',      label: 'решение' },
      { key: 'consequences_md',  label: 'последствия' },
    ],
  },
  task: {
    hasStatus: true,
    short: [
      { key: 'effort_days', label: 'оценка' },
    ],
    long: [
      { key: 'note_md', label: 'заметка' },
    ],
  },
};

interface EntityOpt { id: string; label: string; }

interface DiffRow {
  status?: string;
  changed: string[]; // short-field "label: old → new" + long-field "label изменено" entries
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  return String(v);
}

function computeDiff(kind: EntityKind, cur: LoreHistRow, prev: LoreHistRow): DiffRow {
  const cfg = FIELDS[kind];
  const d: DiffRow = { changed: [] };

  if (cfg.hasStatus) {
    const cs = normalizeStatus(cur.status_raw ?? null);
    const ps = normalizeStatus(prev.status_raw ?? null);
    if (cs && ps && cs !== ps) d.status = `${ps} → ${cs}`;
  }

  for (const f of cfg.short) {
    const cv = cur[f.key];
    const pv = prev[f.key];
    if (cv !== pv) d.changed.push(`${f.label}: ${fmtScalar(pv)} → ${fmtScalar(cv)}`);
  }

  for (const f of cfg.long) {
    const cv = (cur[f.key] as string | null | undefined) ?? '';
    const pv = (prev[f.key] as string | null | undefined) ?? '';
    if (cv !== pv) {
      const delta = cv.length - pv.length;
      const sign = delta > 0 ? '+' : '';
      d.changed.push(pv === '' ? `${f.label} добавлен` : `${f.label} изменён (${sign}${delta})`);
    }
  }

  return d;
}

interface Props { onError: (e: unknown) => void; }

export default function LoreEvolutionView({ onError }: Props) {
  const { t } = useTranslation();
  const [kind,        setKind]        = useState<EntityKind>('sprint');
  const [rows,        setRows]        = useState<LoreHistRow[]>([]);
  const [loadedId,    setLoadedId]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [picker,      setPicker]      = useState<EntityOpt[]>([]);
  const [pickerErr,   setPickerErr]   = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    const cfg = ENTITY[kind];
    const ctrl = new AbortController();
    setPicker([]);
    setPickerErr(false);
    setLoadingList(true);
    setRows([]);
    setLoadedId('');
    fetchLoreSlice<Record<string, unknown>>(cfg.slice, undefined, ctrl.signal)
      .then(recs => {
        const opts: EntityOpt[] = recs
          .map(r => {
            const id    = String(r[cfg.id] ?? '');
            const lbl   = cfg.label ? String(r[cfg.label] ?? '') : '';
            return { id, label: lbl && lbl !== id ? `${id} · ${lbl}` : id };
          })
          .filter(o => o.id && o.id.length >= 2)   // LHR-02: skip single-char junk
          .sort((a, b) => a.id.localeCompare(b.id));
        setPicker(opts);
        setLoadingList(false);
        // LHR-01: intentionally NO auto-load — show empty state instead
      })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setPickerErr(true); setLoadingList(false); } });
    return () => ctrl.abort();
  }, [kind, onError]);

  function load(id: string) {
    if (!id) return;
    setLoading(true);
    fetchLoreSlice<LoreHistRow>(SLICE[kind], { id })
      .then(r => { setRows(r); setLoadedId(id); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
  }

  const diffs = useMemo<DiffRow[]>(() => {
    return rows.map((r, i) => i === 0 ? { changed: [] } : computeDiff(kind, r, rows[i - 1]));
  }, [rows, kind]);

  const showStatusCol = FIELDS[kind].hasStatus;

  // LHR-08: summary data — history_sprint/adr_history/history_task all `ORDER BY
  // valid_from` ascending, so rows[0] is the OLDEST revision and the last row is
  // current (valid_to IS NULL).
  const firstRow = rows[0];
  const curRow   = rows[rows.length - 1];
  const curStatus = curRow && showStatusCol ? normalizeStatus(curRow.status_raw ?? null) : null;
  const curMeta   = curStatus ? statusMeta(curStatus) : null;

  return (
    <div style={S.root}>
      {/* ── Kind selector ────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        {(['sprint', 'adr', 'task'] as EntityKind[]).map(k => (
          <button
            key={k}
            style={{ ...S.kindBtn, ...(kind === k ? S.kindBtnActive : {}) }}
            onClick={() => setKind(k)}
          >
            {k === 'sprint'
              ? t('lore.evolutionView.kindSprint', 'Спринт')
              : k === 'adr'
                ? t('lore.evolutionView.kindAdr', 'ADR')
                : t('lore.evolutionView.kindTask', 'Задача')}
          </button>
        ))}
        <span style={S.hint}>
          {loadingList
            ? t('lore.evolutionView.loadingHint', 'загрузка…')
            : pickerErr
              ? t('lore.evolutionView.listErrorHint', 'ошибка списка')
              : t('lore.evolutionView.entityCountHint', '{{count}} сущностей', { count: picker.length })}
        </span>
      </div>

      <div style={S.body}>
        {/* ── LHR-06: left entity list ─────────────────────────────────── */}
        <div style={S.listPane}>
          {pickerErr && <div style={S.msg}>{t('lore.evolutionView.listLoadError', 'Ошибка загрузки списка.')}</div>}
          {picker.map(o => {
            const namePart = o.label !== o.id ? o.label.replace(/^[^·]+·\s*/, '') : '';
            return (
              <div
                key={o.id}
                style={{
                  ...S.listRow,
                  background: loadedId === o.id
                    ? 'color-mix(in srgb, var(--acc) 10%, transparent)'
                    : 'transparent',
                }}
                onClick={() => load(o.id)}
              >
                <span style={S.listId}>{o.id}</span>
                {namePart && <span style={S.listLabel}>{namePart}</span>}
              </div>
            );
          })}
        </div>

        {/* ── Right: history detail ────────────────────────────────────── */}
        <div style={S.histPane}>
          {/* LHR-01: empty state */}
          {!loadedId && !loading && (
            <div style={S.msg}>
              {t('lore.evolutionView.selectEntityHint', 'Выберите сущность из списка слева для просмотра SCD2-истории.')}
            </div>
          )}
          {loading && <div style={S.msg}>{t('lore.evolutionView.loading', 'Загрузка…')}</div>}
          {!loading && loadedId && rows.length === 0 && (
            <div style={S.msg}>{t('lore.evolutionView.emptyHistory', 'История пуста для «{{id}}».', { id: loadedId })}</div>
          )}

          {/* LHR-08: summary header */}
          {rows.length > 0 && (
            <div style={S.summary}>
              <span style={S.sumId}>{loadedId}</span>
              <span style={S.sumDot}>·</span>
              <span style={S.sumInfo}>{t('lore.evolutionView.revisionsCount', '{{count}} ревизий', { count: rows.length })}</span>
              {firstRow?.valid_from && (
                <>
                  <span style={S.sumDot}>·</span>
                  <span style={S.sumInfo}>{t('lore.evolutionView.createdOn', 'создано {{date}}', { date: firstRow.valid_from.slice(0, 10) })}</span>
                </>
              )}
              {curRow && curRow !== firstRow && curRow.valid_from && (
                <>
                  <span style={S.sumDot}>·</span>
                  <span style={S.sumInfo}>{t('lore.evolutionView.editedOn', 'ред. {{date}}', { date: curRow.valid_from.slice(0, 10) })}</span>
                </>
              )}
              {curMeta && curStatus && (
                <>
                  <span style={S.sumDot}>·</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <GameIcon slug={curMeta.icon} size={11} style={{ color: curMeta.color }} />
                    <span style={{ fontSize: 'var(--fs-sm)', color: curMeta.color }}>{curStatus}</span>
                  </span>
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>valid_from</th>
                  <th style={S.th}>valid_to</th>
                  {showStatusCol && <th style={S.th}>{t('lore.evolutionView.colStatus', 'статус')}</th>}
                  <th style={S.th}>Δ</th>
                  <th style={S.th}>hash</th>
                  <th style={S.th}>commit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const norm = showStatusCol ? normalizeStatus(r.status_raw ?? null) : null;
                  const meta = norm ? statusMeta(norm) : null;
                  const diff = diffs[i];
                  const isCurrent = r.valid_to == null;
                  return (
                    <tr key={i} style={{
                      ...S.trow,
                      background: isCurrent
                        ? 'color-mix(in srgb, var(--acc) 8%, transparent)'
                        : 'transparent',
                    }}>
                      <td style={{ ...S.td, color: 'var(--t3)' }}>{i + 1}</td>
                      {/* LHR-04: date + HH:MM */}
                      <td style={S.td}>{fmtDate(r.valid_from)}</td>
                      <td style={{ ...S.td, color: isCurrent ? 'var(--suc)' : 'var(--t3)' }}>
                        {isCurrent ? t('lore.evolutionView.currentMarker', '✓ текущая') : fmtDate(r.valid_to)}
                      </td>
                      {/* LHR-03: status → icon + tooltip */}
                      {showStatusCol && (
                        <td style={S.td} title={r.status_raw ?? ''}>
                          {norm && meta ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <GameIcon slug={meta.icon} size={11} style={{ color: meta.color }} />
                              <span style={{ color: meta.color }}>{norm}</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--t3)' }}>{r.status_raw ?? '—'}</span>
                          )}
                        </td>
                      )}
                      {/* LHR-05 (AL-30): diff markers — status + every changed field, not status-only */}
                      <td style={S.tdDiff}>
                        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3 }}>
                          {diff?.status && <span style={S.diffBadge}>{diff.status}</span>}
                          {diff?.changed.map((c, ci) => (
                            <span key={ci} style={S.diffBadgeMuted}>{c}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...S.tdMono, color: 'var(--t3)' }}>
                        {r.content_hash?.slice(0, 8) ?? '—'}
                      </td>
                      <td style={{ ...S.tdMono, color: 'var(--acc)' }}>
                        {r.source_commit?.slice(0, 7) ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  root: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  topBar: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderBottom: '1px solid var(--bd)',
    flexShrink: 0,
  },
  kindBtn: {
    height: 26, padding: '0 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
    border: '1px solid var(--b3)', borderRadius: 4,
    background: 'transparent', color: 'var(--t2)', fontFamily: 'inherit',
  },
  kindBtnActive: {
    background: 'color-mix(in srgb, var(--acc) 15%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 35%, transparent)',
  },
  hint: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginLeft: 8 },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },

  // LHR-06: master-detail
  listPane: {
    width: 220, flexShrink: 0,
    borderRight: '1px solid var(--bd)',
    overflowY: 'auto' as const,
  },
  listRow: {
    display: 'flex', flexDirection: 'column' as const,
    padding: '5px 10px', borderBottom: '1px solid var(--bd)',
    cursor: 'pointer',
  },
  listId: {
    fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  listLabel: {
    fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginTop: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },

  histPane: {
    flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const,
  },
  msg: { padding: '24px 16px', color: 'var(--t3)', fontSize: 'var(--fs-base)' },

  // LHR-08: summary
  summary: {
    display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const,
    padding: '8px 14px', borderBottom: '1px solid var(--bd)',
    background: 'var(--b2)', flexShrink: 0,
  },
  sumId:   { fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--t1)' },
  sumDot:  { fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  sumInfo: { fontSize: 'var(--fs-sm)', color: 'var(--t2)' },

  tbl: {
    width: '100%', borderCollapse: 'collapse' as const,
    fontSize: 'var(--fs-sm)', tableLayout: 'auto' as const,
  },
  th: {
    padding: '6px 12px', textAlign: 'left' as const,
    fontWeight: 600, fontSize: 'var(--fs-xs)', color: 'var(--t3)',
    borderBottom: '2px solid var(--bd)', background: 'var(--b1)',
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0,
  },
  trow: { borderBottom: '1px solid var(--bd)' },
  td: {
    padding: '5px 12px', color: 'var(--t1)', fontSize: 'var(--fs-sm)',
    whiteSpace: 'nowrap' as const,
  },
  tdDiff: {
    padding: '5px 12px', fontSize: 'var(--fs-xs)', color: 'var(--t3)',
  },
  tdMono: {
    padding: '5px 12px', fontFamily: 'monospace', fontSize: 'var(--fs-xs)',
    whiteSpace: 'nowrap' as const,
  },
  diffBadge: {
    display: 'inline-block', padding: '1px 5px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--wrn) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--wrn) 28%, transparent)',
    color: 'var(--wrn)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' as const,
  },
  diffBadgeMuted: {
    display: 'inline-block', padding: '1px 5px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--t3) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--t3) 28%, transparent)',
    color: 'var(--t2)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' as const,
  },
};
