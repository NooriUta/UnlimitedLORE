// SCD2 history viewer + plan versions — LAL-24
// Slices: history_sprint · history_plan_item · adr_history · plan_versions
import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreHistRow, type LorePlanVersion } from '../../api/lore';

type EntityKind = 'sprint' | 'plan_item' | 'adr';

const SLICE: Record<EntityKind, string> = {
  sprint:    'history_sprint',
  plan_item: 'history_plan_item',
  adr:       'adr_history',
};

// Where to get the list of pickable entities for each kind, and which fields
// carry the id + a human label.
const ENTITY: Record<EntityKind, { slice: string; id: string; label?: string }> = {
  sprint:    { slice: 'sprints',    id: 'sprint_id', label: 'name' },
  plan_item: { slice: 'plan_items', id: 'item_id',   label: 'label' },
  adr:       { slice: 'adrs',       id: 'adr_id' },
};

interface EntityOpt { id: string; label: string; }

interface Props { onError: (e: unknown) => void; }

export default function LoreEvolutionView({ onError }: Props) {
  const [kind,      setKind]      = useState<EntityKind>('sprint');
  const [idInput,   setIdInput]   = useState('');
  const [rows,      setRows]      = useState<LoreHistRow[]>([]);
  const [versions,  setVersions]  = useState<LorePlanVersion[]>([]);
  const [loadedId,  setLoadedId]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [picker,    setPicker]    = useState<EntityOpt[]>([]);
  const [pickerErr, setPickerErr] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<LorePlanVersion>('plan_versions', undefined, ctrl.signal)
      .then(setVersions)
      .catch(onError);
    return () => ctrl.abort();
  }, [onError]);

  // Load the entity picker list whenever kind changes, then auto-load the first.
  useEffect(() => {
    const cfg = ENTITY[kind];
    const ctrl = new AbortController();
    setPicker([]);
    setPickerErr(false);
    fetchLoreSlice<Record<string, unknown>>(cfg.slice, undefined, ctrl.signal)
      .then(recs => {
        const opts: EntityOpt[] = recs
          .map(r => {
            const id = String(r[cfg.id] ?? '');
            const lbl = cfg.label ? String(r[cfg.label] ?? '') : '';
            return { id, label: lbl && lbl !== id ? `${id} · ${lbl}` : id };
          })
          .filter(o => o.id)
          .sort((a, b) => a.id.localeCompare(b.id));
        setPicker(opts);
        if (opts[0]) load(opts[0].id);
      })
      .catch(e => { onError(e); setPickerErr(true); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function load(explicitId?: string) {
    const id = (explicitId ?? idInput).trim();
    if (!id) return;
    setIdInput(id);
    setLoading(true);
    fetchLoreSlice<LoreHistRow>(SLICE[kind], { id })
      .then(r => { setRows(r); setLoadedId(id); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
  }

  return (
    <div style={S.root}>
      {/* ── Selector row ──────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <select value={kind} onChange={e => setKind(e.target.value as EntityKind)} style={S.sel}>
          <option value="sprint">Спринт</option>
          <option value="plan_item">PlanItem</option>
          <option value="adr">ADR</option>
        </select>
        {/* Entity picker — replaces blind ID typing */}
        <select
          value={loadedId}
          onChange={e => load(e.target.value)}
          style={{ ...S.sel, flex: 1, minWidth: 220, maxWidth: 360 }}
          disabled={picker.length === 0}
        >
          {picker.length === 0 && <option value="">{pickerErr ? '— ошибка загрузки —' : '— загрузка списка… —'}</option>}
          {picker.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {/* Manual ID fallback for ids not in the (possibly truncated) list */}
        <input
          value={idInput}
          onChange={e => setIdInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="…или ID вручную"
          style={{ ...S.inp, flex: '0 1 160px', minWidth: 120 }}
        />
        <button onClick={() => load()} style={S.btn}>Загрузить</button>
        {loadedId && (
          <span style={S.hint}>{loadedId} · {rows.length} ревизий</span>
        )}
      </div>

      <div style={S.body}>
        {/* ── History table ────────────────────────────────────────────────── */}
        <div style={S.histPane}>
          {loading && <div style={S.msg}>Загрузка…</div>}
          {!loading && rows.length === 0 && loadedId && (
            <div style={S.msg}>История пуста для «{loadedId}».</div>
          )}
          {!loading && !loadedId && (
            <div style={S.msg}>
              Выберите тип сущности и введите ID для просмотра SCD2-истории.
            </div>
          )}
          {rows.length > 0 && (
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>valid_from</th>
                  <th style={S.th}>valid_to</th>
                  {kind === 'sprint'    && <th style={S.th}>status</th>}
                  {kind === 'plan_item' && <th style={S.th}>weeks</th>}
                  <th style={S.th}>hash</th>
                  <th style={S.th}>commit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{
                    ...S.trow,
                    background: r.valid_to == null
                      ? 'color-mix(in srgb, var(--acc) 8%, transparent)'
                      : 'transparent',
                  }}>
                    <td style={{ ...S.td, color: 'var(--t3)' }}>{i + 1}</td>
                    <td style={S.td}>{r.valid_from?.slice(0, 10) ?? '—'}</td>
                    <td style={{ ...S.td, color: r.valid_to == null ? 'var(--suc)' : 'var(--t3)' }}>
                      {r.valid_to?.slice(0, 10) ?? '✓ current'}
                    </td>
                    {kind === 'sprint' && (
                      <td style={S.td}>{r.status_raw ?? '—'}</td>
                    )}
                    {kind === 'plan_item' && (
                      <td style={S.td}>
                        {r.week_start != null ? `W${r.week_start}–${r.week_end}` : '—'}
                      </td>
                    )}
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 10, color: 'var(--t3)' }}>
                      {r.content_hash?.slice(0, 8) ?? '—'}
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 10, color: 'var(--acc)' }}>
                      {r.source_commit?.slice(0, 7) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Plan versions sidebar ─────────────────────────────────────────── */}
        <div style={S.versPane}>
          <div style={S.versHdr}>Версии плана ({versions.length})</div>
          {versions.map(v => (
            <div key={v.version_id} style={S.versRow}>
              <div style={S.versId}>{v.version_id}</div>
              <div style={S.versDate}>{v.version_date?.slice(0, 10) ?? ''}</div>
              {v.changelog_md && (
                <div style={S.versClog}>{v.changelog_md.slice(0, 100)}</div>
              )}
            </div>
          ))}
          {versions.length === 0 && <div style={S.msg}>Нет версий.</div>}
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
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderBottom: '1px solid var(--bd)',
    flexShrink: 0, flexWrap: 'wrap' as const,
  },
  sel: {
    height: 26, padding: '0 6px', fontSize: 11,
    border: '1px solid var(--b3)', borderRadius: 4,
    background: 'var(--b2)', color: 'var(--t1)',
    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
  },
  inp: {
    flex: 1, minWidth: 220, height: 26, padding: '0 8px',
    fontSize: 11, fontFamily: 'var(--mono)',
    border: '1px solid var(--b3)', borderRadius: 4,
    background: 'var(--b2)', color: 'var(--t1)', outline: 'none',
  },
  btn: {
    height: 26, padding: '0 12px', fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--acc)', borderRadius: 4,
    background: 'color-mix(in srgb, var(--acc) 15%, transparent)',
    color: 'var(--acc)', fontFamily: 'inherit',
  },
  hint: { fontSize: 10, color: 'var(--t3)' },
  body: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  histPane: {
    flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const,
    padding: '8px 0',
  },
  msg: {
    padding: '24px 16px', color: 'var(--t3)', fontSize: 12,
  },
  tbl: {
    width: '100%', borderCollapse: 'collapse' as const,
    fontSize: 11, tableLayout: 'auto' as const,
  },
  th: {
    padding: '6px 12px', textAlign: 'left' as const,
    fontWeight: 600, fontSize: 10, color: 'var(--t3)',
    borderBottom: '2px solid var(--bd)', background: 'var(--b1)',
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0,
  },
  trow: {
    borderBottom: '1px solid var(--bd)',
  },
  td: {
    padding: '5px 12px', color: 'var(--t1)', fontSize: 11,
    whiteSpace: 'nowrap' as const,
  },
  versPane: {
    width: 260, flexShrink: 0,
    borderLeft: '1px solid var(--bd)',
    overflowY: 'auto' as const,
    display: 'flex', flexDirection: 'column' as const,
  },
  versHdr: {
    padding: '8px 12px', fontWeight: 600, fontSize: 11,
    borderBottom: '1px solid var(--bd)', flexShrink: 0,
    color: 'var(--t2)',
  },
  versRow: {
    padding: '8px 12px', borderBottom: '1px solid var(--bd)',
  },
  versId: {
    fontSize: 11, fontWeight: 600, color: 'var(--acc)',
    fontFamily: 'var(--mono)',
  },
  versDate: { fontSize: 10, color: 'var(--t3)', marginTop: 2 },
  versClog: {
    fontSize: 10, color: 'var(--t2)', marginTop: 4,
    overflow: 'hidden', textOverflow: 'ellipsis',
    display: '-webkit-box', WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
};
