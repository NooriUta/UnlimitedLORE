import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';

interface RunbookRow {
  runbook_id: string;
  name: string;
  area: string;
  date_created: string | null;
}

const AREA_COLORS: Record<string, string> = {
  recovery: '#e57373',
  infra:    '#ff9800',
  deploy:   '#2196f3',
  ops:      '#9e9e9e',
};

export default function LoreRunbookList({ onError }: { onError: (e: unknown) => void }) {
  const [rows, setRows]       = useState<RunbookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea]       = useState('');

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<RunbookRow>('runbooks', area ? { area } : undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [area, onError]);

  const areas = ['', 'recovery', 'infra', 'deploy', 'ops'];

  return (
    <div style={S.root}>
      <div style={S.toolbar}>
        {areas.map(a => (
          <button key={a || 'all'} style={S.chip(area === a)} onClick={() => setArea(a)}>
            {a || 'все'}
          </button>
        ))}
      </div>
      {loading ? (
        <div style={S.state}>Загрузка runbooks…</div>
      ) : (
        <div style={S.list}>
          {rows.map(r => (
            <div key={r.runbook_id} style={S.row}>
              <span style={S.area(r.area)}>{r.area}</span>
              <span style={S.id}>{r.runbook_id}</span>
              <span style={S.name}>{r.name}</span>
              <span style={S.date}>{r.date_created?.slice(0, 10) ?? ''}</span>
            </div>
          ))}
          {rows.length === 0 && <div style={S.state}>Runbooks не найдены.</div>}
        </div>
      )}
    </div>
  );
}

const S = {
  root:    { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  toolbar: {
    display: 'flex', gap: 6, padding: '8px 16px',
    borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  chip: (active: boolean) => ({
    height: 24, padding: '0 10px', border: 'none', borderRadius: 3,
    cursor: 'pointer', fontSize: 11,
    background: active ? 'var(--acc)' : 'var(--b2)',
    color: active ? 'var(--bg)' : 'var(--t2)',
  }),
  list:  { flex: 1, overflowY: 'auto' as const },
  state: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 16px', borderBottom: '1px solid var(--bd)', fontSize: 12,
  },
  area: (a: string) => ({
    fontSize: 10, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
    background: `color-mix(in srgb, ${AREA_COLORS[a] ?? '#9e9e9e'} 18%, transparent)`,
    color: AREA_COLORS[a] ?? 'var(--t3)',
    border: `1px solid color-mix(in srgb, ${AREA_COLORS[a] ?? '#9e9e9e'} 30%, transparent)`,
  }),
  id:   { color: 'var(--t3)', fontSize: 11, minWidth: 180, flexShrink: 0 },
  name: { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  date: { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
};
