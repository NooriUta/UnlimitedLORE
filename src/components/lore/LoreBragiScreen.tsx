// LoreBragiScreen — BRAGI content archive (SPEC-BRAGI-ARCHIVE-001 v0.4).
// Lives at the top-level /bragi route. Shell (menu + AMBER theme) matching
// C:\Маркетинг\bragi-archive-prototype.html section-for-section; each of the
// 8 sections is a live-data view (FE-01..FE-05).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import LoreBragiPublications from './LoreBragiPublications';
import LoreBragiPlan from './LoreBragiPlan';
import LoreBragiAnalytics from './LoreBragiAnalytics';
import { LoreBragiKeys, LoreBragiArchive, LoreBragiInsights, LoreBragiIntegrations } from './LoreBragiExtras';

type BragiSection =
  | 'obzor' | 'plan' | 'pubs' | 'keys' | 'analitika' | 'archive' | 'insights' | 'integrations';

const MENU: { id: BragiSection; labelKey: string; fallback: string }[] = [
  { id: 'obzor',        labelKey: 'bragi.screen.menu.overview',      fallback: 'Обзор' },
  { id: 'plan',         labelKey: 'bragi.screen.menu.plan',          fallback: 'План' },
  { id: 'pubs',         labelKey: 'bragi.screen.menu.publications',  fallback: 'Публикации' },
  { id: 'keys',         labelKey: 'bragi.screen.menu.keys',          fallback: 'Ключи' },
  { id: 'analitika',    labelKey: 'bragi.screen.menu.analytics',     fallback: 'Аналитика' },
  { id: 'archive',      labelKey: 'bragi.screen.menu.archive',       fallback: 'Архив' },
  { id: 'insights',     labelKey: 'bragi.screen.menu.insights',      fallback: 'Инсайты' },
  { id: 'integrations', labelKey: 'bragi.screen.menu.integrations',  fallback: 'Интеграции' },
];

interface OverviewRow { status_general: string; n: number }
interface CompetitorRow { competitor_id: string; name: string }
interface PublicationRow { publication_id: string; title: string; status_general: string }

export default function LoreBragiScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BragiSection>('obzor');
  const [overview, setOverview]     = useState<OverviewRow[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [publications, setPublications] = useState<PublicationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tab !== 'obzor') return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchLoreSlice<OverviewRow>('bragi_overview'),
      fetchLoreSlice<CompetitorRow>('bragi_competitors'),
      fetchLoreSlice<PublicationRow>('bragi_publications'),
    ]).then(([ov, comp, pubs]) => {
      if (cancelled) return;
      setOverview(ov); setCompetitors(comp); setPublications(pubs);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const total = overview.reduce((s, r) => s + r.n, 0);
  const published = overview.find(r => r.status_general === 'published')?.n ?? 0;

  return (
    <div style={S.root}>
      <div style={S.subhead}>
        <span style={S.torch} />
        <b style={S.h1}>BRAGI</b>
        <span style={S.tagline}>{t('bragi.screen.tagline', 'маркетинг · контент · дистрибуция')}</span>
      </div>
      <div style={S.menu}>
        {MENU.map(m => (
          <span
            key={m.id}
            style={menuItemStyle(tab === m.id)}
            onClick={() => setTab(m.id)}
          >
            {t(m.labelKey, m.fallback)}
          </span>
        ))}
        <span style={S.menuLink}>{t('bragi.screen.menu.forsetiLink', 'связи → Forseti')}</span>
      </div>

      <div style={S.wrap}>
        {tab === 'obzor' && (
          <>
            <div style={S.desc}>{t('bragi.screen.overview.desc', 'план, публикации и аналитика соцкапитала — в одном месте. Связи с задачами и релизами в Forseti.')}</div>
            {loading ? (
              <div style={S.hint}>{t('bragi.screen.loading', 'загрузка…')}</div>
            ) : (
              <>
                <div style={S.kpis}>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>{t('bragi.screen.overview.kpiPublications', 'публикаций')}</div>
                    <div style={S.kpiVal}>{total}</div>
                  </div>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>{t('bragi.screen.overview.kpiPublished', 'опубликовано')}</div>
                    <div style={S.kpiVal}>{published}</div>
                  </div>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>{t('bragi.screen.overview.kpiCompetitors', 'конкурентов в срезе')}</div>
                    <div style={S.kpiVal}>{competitors.length}</div>
                  </div>
                </div>
                <div style={S.card}>
                  <h2 style={S.cardH2}>{t('bragi.screen.overview.publicationsTitle', 'публикации')} <span style={S.meta}>{t('bragi.screen.overview.publicationsMeta', '→ Публикации')}</span></h2>
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    {publications.slice(0, 5).map(p => (
                      <div key={p.publication_id}>
                        <span style={S.chip}>{p.status_general ?? '—'}</span> {p.title}
                      </div>
                    ))}
                    {publications.length === 0 && <span style={S.hint}>{t('bragi.screen.overview.noPublications', 'публикаций пока нет')}</span>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'pubs' && <LoreBragiPublications />}
        {tab === 'plan' && <LoreBragiPlan />}
        {tab === 'analitika' && <LoreBragiAnalytics />}
        {tab === 'keys' && <LoreBragiKeys />}
        {tab === 'archive' && <LoreBragiArchive />}
        {tab === 'insights' && <LoreBragiInsights />}
        {tab === 'integrations' && <LoreBragiIntegrations />}
      </div>
    </div>
  );
}

function menuItemStyle(active: boolean): React.CSSProperties {
  return active
    ? { color: 'var(--acc)', boxShadow: 'inset 0 -2px 0 var(--acc)', cursor: 'default', paddingBottom: 10 }
    : { paddingBottom: 10, cursor: 'pointer' };
}

const S: Record<string, React.CSSProperties> = {
  root:     { flex: 1, overflowY: 'auto', fontFamily: 'var(--font)', color: 'var(--t1)' },
  subhead:  { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px 0' },
  torch:    { width: 9, height: 9, borderRadius: 2, background: 'var(--acc)', transform: 'rotate(45deg)' },
  h1:       { fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, margin: 0 },
  tagline:  { color: 'var(--t3)', fontSize: 13 },
  menu:     { display: 'flex', flexWrap: 'wrap', gap: 16, padding: '12px 22px 0', fontSize: 12.5,
              color: 'var(--t3)', borderBottom: '1px solid var(--bd)' },
  menuLink: { marginLeft: 'auto', color: 'var(--t3)', cursor: 'default' },
  wrap:     { maxWidth: 1120, margin: '0 auto', padding: '22px 22px 56px' },
  desc:     { color: 'var(--t2)', fontSize: 14, marginBottom: 18 },
  hint:     { fontSize: 12, color: 'var(--t3)' },
  kpis:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 },
  kpi:      { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 16px' },
  kpiLab:   { fontSize: 12, color: 'var(--t3)' },
  kpiVal:   { fontFamily: 'var(--display)', fontWeight: 700, fontSize: 25, marginTop: 8, lineHeight: 1 },
  card:     { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', marginBottom: 16 },
  cardH2:   { fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, margin: '0 0 12px', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center' },
  meta:     { fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 11, color: 'var(--t3)' },
  chip:     { background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 6, padding: '1px 8px',
              fontSize: 11, color: 'var(--t2)' },
};
