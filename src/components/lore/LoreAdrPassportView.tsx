import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreAdrPassport } from '../../api/lore';
import { MartProse } from '../bench/MartProse';

const S = {
  root:    { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  back: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--acc)', fontSize: 12, padding: '0 0 12px',
    display: 'block',
  },
  header:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  id:      { fontSize: 15, fontWeight: 600, color: 'var(--t1)' },
  section: { marginTop: 16 },
  sLabel:  { fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' as const, marginBottom: 4 },
  chips:   { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  chip: (clickable: boolean) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 11,
    background: 'var(--b2)', color: clickable ? 'var(--acc)' : 'var(--t2)',
    border: '1px solid var(--b3)', cursor: clickable ? 'pointer' : 'default',
    whiteSpace: 'nowrap' as const,
  }),
  compChip: {
    padding: '2px 7px', borderRadius: 3, fontSize: 11,
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    whiteSpace: 'nowrap' as const,
  },
  date:  { color: 'var(--t3)', fontSize: 11 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  adrId: string;
  onError: (e: unknown) => void;
  onBack: () => void;
  onNavigate: (id: string) => void;
}

export default function LoreAdrPassportView({ adrId, onError, onBack, onNavigate }: Props) {
  const [data, setData]       = useState<LoreAdrPassport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreAdrPassport>('adr', { id: adrId }, ctrl.signal)
      .then(rows => { setData(rows[0] ?? null); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [adrId, onError]);

  if (loading) return <div style={S.empty}>Loading {adrId}…</div>;
  if (!data)   return <div style={S.empty}>ADR not found: {adrId}</div>;

  const components   = data.components   ?? [];
  const dependsOn    = data.depends_on_ids    ?? [];
  const supersedes   = data.supersedes_ids    ?? [];
  const implementedIn = data.implemented_in_ids ?? [];
  const releasedIn   = data.release_ids   ?? [];
  const tags         = data.tags          ?? [];

  return (
    <div style={S.root}>
      <button style={S.back} onClick={onBack}>← К списку</button>

      <div style={S.header}>
        <span style={S.id}>{data.adr_id}</span>
        {components.map(c => (
          <span key={c} style={S.compChip}>{c}</span>
        ))}
        {data.date_created && (
          <span style={S.date}>{data.date_created.slice(0, 10)}</span>
        )}
      </div>

      {data.context_md && (
        <div style={S.section}>
          <div style={S.sLabel}>Context</div>
          <MartProse text={data.context_md} />
        </div>
      )}
      {data.decision_md && (
        <div style={S.section}>
          <div style={S.sLabel}>Decision</div>
          <MartProse text={data.decision_md} />
        </div>
      )}
      {data.consequences_md && (
        <div style={S.section}>
          <div style={S.sLabel}>Consequences</div>
          <MartProse text={data.consequences_md} />
        </div>
      )}

      {dependsOn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Depends on</div>
          <div style={S.chips}>
            {dependsOn.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {supersedes.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Supersedes</div>
          <div style={S.chips}>
            {supersedes.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {implementedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Implemented in sprint</div>
          <div style={S.chips}>
            {implementedIn.map(id => (
              <span key={id} style={S.chip(false)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {releasedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Released in</div>
          <div style={S.chips}>
            {releasedIn.map(id => (
              <span key={id} style={S.chip(false)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {tags.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Tags</div>
          <div style={S.chips}>
            {tags.map(t => <span key={t} style={S.chip(false)}>{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
