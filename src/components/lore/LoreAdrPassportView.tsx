import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreAdrPassport } from '../../api/lore';
import { MartProse } from '../bench/MartProse';
import LoreAdrEditor from './LoreAdrEditor';
import { adrStatusLabel } from './LoreAdrList';

const STATUS_COLOR: Record<string, string> = {
  PROPOSED:   'var(--inf)',
  ACCEPTED:   'var(--suc)',
  DEPRECATED: 'var(--wrn)',
  SUPERSEDED: 'var(--t3)',
};

const S = {
  root:    { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  topBar:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  back: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--acc)', fontSize: 'var(--fs-base)', padding: 0,
  },
  editBtn: {
    background: 'none', border: '1px solid var(--b3)', cursor: 'pointer',
    color: 'var(--t2)', fontSize: 'var(--fs-sm)', padding: '2px 10px', borderRadius: 4,
  },
  header:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  id:      { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' },
  name:    { fontSize: 'var(--fs-md)', color: 'var(--t2)', flex: 1 },
  statusChip: (status: string) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' as const,
    color: STATUS_COLOR[status] ?? 'var(--t3)',
    background: `color-mix(in srgb, ${STATUS_COLOR[status] ?? 'var(--t3)'} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${STATUS_COLOR[status] ?? 'var(--t3)'} 30%, transparent)`,
  }),
  section: { marginTop: 16 },
  sLabel:  { fontSize: 'var(--fs-sm)', color: 'var(--t3)', textTransform: 'uppercase' as const, marginBottom: 4 },
  prose:   { fontSize: 'var(--fs-sm)' },
  chips:   { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  chip: (clickable: boolean) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)',
    background: 'var(--b2)', color: clickable ? 'var(--acc)' : 'var(--t2)',
    border: '1px solid var(--b3)', cursor: clickable ? 'pointer' : 'default',
    whiteSpace: 'nowrap' as const,
  }),
  compChip: {
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)',
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    whiteSpace: 'nowrap' as const,
  },
  date:  { color: 'var(--t3)', fontSize: 'var(--fs-sm)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
};

interface Props {
  adrId: string;
  onError: (e: unknown) => void;
  onBack: () => void;
  onNavigate: (id: string) => void;
}

export default function LoreAdrPassportView({ adrId, onError, onBack, onNavigate }: Props) {
  const { t } = useTranslation();
  const [data, setData]       = useState<LoreAdrPassport | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [reload, setReload]   = useState(0);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreAdrPassport>('adr', { id: adrId }, ctrl.signal)
      .then(rows => { setData(rows[0] ?? null); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adrId, reload]);

  if (loading) return <div style={S.empty}>{t('lore.adrPassportView.loading', 'Загрузка {{adrId}}…', { adrId })}</div>;
  if (!data)   return <div style={S.empty}>{t('lore.adrPassportView.notFound', 'ADR не найден: {{adrId}}', { adrId })}</div>;

  if (editing) {
    return (
      <LoreAdrEditor
        lockId
        initial={{
          adr_id:          data.adr_id,
          name:            data.name            ?? '',
          status:          (data.status?.toUpperCase()) ?? 'PROPOSED',
          date_created:    data.date_created    ?? '',
          context_md:      data.context_md      ?? '',
          decision_md:     data.decision_md     ?? '',
          consequences_md: data.consequences_md ?? '',
          depends_on_ids:  data.depends_on_ids  ?? [],
          supersedes_ids:  data.supersedes_ids  ?? [],
          component_ids:   data.components      ?? [],
          tags:            data.tags            ?? [],
        }}
        onSaved={() => { setEditing(false); setReload(r => r + 1); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const components    = data.components        ?? [];
  const dependsOn     = data.depends_on_ids    ?? [];
  const supersedes    = data.supersedes_ids    ?? [];
  const implementedIn = data.implemented_in_ids ?? [];
  const releasedIn    = data.release_ids        ?? [];
  const tags          = data.tags              ?? [];

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <button style={S.back} onClick={onBack}>{t('lore.adrPassportView.backToList', '← К списку')}</button>
        <button style={S.editBtn} onClick={() => setEditing(true)}>{t('lore.adrPassportView.edit', '✎ Редактировать')}</button>
      </div>

      <div style={S.header}>
        <span style={S.id}>{data.adr_id}</span>
        {data.status && <span style={S.statusChip(data.status.toUpperCase())}>{adrStatusLabel(t, data.status.toUpperCase())}</span>}
        {data.name && <span style={S.name}>{data.name}</span>}
        {components.map(c => <span key={c} style={S.compChip}>{c}</span>)}
        {data.date_created && <span style={S.date}>{data.date_created.slice(0, 10)}</span>}
      </div>

      {data.context_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.context', 'Context')}</div>
          <MartProse text={data.context_md} style={S.prose} />
        </div>
      )}
      {data.decision_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.decision', 'Decision')}</div>
          <MartProse text={data.decision_md} style={S.prose} />
        </div>
      )}
      {data.consequences_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.consequences', 'Consequences')}</div>
          <MartProse text={data.consequences_md} style={S.prose} />
        </div>
      )}

      {dependsOn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.dependsOn', 'Depends on')}</div>
          <div style={S.chips}>
            {dependsOn.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {supersedes.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.supersedes', 'Supersedes')}</div>
          <div style={S.chips}>
            {supersedes.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {implementedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.implementedInSprint', 'Implemented in sprint')}</div>
          <div style={S.chips}>
            {implementedIn.map(id => <span key={id} style={S.chip(false)}>{id}</span>)}
          </div>
        </div>
      )}
      {releasedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.releasedIn', 'Released in')}</div>
          <div style={S.chips}>
            {releasedIn.map(id => <span key={id} style={S.chip(false)}>{id}</span>)}
          </div>
        </div>
      )}
      {tags.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.tags', 'Tags')}</div>
          <div style={S.chips}>
            {tags.map(tag => <span key={tag} style={S.chip(false)}>{tag}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
