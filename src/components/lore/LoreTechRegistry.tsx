import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, upsertTech, type LoreComponent, type LoreTechRow } from '../../api/lore';
import { areaColor, compArea } from './LoreComponentList';
import { GameIcon } from './GameIcon';
import LoreSkeleton from './LoreSkeleton';

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
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  compBlock: { marginBottom: 14, background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' as const },
  compHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '5px 12px', color: 'var(--t3)', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontWeight: 600 },
  td: { padding: '5px 12px', borderTop: '1px solid var(--bd)', color: 'var(--t2)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

export default function LoreTechRegistry({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [comps, setComps] = useState<LoreComponent[]>([]);
  const [rows, setRows]   = useState<LoreTechRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [addingFor, setAddingFor] = useState<string | null>(null);

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

  if (loading) return <LoreSkeleton />;
  if (comps.length === 0) return <div style={S.empty}>{t('lore.techRegistry.empty', 'Компоненты не найдены.')}</div>;

  return (
    <div style={S.root}>
      {byArea.map(([area, areaComps]) => (
        <div key={area}>
          <div style={{ ...S.areaHeader, color: areaColor(area) }}>{area}</div>
          {areaComps.map(c => {
            const techRows = rowsByComponent.get(c.component_id) ?? [];
            return (
              <div key={c.component_id} style={S.compBlock}>
                <div style={S.compHeader}>
                  <GameIcon slug={c.game_icon} size={13} style={{ color: areaColor(area) }} />
                  <span style={{ fontWeight: 600, color: 'var(--t1)', fontSize: 12 }}>{c.full_name ?? c.component_id}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)' }}>{c.component_id}</span>
                  <button
                    onClick={() => setAddingFor(v => v === c.component_id ? null : c.component_id)}
                    style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--acc)', cursor: 'pointer' }}
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
                                <td colSpan={6} style={{ ...S.td, borderTop: 'none', paddingTop: 0, fontSize: 11, color: 'var(--t3)', fontStyle: 'italic' }}>
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
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--t4)', fontStyle: 'italic' }}>
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
    fontSize: 11, padding: '4px 7px', borderRadius: 4,
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
        style={{ fontSize: 11, padding: '4px 12px', background: 'var(--acc)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >{busy ? '…' : t('lore.techRegistry.form.save', 'Сохранить')}</button>
    </div>
  );
}
