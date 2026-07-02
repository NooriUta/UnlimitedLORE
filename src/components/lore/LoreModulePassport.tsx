import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreComponentDetail, type LoreSpecRow, type LoreAdrRow } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { specTitle } from './LoreSpecView';

const AREA_COLOR: Record<string, string> = {
  data: '#29b6f6', engine: '#4caf50', algorithm: '#26a69a', ai: '#ab47bc',
  api: '#2196f3', frontend: '#9c27b0', observability: '#ff7043',
  platform: '#ff9800', security: '#ef5350',
};

const S = {
  root: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, overflow: 'hidden' },
  head: { padding: '14px 20px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0 },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' as const },
  icon: { flexShrink: 0, display: 'flex' },
  name: { fontSize: 17, fontWeight: 600, color: 'var(--t1)' },
  area: (a: string) => {
    const c = AREA_COLOR[a] ?? 'var(--t3)';
    return { fontSize: 10, padding: '2px 7px', borderRadius: 3, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, whiteSpace: 'nowrap' as const };
  },
  metaLine: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, fontSize: 11, color: 'var(--t3)', marginBottom: 8 },
  sid:  { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' },
  link: { color: 'var(--acc)', cursor: 'pointer' },
  attrRow:   { display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 },
  attrLabel: { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase' as const, flexShrink: 0, width: 76, letterSpacing: 0.3 },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  tech:  { fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--b2)', color: 'var(--t2)' },
  childChip: { fontSize: 11, padding: '1px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--acc) 10%, transparent)', color: 'var(--acc)', cursor: 'pointer' },
  cols: { flex: 1, display: 'flex', minHeight: 0 },
  col:  { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, minHeight: 0 },
  colDivider: { borderLeft: '1px solid var(--bd)' },
  colHead: { fontSize: 11, fontWeight: 600, color: 'var(--t2)', padding: '8px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  specList: { flex: 1, overflowY: 'auto' as const },
  specRow: (sel: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
    borderBottom: '1px solid var(--bd)', fontSize: 11, cursor: 'pointer',
    background: sel ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent', color: 'var(--t1)',
  }),
  specName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  adrId:     { minWidth: 0, color: 'var(--acc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontFamily: 'var(--mono)', flexShrink: 0, maxWidth: '38%', fontSize: 10 },
  adrName:   { flex: 1, minWidth: 0, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontSize: 11 },
  adrStatus: { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--b2)', color: 'var(--t3)', flexShrink: 0, textTransform: 'uppercase' as const },
  adrDate:   { color: 'var(--t3)', fontSize: 10, flexShrink: 0 },
  empty: { padding: 20, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  componentId: string;
  selectedAdr?: string;
  selectedSpec?: string;
  onError: (e: unknown) => void;
  onOpenAdr: (id: string) => void;
  onOpenSpec: (id: string) => void;
  onSelectComponent: (id: string) => void;
}

export default function LoreModulePassport({
  componentId, selectedAdr, selectedSpec, onError, onOpenAdr, onOpenSpec, onSelectComponent,
}: Props) {
  const { t } = useTranslation();
  const [meta, setMeta]   = useState<LoreComponentDetail | null>(null);
  const [adrs, setAdrs]   = useState<LoreAdrRow[]>([]);
  const [specs, setSpecs] = useState<LoreSpecRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreComponentDetail>('component', { id: componentId }, ctrl.signal),
      fetchLoreSlice<LoreAdrRow>('adrs', { component: componentId }, ctrl.signal),
      fetchLoreSlice<LoreSpecRow>('specs', { component: componentId }, ctrl.signal),
    ])
      .then(([m, ad, sp]) => { setMeta(m[0] ?? null); setAdrs(ad); setSpecs(sp); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [componentId, onError]);

  if (loading) return <div style={S.empty}>{t('lore.modulePassport.loading', 'Загрузка модуля…')}</div>;
  if (!meta)   return <div style={S.empty}>{t('lore.modulePassport.notFound', 'Модуль не найден: {{componentId}}', { componentId })}</div>;

  const tech     = meta.tech ?? [];
  const children = meta.children ?? [];

  return (
    <div style={S.root}>
      <div style={S.head}>
        <div style={S.titleRow}>
          <span style={S.icon}><GameIcon slug={meta.game_icon} size={24} /></span>
          <span style={S.name}>{meta.full_name || meta.component_id}</span>
          <span style={S.area(meta.area)}>{meta.area}</span>
        </div>
        <div style={S.metaLine}>
          <span style={S.sid}>{meta.component_id}</span>
          {meta.parent_id && (
            <span>{t('lore.modulePassport.parentPrefix', '· родитель')} <span style={S.link} onClick={() => onSelectComponent(meta.parent_id!)}>{meta.parent_id}</span></span>
          )}
          <span>{t('lore.modulePassport.adrCount', '· {{count}} ADR', { count: adrs.length })}</span>
          <span>{t('lore.modulePassport.specCount', '· {{count}} спек', { count: specs.length })}</span>
          {children.length > 0 && <span>{t('lore.modulePassport.childrenCount', '· {{count}} дочерних', { count: children.length })}</span>}
        </div>
        {(meta.owner || meta.team) && (
          <div style={S.attrRow}>
            {meta.owner && <><span style={S.attrLabel}>{t('lore.modulePassport.ownerLabel', 'Владелец')}</span><span style={S.tech}>{meta.owner}</span></>}
            {meta.team  && <><span style={{ ...S.attrLabel, marginLeft: meta.owner ? 12 : 0 }}>{t('lore.modulePassport.teamLabel', 'Команда')}</span><span style={S.tech}>{meta.team}</span></>}
          </div>
        )}
        {tech.length > 0 && (
          <div style={S.attrRow}>
            <span style={S.attrLabel}>{t('lore.modulePassport.techLabel', 'Технологии')}</span>
            <div style={S.chips}>{tech.map(tc => <span key={tc} style={S.tech}>{tc}</span>)}</div>
          </div>
        )}
        {children.length > 0 && (
          <div style={S.attrRow}>
            <span style={S.attrLabel}>{t('lore.modulePassport.childrenLabel', 'Дочерние')}</span>
            <div style={S.chips}>{children.map(c => (
              <span key={c} style={S.childChip} onClick={() => onSelectComponent(c)}>{c}</span>
            ))}</div>
          </div>
        )}
      </div>

      <div style={S.cols}>
        <div style={S.col}>
          <div style={S.colHead}>{t('lore.modulePassport.adrColumnHead', 'ADR · {{count}}', { count: adrs.length })}</div>
          <div style={S.specList}>
            {adrs.length === 0 && <div style={S.empty}>{t('lore.modulePassport.noAdrs', 'ADR нет.')}</div>}
            {adrs.map(a => (
              <div key={a.adr_id} style={S.specRow(selectedAdr === a.adr_id)} onClick={() => onOpenAdr(a.adr_id)} title={a.adr_id}>
                <span style={S.adrId}>{a.adr_id}</span>
                <span style={S.adrName}>{a.name ?? a.adr_id}</span>
                {a.status && <span style={S.adrStatus}>{a.status}</span>}
                {a.date_created && <span style={S.adrDate}>{a.date_created.slice(0, 10)}</span>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...S.col, ...S.colDivider }}>
          <div style={S.colHead}>{t('lore.modulePassport.specColumnHead', 'Спецификации · {{count}}', { count: specs.length })}</div>
          <div style={S.specList}>
            {specs.length === 0 && <div style={S.empty}>{t('lore.modulePassport.noSpecs', 'Спек нет.')}</div>}
            {specs.map(s => (
              <div key={s.spec_id} style={S.specRow(selectedSpec === s.spec_id)} onClick={() => onOpenSpec(s.spec_id)} title={s.spec_id}>
                <GameIcon slug="white-book" size={13} />
                <span style={S.specName}>{specTitle(s)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
