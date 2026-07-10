import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSpec, type LoreSpecPassport } from '../../api/lore';
import { MartProse } from '../bench/MartProse';

const S = {
  root:  { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  back: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--acc)', fontSize: 'var(--fs-base)', padding: '0 0 12px', display: 'block',
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' as const },
  title:  { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' },
  compChip: {
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)',
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  meta:    { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' as const, fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  sid:     { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  summary: {
    fontSize: 'var(--fs-base)', color: 'var(--t2)', fontStyle: 'italic' as const,
    borderLeft: '2px solid var(--b3)', padding: '2px 0 2px 10px', marginBottom: 14,
  },
  path:  { marginTop: 18, paddingTop: 10, borderTop: '1px solid var(--bd)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
};

export function specTitle(s: { title: string | null; spec_id: string }): string {
  return (s.title && s.title.trim()) || s.spec_id.replace(/[_-]+/g, ' ');
}

interface Props {
  specId: string;
  onError: (e: unknown) => void;
  onBack: () => void;
  onNavigateComponent?: (componentId: string) => void;
}

export default function LoreSpecView({ specId, onError, onBack, onNavigateComponent }: Props) {
  const { t } = useTranslation();
  const [data, setData]       = useState<LoreSpecPassport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSpec(specId, ctrl.signal)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [specId, onError]);

  if (loading) return <div style={S.empty}>{t('lore.specView.loading', 'Загрузка {{specId}}…', { specId })}</div>;
  if (!data)   return <div style={S.empty}>{t('lore.specView.notFound', 'Спека не найдена: {{specId}}', { specId })}</div>;

  return (
    <div style={S.root}>
      <button style={S.back} onClick={onBack}>{t('lore.specView.backButton', '← К списку')}</button>

      <div style={S.header}>
        <span style={S.title}>{specTitle(data)}</span>
        {data.component_id && (
          <span style={S.compChip} onClick={() => onNavigateComponent?.(data.component_id!)}>
            {data.component_id}
          </span>
        )}
      </div>
      <div style={S.meta}>
        <span style={S.sid}>{data.spec_id}</span>
        {data.version    && <span>· v{data.version}</span>}
        {data.valid_from && <span>· {data.valid_from.slice(0, 10)}</span>}
      </div>

      {data.summary && <div style={S.summary}>{data.summary}</div>}

      {data.content_md
        ? <MartProse text={data.content_md} />
        : <div style={S.empty}>{t('lore.specView.emptyContent', 'Контент пуст.')}</div>}

      {data.file_path && <div style={S.path}>{data.file_path}</div>}
    </div>
  );
}
