// LoreBragiScreen — BRAGI content archive (SPEC-BRAGI-ARCHIVE-001 v0.4).
// Lives at /lore?section=bragi. FE-01: menu shell + AMBER theme, matching
// C:\Маркетинг\bragi-archive-prototype.html section-for-section. Обзор is wired
// to live data (bragi_overview/bragi_competitors/bragi_publications); the other
// 7 sections are stubs filled in by FE-02..FE-05.
import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';
import LoreBragiPublications from './LoreBragiPublications';
import LoreBragiPlan from './LoreBragiPlan';
import LoreBragiAnalytics from './LoreBragiAnalytics';

type BragiSection =
  | 'obzor' | 'plan' | 'pubs' | 'keys' | 'analitika' | 'archive' | 'insights' | 'integrations';

const MENU: { id: BragiSection; label: string }[] = [
  { id: 'obzor',        label: 'Обзор' },
  { id: 'plan',         label: 'План' },
  { id: 'pubs',         label: 'Публикации' },
  { id: 'keys',         label: 'Ключи' },
  { id: 'analitika',    label: 'Аналитика' },
  { id: 'archive',      label: 'Архив' },
  { id: 'insights',     label: 'Инсайты' },
  { id: 'integrations', label: 'Интеграции' },
];

interface OverviewRow { status_general: string; n: number }
interface CompetitorRow { competitor_id: string; name: string }
interface PublicationRow { publication_id: string; title: string; status_general: string }

export default function LoreBragiScreen() {
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
        <span style={S.tagline}>маркетинг · контент · дистрибуция</span>
      </div>
      <div style={S.menu}>
        {MENU.map(m => (
          <span
            key={m.id}
            style={menuItemStyle(tab === m.id)}
            onClick={() => setTab(m.id)}
          >
            {m.label}
          </span>
        ))}
        <span style={S.menuLink}>связи → Forseti</span>
      </div>

      <div style={S.wrap}>
        {tab === 'obzor' && (
          <>
            <div style={S.desc}>план, публикации и аналитика соцкапитала — в одном месте. Связи с задачами и релизами в Forseti.</div>
            {loading ? (
              <div style={S.hint}>загрузка…</div>
            ) : (
              <>
                <div style={S.kpis}>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>публикаций</div>
                    <div style={S.kpiVal}>{total}</div>
                  </div>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>опубликовано</div>
                    <div style={S.kpiVal}>{published}</div>
                  </div>
                  <div style={S.kpi}>
                    <div style={S.kpiLab}>конкурентов в срезе</div>
                    <div style={S.kpiVal}>{competitors.length}</div>
                  </div>
                </div>
                <div style={S.card}>
                  <h2 style={S.cardH2}>публикации <span style={S.meta}>→ Публикации</span></h2>
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    {publications.slice(0, 5).map(p => (
                      <div key={p.publication_id}>
                        <span style={S.chip}>{p.status_general ?? '—'}</span> {p.title}
                      </div>
                    ))}
                    {publications.length === 0 && <span style={S.hint}>публикаций пока нет</span>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'pubs' && <LoreBragiPublications />}
        {tab === 'plan' && <LoreBragiPlan />}
        {tab === 'analitika' && <LoreBragiAnalytics />}

        {tab !== 'obzor' && tab !== 'pubs' && tab !== 'plan' && tab !== 'analitika' && (
          <div style={S.stub}>
            <div style={S.stubIcon}>⏳</div>
            <div>Раздел «{MENU.find(m => m.id === tab)?.label}» — в разработке (FE-05).</div>
          </div>
        )}
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
  stub:     { display: 'flex', alignItems: 'center', gap: 10, color: 'var(--t3)', fontSize: 13,
              background: 'var(--b1)', border: '1px dashed var(--bd)', borderRadius: 10, padding: '18px 20px' },
  stubIcon: { fontSize: 18 },
};
