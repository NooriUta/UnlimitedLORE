import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, upsertTech, type LoreComponent, type LoreTechRow } from '../../api/lore';
import { areaColor, compArea } from './LoreComponentList';
import { GameIcon } from './GameIcon';
import LoreSkeleton from './LoreSkeleton';
import { FilterBar, Chip, type FilterTagData } from './FilterPrimitives';

// checked_at older than this reads as stale — same intent as TR-05's
// "не разово, а по регламенту" (a registry with no upkeep signal rots).
const STALE_MONTHS = 6;

export function isStale(checkedAt: string | null): boolean {
  if (!checkedAt) return true;
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  return d < cutoff;
}

// content_md is a small "- **Label:** value" bullet list (see upsertTech) —
// pull out the fields we want to show as columns instead of dumping raw MD.
export function parseFields(md: string | null): {
  license: string | null; releaseDate: string | null; source: string | null;
  ourRelease: string | null; usage: string | null;
} {
  const get = (label: string) => {
    const m = md?.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  return {
    releaseDate: get('Дата релиза'),
    license: get('Лицензия'),
    source: get('Источник'),
    ourRelease: get('Наш релиз'),
    usage: get('Использование'),
  };
}

const S = {
  root: { flex: 1, overflowY: 'auto' as const, padding: '14px 20px' },
  areaHeader: {
    display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 6,
    fontSize: 'var(--fs-base)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  compBlock: { marginBottom: 14, background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' as const },
  compHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--fs-base)' },
  th: { textAlign: 'left' as const, padding: '5px 12px', color: 'var(--t3)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontWeight: 600 },
  td: { padding: '5px 12px', borderTop: '1px solid var(--bd)', color: 'var(--t2)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
};

export default function LoreTechRegistry({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [comps, setComps] = useState<LoreComponent[]>([]);
  const [rows, setRows]   = useState<LoreTechRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  // T34: filter the registry to components using a selected technology
  // ("which components use ArcadeDB?"). Empty = show all.
  const [techSel, setTechSel] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchLoreSlice<LoreComponent>('components', {}),
      fetchLoreSlice<LoreTechRow>('tech_registry', {}),
    ])
      .then(([c, r]) => { setComps(c ?? []); setRows(r ?? []); })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [reloadKey, onError]);

  const byArea = useMemo(() => {
    const m = new Map<string, LoreComponent[]>();
    for (const c of comps) {
      const a = compArea(c) || t('lore.techRegistry.noArea', 'без области');
      if (!m.has(a)) m.set(a, []);
      m.get(a)!.push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [comps, t]);

  const rowsByComponent = useMemo(() => {
    const m = new Map<string, LoreTechRow[]>();
    for (const r of rows) {
      const cid = r.component_id ?? '';
      if (!m.has(cid)) m.set(cid, []);
      m.get(cid)!.push(r);
    }
    return m;
  }, [rows]);

  // T34: technologies present, with the number of components using each.
  const techCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [, techRows] of rowsByComponent) {
      new Set(techRows.map(r => r.tech_name).filter(Boolean)).forEach(n => { m[n] = (m[n] || 0) + 1; });
    }
    return m;
  }, [rowsByComponent]);
  const allTech = useMemo(
    () => Object.keys(techCounts).sort((a, b) => techCounts[b] - techCounts[a] || a.localeCompare(b)),
    [techCounts]);
  const compMatchesTech = (cid: string) =>
    techSel.size === 0 || (rowsByComponent.get(cid) ?? []).some(r => techSel.has(r.tech_name));
  const toggleTech = (name: string) =>
    setTechSel(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  if (loading) return <LoreSkeleton />;
  if (comps.length === 0) return <div style={S.empty}>{t('lore.techRegistry.empty', 'Компоненты не найдены.')}</div>;

  return (
    <div style={S.root}>
      {allTech.length > 1 && (
        <FilterBar
          tier="local"
          label={t('lore.techRegistry.filtersLabel', 'Фильтры')}
          activeCount={techSel.size}
          summaryTags={[...techSel].map((tn): FilterTagData => ({
            key: 't:' + tn, label: tn,
            onRemove: () => setTechSel(prev => { const n = new Set(prev); n.delete(tn); return n; }),
          }))}
          onClear={() => setTechSel(new Set())}
          open={filterOpen}
          onToggleOpen={() => setFilterOpen(v => !v)}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginRight: 4 }}>
              {t('lore.techRegistry.techLabel', 'Технология')}
            </span>
            {allTech.map(tn => (
              <Chip key={tn} label={tn} pressed={techSel.has(tn)} onClick={() => toggleTech(tn)} count={techCounts[tn]} />
            ))}
          </div>
        </FilterBar>
      )}
      {byArea
        .map(([area, areaComps]): [string, LoreComponent[]] => [area, areaComps.filter(c => compMatchesTech(c.component_id))])
        .filter(([, areaComps]) => areaComps.length > 0)
        .map(([area, areaComps]) => (
        <div key={area}>
          <div style={{ ...S.areaHeader, color: areaColor(area) }}>{area}</div>
          {areaComps.map(c => {
            const techRows = rowsByComponent.get(c.component_id) ?? [];
            return (
              <div key={c.component_id} style={S.compBlock}>
                <div style={S.compHeader}>
                  <GameIcon slug={c.game_icon} size={13} style={{ color: areaColor(area) }} />
                  <span style={{ fontWeight: 600, color: 'var(--t1)', fontSize: 'var(--fs-base)' }}>{c.full_name ?? c.component_id}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{c.component_id}</span>
                  <button
                    onClick={() => setAddingFor(v => v === c.component_id ? null : c.component_id)}
                    style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', padding: '2px 8px', background: 'transparent', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--acc)', cursor: 'pointer' }}
                  >{addingFor === c.component_id ? '✕' : t('lore.techRegistry.addButton', '+ технология')}</button>
                </div>

                {addingFor === c.component_id && (
                  <TechAddForm
                    componentId={c.component_id}
                    onSaved={() => { setAddingFor(null); setReloadKey(k => k + 1); }}
                    onError={onError}
                  />
                )}

                {techRows.length > 0 ? (
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>{t('lore.techRegistry.col.tech', 'Технология')}</th>
                        <th style={S.th}>{t('lore.techRegistry.col.version', 'Версия')}</th>
                        <th style={S.th}>{t('lore.techRegistry.col.releaseDate', 'Дата релиза')}</th>
                        <th style={S.th}>{t('lore.techRegistry.col.ourRelease', 'Наш релиз')}</th>
                        <th style={S.th}>{t('lore.techRegistry.col.license', 'Лицензия')}</th>
                        <th style={S.th}>{t('lore.techRegistry.col.checkedAt', 'Проверено')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techRows.map(r => {
                        const f = parseFields(r.content_md);
                        const stale = isStale(r.checked_at);
                        return (
                          <Fragment key={r.spec_id}>
                            <tr>
                              <td style={S.td}>{r.tech_name}</td>
                              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.version ?? '—'}</td>
                              <td style={S.td}>{f.releaseDate ?? '—'}</td>
                              <td style={{ ...S.td, fontFamily: 'var(--mono)', color: f.ourRelease ? 'var(--acc)' : 'var(--t3)' }}>{f.ourRelease ?? '—'}</td>
                              <td style={S.td}>{f.license ?? '—'}</td>
                              <td style={{ ...S.td, color: stale ? 'var(--wrn)' : 'var(--t3)' }}>
                                {r.checked_at ? r.checked_at.slice(0, 10) : '—'}
                                {stale && <span title={t('lore.techRegistry.staleTitle', 'Не проверялось {{n}}+ месяцев', { n: STALE_MONTHS })}> ⚠</span>}
                              </td>
                            </tr>
                            {f.usage && (
                              <tr>
                                <td colSpan={6} style={{ ...S.td, borderTop: 'none', paddingTop: 0, fontSize: 'var(--fs-sm)', color: 'var(--t3)', fontStyle: 'italic' }}>
                                  {t('lore.techRegistry.usagePrefix', 'Использование:')} {f.usage}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : addingFor !== c.component_id && (
                  <div style={{ padding: '8px 12px', fontSize: 'var(--fs-sm)', color: 'var(--t4)', fontStyle: 'italic' }}>
                    {t('lore.techRegistry.noTech', 'Технологии не зарегистрированы')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TechAddForm({ componentId, onSaved, onError }: {
  componentId: string;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [techName, setTechName] = useState('');
  const [version, setVersion]   = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [license, setLicense]   = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ourRelease, setOurRelease] = useState('');
  const [usage, setUsage] = useState('');
  const [busy, setBusy] = useState(false);
  const inputStyle = {
    fontSize: 'var(--fs-sm)', padding: '4px 7px', borderRadius: 4,
    border: '1px solid var(--bd)', background: 'var(--bg2)', color: 'var(--t1)', fontFamily: 'inherit',
  };

  async function save() {
    if (busy || !techName.trim() || !version.trim()) return;
    setBusy(true);
    try {
      await upsertTech({
        component_id: componentId, tech_name: techName.trim(), version: version.trim(),
        release_date: releaseDate || undefined, license: license || undefined, source_url: sourceUrl || undefined,
        our_release: ourRelease || undefined, usage: usage || undefined,
      });
      onSaved();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--bd)', background: 'color-mix(in srgb, var(--bg2) 60%, transparent)' }}>
      <input style={{ ...inputStyle, width: 140 }} placeholder={t('lore.techRegistry.form.techName', 'Название')} value={techName} onChange={e => setTechName(e.target.value)} />
      <input style={{ ...inputStyle, width: 90 }} placeholder={t('lore.techRegistry.form.version', 'Версия')} value={version} onChange={e => setVersion(e.target.value)} />
      <input style={{ ...inputStyle, width: 120 }} type="date" placeholder={t('lore.techRegistry.form.releaseDate', 'Дата релиза')} value={releaseDate} onChange={e => setReleaseDate(e.target.value)} />
      <input style={{ ...inputStyle, width: 100 }} placeholder={t('lore.techRegistry.form.ourRelease', 'Наш релиз (v1.6.21)')} value={ourRelease} onChange={e => setOurRelease(e.target.value)} />
      <input style={{ ...inputStyle, width: 160 }} placeholder={t('lore.techRegistry.form.license', 'Лицензия')} value={license} onChange={e => setLicense(e.target.value)} />
      <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder={t('lore.techRegistry.form.source', 'Источник')} value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
      <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} placeholder={t('lore.techRegistry.form.usage', 'Использование (где/как используется)')} value={usage} onChange={e => setUsage(e.target.value)} />
      <button
        onClick={save} disabled={busy || !techName.trim() || !version.trim()}
        style={{ fontSize: 'var(--fs-sm)', padding: '4px 12px', background: 'var(--acc)', border: 'none', borderRadius: 4, color: 'var(--on-accent)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >{busy ? '…' : t('lore.techRegistry.form.save', 'Сохранить')}</button>
    </div>
  );
}
