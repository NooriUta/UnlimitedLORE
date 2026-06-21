import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreAdrRow } from '../../api/lore';

const S = {
  root:  { flex: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const },
  row: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 10px', borderBottom: '1px solid var(--b2)',
    fontSize: 11, cursor: 'pointer', minWidth: 0,
  },
  line1: { display: 'flex', alignItems: 'center', minWidth: 0 },
  line2: { display: 'flex', alignItems: 'center', gap: 5 },
  id: {
    flex: 1, color: 'var(--acc)', fontFamily: 'var(--mono)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  component: {
    fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    background: 'var(--b2)', color: 'var(--t3)',
  },
  date: { fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--mono)', flexShrink: 0 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  module: string;
  q: string;
  selectedId?: string;
  onError: (e: unknown) => void;
  onOpen: (id: string) => void;
}

export default function LoreAdrList({ module, q, selectedId, onError, onOpen }: Props) {
  const [rows, setRows]       = useState<LoreAdrRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    const params: Record<string, string> = {};
    if (module) params.component = module;
    fetchLoreSlice<LoreAdrRow>('adrs', params, ctrl.signal)
      .then(r => {
        const filtered = q
          ? r.filter(a => a.adr_id.toLowerCase().includes(q.toLowerCase()))
          : r;
        setRows(filtered);
        setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [module, q, onError]);

  if (loading) return <div style={S.empty}>Загрузка ADR…</div>;
  if (!rows.length) return <div style={S.empty}>ADR не найдены.</div>;

  return (
    <div style={S.root}>
      {rows.map(a => (
        <div
          key={a.adr_id}
          style={{
            ...S.row,
            background: selectedId === a.adr_id
              ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
          }}
          onClick={() => onOpen(a.adr_id)}
        >
          <div style={S.line1}>
            <span style={S.id}>{a.adr_id}</span>
          </div>
          {(a.component || a.date_created) && (
            <div style={S.line2}>
              {a.component && <span style={S.component}>{a.component}</span>}
              {a.date_created && <span style={S.date}>{a.date_created.slice(0, 10)}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
