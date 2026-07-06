import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoreDisabledError, LoreUpstreamError } from '../api/lore';
import { LoreErrorBoundary } from '../components/lore/LoreErrorBoundary';
import LoreTimeline        from '../components/lore/LoreTimeline';
import LoreAdrList         from '../components/lore/LoreAdrList';
import LoreAdrPassportView from '../components/lore/LoreAdrPassportView';
import LoreAdrEditor       from '../components/lore/LoreAdrEditor';
import LoreSprintTree, { STATUS_FILTERS, projColor, projLabel, compColor, type DatePeriod, type SprintStats, type FacetOption } from '../components/lore/LoreSprintTree';
import LoreComponentList, { areaColor } from '../components/lore/LoreComponentList';
import LoreComponentPassport from '../components/lore/LoreComponentPassport';
import LoreSpecView           from '../components/lore/LoreSpecView';
import { ADR_STATUS_FILTERS, adrStatusLabel } from '../components/lore/LoreAdrList';
import LorePlanBoard       from '../components/lore/LorePlanBoard';
import LoreEvolutionView   from '../components/lore/LoreEvolutionView';
import LoreTechRegistry    from '../components/lore/LoreTechRegistry';
import LoreSprintDetail    from '../components/lore/LoreSprintDetail';
import LoreSprintEditor    from '../components/lore/LoreSprintEditor';
import LoreDecisionBoard   from '../components/lore/LoreDecisionBoard';
import LoreReleasesBoard   from '../components/lore/LoreReleasesBoard';
import LoreMcpApiScreen    from '../components/lore/LoreMcpApiScreen';
import LoreAnalyticsView   from '../components/lore/LoreAnalytics';
import LoreMilestonesView  from '../components/lore/LoreMilestonesView';
import LoreQualityGateList from '../components/lore/LoreQualityGateList';
import LoreQGDetail        from '../components/lore/LoreQGDetail';
import LoreArtifactList, { type ArtifactKind } from '../components/lore/LoreArtifactList';
import LoreArtifactDoc, { type DocKind } from '../components/lore/LoreArtifactDoc';
import { GameIcon }        from '../components/lore/GameIcon';
import { statusMeta, resolveStatusMeta, statusLabel, taskTick } from '../components/lore/lore-status';
import { useIsNarrow } from '../hooks/useMediaQuery';

// ── Sections ──────────────────────────────────────────────────────────────────
type Section =
  | 'plan' | 'sprints' | 'adrs' | 'decisions' | 'releases' | 'milestones'
  | 'knowledge' | 'components' | 'qg' | 'tech'
  | 'evolution' | 'timeline' | 'analytics' | 'mcp';

// Module-scope constant (not recreated per render) — ADR/QG already have their
// own top-level nav sections, so «Знания» adds spec+runbook+doc. Specs have no
// dedicated top-level section of their own (unlike ADR/QG) — without this they
// were only reachable by drilling into a component's passport, which is why
// they seemed to be "missing" from the general knowledge browser.
const KNOWLEDGE_ARTIFACT_KINDS: ArtifactKind[] = ['spec', 'runbook', 'doc'];

// icon = game-icons slug (bundled offline via addCollection in main.tsx)
const SECTIONS: { id: Section; icon: string; labelKey: string; fallback: string }[] = [
  { id: 'milestones', icon: 'crossed-axes',   labelKey: 'lore.page.nav.milestones', fallback: 'Вехи'       },
  { id: 'plan',       icon: 'compass',        labelKey: 'lore.page.nav.plan',       fallback: 'План'       },
  { id: 'sprints',    icon: 'sprint',         labelKey: 'lore.page.nav.sprints',    fallback: 'Спринты'    },
  { id: 'adrs',       icon: 'scroll-quill',   labelKey: 'lore.page.nav.adrs',       fallback: 'ADR'        },
  { id: 'decisions',  icon: 'vote',           labelKey: 'lore.page.nav.decisions',  fallback: 'Решения'    },
  { id: 'releases',   icon: 'open-book',      labelKey: 'lore.page.nav.releases',   fallback: 'Релизы'     },
  { id: 'qg',         icon: 'checkered-flag', labelKey: 'lore.page.nav.qg',         fallback: 'QG'         },
  { id: 'knowledge',  icon: 'spell-book',     labelKey: 'lore.page.nav.knowledge',  fallback: 'Знания'     },
  { id: 'components', icon: 'cog',            labelKey: 'lore.page.nav.components', fallback: 'Компоненты' },
  { id: 'tech',       icon: 'gears',          labelKey: 'lore.page.nav.tech',       fallback: 'Технологии' },
  { id: 'evolution',  icon: 'hourglass',      labelKey: 'lore.page.nav.evolution',  fallback: 'История'    },
  { id: 'timeline',   icon: 'tied-scroll',    labelKey: 'lore.page.nav.timeline',   fallback: 'Лента'      },
  { id: 'analytics',  icon: 'pie-chart',      labelKey: 'lore.page.nav.analytics',  fallback: 'Аналитика'  },
  { id: 'mcp',        icon: 'plug',           labelKey: 'lore.page.nav.mcp',        fallback: 'MCP API'    },
];

// MOB-01/nav: distinct per-section (per-type) colour. On narrow screens the
// section nav collapses to icons only, so colour is what tells the types apart.
const SECTION_COLORS: Record<Section, string> = {
  milestones: '#E0A13D', plan: '#6AB3F3', sprints: '#7DBF78', adrs: '#B48EAD',
  decisions: '#D9A05B', releases: '#57C7D4', qg: '#A8C062', knowledge: '#E06C9F',
  components: '#88B8A8', tech: '#C0A36E', evolution: '#9A8CDB', timeline: '#6FB0A0',
  analytics: '#D98E73', mcp: '#8FA0C0',
};

// Sections that use master-detail layout (list panel + detail panel)
const MASTER_DETAIL: Section[] = ['adrs', 'sprints', 'components', 'knowledge', 'qg'];

// ── Styles ────────────────────────────────────────────────────────────────────
const LIST_W_DEFAULT = 260;
const LIST_W_MIN     = 130;
const LIST_W_MAX     = 440;

const S = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', overflow: 'hidden',
    fontFamily: 'var(--mono)',
  },
  topBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 12px', height: 36, flexShrink: 0,
    borderBottom: '1px solid var(--bd)',
  },
  searchIcon: { color: 'var(--t3)', fontSize: 13, flexShrink: 0 },
  searchInput: {
    flex: 1, background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit',
  },
  body: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  // Horizontal section nav (top, full width)
  navBar: {
    display: 'flex', alignItems: 'center', gap: 2,
    padding: '4px 10px', flexShrink: 0,
    borderBottom: '1px solid var(--bd)',
    overflowX: 'auto' as const,
  },
  navItem: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', height: 27, cursor: 'pointer', borderRadius: 5,
    border: 'none', fontSize: 12, whiteSpace: 'nowrap' as const, flexShrink: 0,
    fontFamily: 'inherit',
    background: active ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
    color: active ? 'var(--acc)' : 'var(--t2)',
    fontWeight: active ? 600 : 400,
    transition: 'background 0.1s',
  }),
  // Narrow: icon-only, tinted by the section's type colour.
  navItemNarrow: (active: boolean, col: string) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '6px 8px', height: 40, minWidth: 44, cursor: 'pointer', borderRadius: 6,
    border: active ? `1px solid ${col}` : '1px solid transparent',
    background: active ? `color-mix(in srgb, ${col} 20%, transparent)` : 'transparent',
    flexShrink: 0,
  }),
  // List panel (master-detail) — width applied dynamically via listW state
  listPanel: {
    flexShrink: 0,
    borderRight: '1px solid var(--bd)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  listPanelHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 12px', height: 32, flexShrink: 0,
    borderBottom: '1px solid var(--bd)',
    fontSize: 11, color: 'var(--t3)',
    fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1,
  },
  listPanelSearch: {
    background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--t1)', fontSize: 11, fontFamily: 'inherit', flex: 1,
  },
  content: {
    flex: 1, overflow: 'hidden', display: 'flex',
  },
  placeholder: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--t3)', fontSize: 12,
  },
  disabledBanner: {
    flex: 1, display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    color: 'var(--t3)', fontSize: 13, gap: 8,
  },
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LorePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const section   = (params.get('section') as Section) || 'plan';
  const q         = params.get('q')         || '';
  const passport  = params.get('passport')  || '';
  const spec      = params.get('spec')      || '';
  const artKind   = (params.get('kind') as DocKind | '') || '';
  const artId     = params.get('art')        || '';

  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const [loreDisabled, setLoreDisabled] = useState(false);
  const [loreUnreachable, setLoreUnreachable] = useState(false);
  const [search, setSearch] = useState(q);
  const [listSearch, setListSearch] = useState('');
  const [sprintQ, setSprintQ] = useState('');
  // LH-11: init sprint + ADR filters from URL params
  const [sprintStatusSel, setSprintStatusSel] = useState<Set<string>>(() => {
    const v = params.get('ss'); return v ? new Set(v.split(',').filter(Boolean)) : new Set();
  });
  const [sprintCounts, setSprintCounts] = useState<Record<string, number>>({});
  const [sprintNoRelease, setSprintNoRelease] = useState(() => params.get('snr') === '1');
  const [sprintDatePeriod, setSprintDatePeriod] = useState<DatePeriod>(null);
  const [sprintPriorityFilter, setSprintPriorityFilter] = useState<Set<string>>(new Set());
  const [sprintProjSel, setSprintProjSel] = useState<Set<string>>(new Set());
  const [sprintCompSel, setSprintCompSel] = useState<Set<string>>(new Set());
  const [sprintProjFacets, setSprintProjFacets] = useState<FacetOption[]>([]);
  const [sprintCompFacets, setSprintCompFacets] = useState<FacetOption[]>([]);
  const [sprintCompCollapsed, setSprintCompCollapsed] = useState(true);
  const [sprintStats, setSprintStats] = useState<SprintStats>({ total: 0, done: 0, active: 0, p0Open: 0, noRelease: 0 });
  // ADR filters
  const [adrStatusSel, setAdrStatusSel] = useState<Set<string>>(() => {
    const v = params.get('as'); return v ? new Set(v.split(',').filter(Boolean)) : new Set();
  });
  const [adrCounts, setAdrCounts]       = useState<Record<string, number>>({});

  // LH-11: sync filter state → URL params (debounce-free, small payload)
  useEffect(() => {
    setParams(p => {
      const ss = [...sprintStatusSel].join(',');
      ss ? p.set('ss', ss) : p.delete('ss');
      sprintNoRelease ? p.set('snr', '1') : p.delete('snr');
      return p;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintStatusSel, sprintNoRelease]);

  useEffect(() => {
    setParams(p => {
      const as = [...adrStatusSel].join(',');
      as ? p.set('as', as) : p.delete('as');
      return p;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adrStatusSel]);
  // Component filters
  const [compQ, setCompQ]               = useState('');
  const [compAreaSel, setCompAreaSel]   = useState<Set<string>>(new Set());
  const [compAreaCounts, setCompAreaCounts] = useState<Record<string, number>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [listW, setListW] = useState(LIST_W_DEFAULT);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  // «Знания»: LoreArtifactList's Тип/Модуль chip header portals into this
  // full-width slot instead of staying confined to the narrow resizable list
  // column — same "full-width bar above the master-detail row" layout the
  // sprints filter bar already uses, without lifting that list's fetch/state
  // ownership out of the component (a callback ref, not prop-drilling,
  // because the portal target must exist as a real DOM node before
  // LoreArtifactList can render into it).
  const [knowledgeFilterBar, setKnowledgeFilterBar] = useState<HTMLDivElement | null>(null);

  const isMasterDetail = MASTER_DETAIL.includes(section);
  // The narrow-screen master-detail flow below keys off `passport`, but
  // «Знания» selects its detail view via `kind`+`art` (openArt) for runbook/doc,
  // or via `spec` (shares LoreSpecView with the Components section) for specs —
  // without this, selecting an item on a narrow screen never revealed the
  // detail pane (passport stayed empty forever).
  const hasDetailSelection = section === 'knowledge' ? !!((artKind && artId) || spec) : !!passport;

  // Sections where the global search bar is actually passed to children
  const SEARCH_SECTIONS: Section[] = ['decisions', 'releases', 'timeline'];
  const showGlobalSearch = SEARCH_SECTIONS.includes(section);
  // MOB: collapse the section nav to type-coloured icons on narrow screens.
  const narrow = useIsNarrow(720);
  // MOB-08: touch targets — icon-only chips get taller padding on narrow so
  // the tap zone approaches the 44px guideline without desktop bloat.
  const chipPad = narrow ? '9px 10px' : '2px 8px';

  // LH-26: seed local search fields from global q when switching sections (once, if empty)
  useEffect(() => {
    if (section === 'sprints'    && !sprintQ    && q) setSprintQ(q);
    if (section === 'components' && !compQ      && q) setCompQ(q);
    if (section === 'adrs'       && !listSearch && q) setListSearch(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const sprintPresetWorking   = sprintStatusSel.has('in_progress') && sprintStatusSel.has('partial') && sprintStatusSel.size === 2 && !sprintNoRelease;
  const sprintPresetAttention = sprintStatusSel.has('in_progress') && sprintStatusSel.size === 1 && sprintNoRelease;

  const go = (s: Section) => setParams(p => {
    p.set('section', s);
    p.delete('passport');
    p.delete('kind');
    p.delete('art');
    return p;
  });

  const selectItem    = (id: string) => setParams(p => { p.set('passport', id); p.delete('spec'); return p; });
  const clearItem     = ()           => setParams(p => { p.delete('passport'); p.delete('spec'); return p; });
  const clearSpec     = ()           => setParams(p => { p.delete('spec'); return p; });
  const navigateToAdr    = (id: string) => setParams(p => { p.set('section', 'adrs');    p.set('passport', id); p.delete('kind'); p.delete('art'); return p; });
  const navigateToSprint = (id: string) => setParams(p => { p.set('section', 'sprints'); p.set('passport', id); p.delete('kind'); p.delete('art'); return p; });
  const navigateToComponent = (id: string) => setParams(p => { p.set('section', 'components'); p.set('passport', id); p.delete('spec'); p.delete('kind'); p.delete('art'); return p; });
  const navigateToQG = (id: string) => setParams(p => { p.set('section', 'qg'); p.set('passport', id); p.delete('spec'); p.delete('kind'); p.delete('art'); return p; });
  const openArt   = (kind: DocKind, id: string) => setParams(p => { p.set('kind', kind); p.set('art', id); return p; });
  const closeArt  = () => setParams(p => { p.delete('kind'); p.delete('art'); return p; });

  const onSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setParams(p => { v ? p.set('q', v) : p.delete('q'); return p; });
    }, 350);
  };

  const handleFetchError = useCallback((err: unknown) => {
    if (err instanceof LoreDisabledError) { setLoreDisabled(true); }
    else if (err instanceof LoreUpstreamError) { setLoreUnreachable(true); }
    // swallow other errors — they show in component empty-states
  }, []);

  // Clear list search on section change
  useEffect(() => { setListSearch(''); }, [section]);
  // Clear sprint filter on leaving sprints
  useEffect(() => {
    if (section !== 'sprints') {
      setSprintQ(''); setSprintStatusSel(new Set());
      setSprintNoRelease(false); setSprintDatePeriod(null); setSprintPriorityFilter(new Set());
    }
    if (section !== 'adrs')       { setAdrStatusSel(new Set()); }
    if (section !== 'components') { setCompQ(''); setCompAreaSel(new Set()); }
  }, [section]);

  // Drag-resize list panel
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setListW(Math.min(LIST_W_MAX, Math.max(LIST_W_MIN, dragRef.current.w + (e.clientX - dragRef.current.x))));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Section nav — horizontal bar (План · Спринты · ADR · …) ──────────────────
  const sectionNav = (
    <nav style={S.navBar} className="lore-nav-scroll">
      {SECTIONS.map(s => {
        const isActive = section === s.id;
        const col = SECTION_COLORS[s.id];
        return (
          <button
            key={s.id}
            style={narrow ? S.navItemNarrow(isActive, col) : S.navItem(isActive)}
            onClick={() => go(s.id)}
            title={t(s.labelKey, s.fallback)}
          >
            {s.icon && <GameIcon slug={s.icon} size={narrow ? 18 : 15} style={{ color: narrow ? col : 'inherit' }} />}
            {!narrow && <span>{t(s.labelKey, s.fallback)}</span>}
          </button>
        );
      })}
    </nav>
  );

  if (loreDisabled) return (
    <div style={S.root}>
      <div style={{ ...S.body, ...S.disabledBanner }}>
        <span style={{ fontSize: 32 }}>📚</span>
        <span>{t('lore.page.disabled.message', 'LORE отключён в этой среде.')}</span>
        <span style={{ fontSize: 11 }}>{t('lore.page.disabled.hint', 'Установить lore.enabled=true в lore-backend (:9100).')}</span>
      </div>
    </div>
  );

  if (loreUnreachable) return (
    <div style={S.root}>
      <div style={{ ...S.body, ...S.disabledBanner }}>
        <span style={{ fontSize: 32 }}>⚠️</span>
        <span>{t('lore.page.unreachable.message', 'LORE недоступен — lore-backend (:9100) не отвечает.')}</span>
        <button style={{ fontSize: 11, marginTop: 8, cursor: 'pointer' }} onClick={() => setLoreUnreachable(false)}>
          {t('lore.page.unreachable.retry', 'Повторить')}
        </button>
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      {/* ── Top search bar — only on sections that use global q ───────────── */}
      {showGlobalSearch && (
        <div style={S.topBar}>
          <span style={S.searchIcon}>🔍</span>
          <input
            style={S.searchInput}
            placeholder={t('lore.page.search.knowledgePlaceholder', 'поиск по базе знаний…')}
            aria-label={t('lore.page.search.knowledgeAriaLabel', 'поиск по базе знаний')}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* ── Horizontal section nav ─────────────────────────────────────────── */}
      {sectionNav}

      {/* ── Knowledge filter bar: Тип/Модуль chips portal in here from
          LoreArtifactList's own header (see knowledgeFilterBar above) ─── */}
      {section === 'knowledge' && (
        <div ref={setKnowledgeFilterBar} style={{ flexShrink: 0, borderBottom: '1px solid var(--bd)' }} />
      )}

      {/* ── Sprint filter bar: статусы + пресеты + приоритет + даты + без релиза ─ */}
      {section === 'sprints' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          {/* Статусы */}
          {STATUS_FILTERS.map(f => {
            const on  = sprintStatusSel.has(f.key);
            const meta = statusMeta(f.key);
            const cnt  = sprintCounts[f.key] ?? 0;
            return (
              <span key={f.key}
                onClick={() => setSprintStatusSel(prev => {
                  const n = new Set(prev); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n;
                })}
                title={`${f.label}: ${cnt}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? meta.color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${meta.color} 18%, transparent)` : 'transparent',
                  color: on ? 'var(--t1)' : 'var(--t3)',
                }}
              >
                <GameIcon slug={meta.icon} size={narrow ? 14 : 11} style={{ color: meta.color }} />
                {/* MOB: icon-only chips on narrow — label+count live in the title tooltip */}
                {!narrow && f.label}
                {!narrow && <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{cnt}</span>}
              </span>
            );
          })}

          {/* Сепаратор */}
          <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />

          {/* Пресет: В работе */}
          <span
            onClick={() => {
              if (sprintPresetWorking) { setSprintStatusSel(new Set()); }
              else { setSprintStatusSel(new Set(['in_progress', 'partial'])); setSprintNoRelease(false); }
            }}
            title={t('lore.page.sprints.presetWorkingTitle', 'В работе + Частично')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
              userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintPresetWorking ? 'var(--acc)' : 'var(--b3)'}`,
              background: sprintPresetWorking ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
              color: sprintPresetWorking ? 'var(--acc)' : 'var(--t3)',
            }}
          >⚡{!narrow && <> {t('lore.page.sprints.presetWorking', 'В работе')}</>}</span>

          {/* Пресет: Нужно внимание */}
          <span
            onClick={() => {
              if (sprintPresetAttention) { setSprintStatusSel(new Set()); setSprintNoRelease(false); }
              else { setSprintStatusSel(new Set(['in_progress'])); setSprintNoRelease(true); }
            }}
            title={t('lore.page.sprints.presetAttentionTitle', 'В работе без привязки к релизу')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
              userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintPresetAttention ? '#E24B4A' : 'var(--b3)'}`,
              background: sprintPresetAttention ? 'color-mix(in srgb, #E24B4A 16%, transparent)' : 'transparent',
              color: sprintPresetAttention ? '#E24B4A' : 'var(--t3)',
            }}
          >⚠{!narrow && <> {t('lore.page.sprints.presetAttention', 'Внимание')}</>}</span>

          {/* Распорка */}
          <span style={{ flex: 1 }} />

          {/* Приоритет */}
          {(['P0', 'P1', 'P2'] as const).map(p => {
            const on    = sprintPriorityFilter.has(p);
            const color = p === 'P0' ? '#E24B4A' : p === 'P1' ? '#ef9f27' : 'var(--t3)';
            return (
              <span key={p}
                onClick={() => setSprintPriorityFilter(prev => {
                  const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n;
                })}
                style={{
                  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, fontWeight: on ? 600 : 400,
                  padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent',
                  color: on ? color : 'var(--t3)',
                }}
              >{p}</span>
            );
          })}

          <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />

          {/* Даты */}
          {(['month', 'quarter', '90d'] as DatePeriod[]).map(p => {
            const label = p === 'month' ? t('lore.page.sprints.dateMonth', 'Этот месяц') : p === 'quarter' ? t('lore.page.sprints.dateQuarter', 'Квартал') : t('lore.page.sprints.date90d', '90 дней');
            const on    = sprintDatePeriod === p;
            return (
              <span key={p!}
                onClick={() => setSprintDatePeriod(on ? null : p)}
                style={{
                  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
                  background: on ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--t3)',
                }}
              >{label}</span>
            );
          })}

          <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />

          {/* Без релиза */}
          <span
            onClick={() => setSprintNoRelease(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
              userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintNoRelease ? 'var(--acc)' : 'var(--b3)'}`,
              background: sprintNoRelease ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
              color: sprintNoRelease ? 'var(--acc)' : 'var(--t3)',
            }}
          >{t('lore.page.sprints.noRelease', 'Без релиза')}</span>

          {/* Сброс */}
          {(sprintStatusSel.size > 0 || sprintNoRelease || sprintDatePeriod || sprintPriorityFilter.size > 0 || sprintProjSel.size > 0 || sprintCompSel.size > 0) && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />
              <span
                onClick={() => { setSprintStatusSel(new Set()); setSprintNoRelease(false); setSprintDatePeriod(null); setSprintPriorityFilter(new Set()); setSprintProjSel(new Set()); setSprintCompSel(new Set()); }}
                style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
                title={t('lore.page.filters.resetTitle', 'Сбросить фильтры')}
              >✕ {t('lore.page.filters.reset', 'сброс')}</span>
            </>
          )}
        </div>
      )}

      {/* ── Sprint project filter bar — full-width, own row (moved out of the
           narrow sidebar list per user feedback); faceted: counts reflect
           whatever's already selected in the status/priority/date filter
           above ─────────────────────────────────────────────────────────── */}
      {section === 'sprints' && sprintProjFacets.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>
            {t('lore.page.sprints.projectsLabel', 'Проекты')}
          </span>
          {sprintProjFacets.map(({ id, count }) => {
            const on = sprintProjSel.has(id);
            const color = projColor(id, sprintProjFacets.map(f => f.id));
            const reachable = count > 0 || on;
            return (
              <span key={id}
                onClick={() => setSprintProjSel(prev => {
                  const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
                })}
                title={`${id} (${count})`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                  color: on ? color : 'var(--t3)', opacity: reachable ? 1 : 0.4,
                }}
              >
                <span style={{ width: narrow ? 10 : 6, height: narrow ? 10 : 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {!narrow && projLabel(id)}
                {!narrow && <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{count}</span>}
              </span>
            );
          })}
          {sprintProjSel.size > 0 && (
            <span
              onClick={() => setSprintProjSel(new Set())}
              style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
              title={t('lore.page.filters.resetTitle', 'Сбросить фильтры')}
            >✕ {t('lore.page.filters.reset', 'сброс')}</span>
          )}
        </div>
      )}

      {/* ── Sprint component filter bar — separate full-width row, collapsible
           since the component list can get long; each chip's colour/icon is
           unique per component (not one flat repeated icon) ──────────────── */}
      {section === 'sprints' && sprintCompFacets.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          <span
            onClick={() => setSprintCompCollapsed(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none',
              fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2,
            }}
            title={sprintCompCollapsed ? t('lore.page.sprints.expandComponents', 'Развернуть') : t('lore.page.sprints.collapseComponents', 'Свернуть')}
          >
            <span style={{ display: 'inline-block', transform: sprintCompCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.12s' }}>▾</span>
            {t('lore.page.sprints.componentsLabel', 'Компоненты')}
            {sprintCompSel.size > 0 && <span style={{ color: 'var(--acc)', fontWeight: 600 }}>({sprintCompSel.size})</span>}
          </span>
          {!sprintCompCollapsed && sprintCompFacets.map(({ id, count, icon, area }) => {
            const on = sprintCompSel.has(id);
            // Real per-component icon + area colour when the components slice
            // has loaded; fall back to a generated palette colour + generic
            // icon so chips still render (and stay distinguishable) before
            // that fetch resolves.
            const color = area ? areaColor(area) : compColor(id, sprintCompFacets.map(f => f.id));
            const reachable = count > 0 || on;
            return (
              <span key={id}
                onClick={() => setSprintCompSel(prev => {
                  const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
                })}
                title={`${id} (${count})`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                  color: on ? color : 'var(--t3)', opacity: reachable ? 1 : 0.4,
                }}
              >
                <GameIcon slug={icon ?? 'puzzle'} size={narrow ? 14 : 11} style={{ color }} />
                {!narrow && id}
                {!narrow && <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{count}</span>}
              </span>
            );
          })}
          {sprintCompCollapsed && sprintCompSel.size > 0 && (
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>
              {[...sprintCompSel].join(', ')}
            </span>
          )}
          {sprintCompSel.size > 0 && (
            <span
              onClick={() => setSprintCompSel(new Set())}
              style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
              title={t('lore.page.filters.resetTitle', 'Сбросить фильтры')}
            >✕ {t('lore.page.filters.reset', 'сброс')}</span>
          )}
        </div>
      )}

      {/* ── MOB-08: active-filters strip (narrow only). The icon-only chips rely
           on title tooltips, which DON'T EXIST on touch — this strip is the
           readable feedback: every active filter as a labelled chip, tap × to
           remove. Desktop keeps labels inline, so the strip is narrow-only. ── */}
      {narrow && section === 'sprints' &&
        (sprintStatusSel.size > 0 || sprintPriorityFilter.size > 0 || sprintProjSel.size > 0 ||
         sprintCompSel.size > 0 || sprintDatePeriod || sprintNoRelease) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          {[...sprintStatusSel].map(k => {
            const meta = statusMeta(k);
            const label = STATUS_FILTERS.find(f => f.key === k)?.label ?? k;
            return (
              <span key={'s' + k}
                onClick={() => setSprintStatusSel(prev => { const n = new Set(prev); n.delete(k); return n; })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                         padding: '5px 9px', borderRadius: 12, whiteSpace: 'nowrap',
                         background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                         border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`, color: 'var(--t1)' }}
              >{label} ✕</span>
            );
          })}
          {[...sprintPriorityFilter].map(p => (
            <span key={'p' + p}
              onClick={() => setSprintPriorityFilter(prev => { const n = new Set(prev); n.delete(p); return n; })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                       padding: '5px 9px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--b3)', color: 'var(--t1)' }}
            >{p} ✕</span>
          ))}
          {[...sprintProjSel].map(id => (
            <span key={'pr' + id}
              onClick={() => setSprintProjSel(prev => { const n = new Set(prev); n.delete(id); return n; })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                       padding: '5px 9px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--b3)', color: 'var(--t1)' }}
            >{projLabel(id)} ✕</span>
          ))}
          {[...sprintCompSel].map(id => (
            <span key={'c' + id}
              onClick={() => setSprintCompSel(prev => { const n = new Set(prev); n.delete(id); return n; })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                       padding: '5px 9px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--b3)', color: 'var(--t1)' }}
            >{id} ✕</span>
          ))}
          {sprintDatePeriod && (
            <span onClick={() => setSprintDatePeriod(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                       padding: '5px 9px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--b3)', color: 'var(--t1)' }}
            >{sprintDatePeriod === 'month' ? t('lore.page.sprints.dateMonth', 'Этот месяц') : sprintDatePeriod === 'quarter' ? t('lore.page.sprints.dateQuarter', 'Квартал') : t('lore.page.sprints.date90d', '90 дней')} ✕</span>
          )}
          {sprintNoRelease && (
            <span onClick={() => setSprintNoRelease(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12,
                       padding: '5px 9px', borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--b3)', color: 'var(--t1)' }}
            >{t('lore.page.sprints.noRelease', 'Без релиза')} ✕</span>
          )}
        </div>
      )}

      {/* ── ADR filter bar ──────────────────────────────────────────────────── */}
      {section === 'adrs' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          {ADR_STATUS_FILTERS.map(f => {
            const on  = adrStatusSel.has(f.key);
            const cnt = adrCounts[f.key] ?? 0;
            return (
              <span key={f.key}
                onClick={() => setAdrStatusSel(prev => {
                  const n = new Set(prev); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n;
                })}
                title={`${adrStatusLabel(t, f.key)}: ${cnt}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? f.color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${f.color} 18%, transparent)` : 'transparent',
                  color: on ? 'var(--t1)' : 'var(--t3)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                {adrStatusLabel(t, f.key)}
                <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{cnt}</span>
              </span>
            );
          })}
          {adrStatusSel.size > 0 && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />
              <span
                onClick={() => setAdrStatusSel(new Set())}
                style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
                title={t('lore.page.filters.resetTitle', 'Сбросить фильтры')}
              >✕ {t('lore.page.filters.reset', 'сброс')}</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            {adrStatusSel.size === 0
              ? t('lore.page.adrs.totalCount', '{{count}} ADR всего', { count: Object.values(adrCounts).reduce((a, b) => a + b, 0) })
              : t('lore.page.adrs.filteredCount', '{{shown}} из {{total}}', { shown: ADR_STATUS_FILTERS.filter(f => adrStatusSel.has(f.key)).reduce((s, f) => s + (adrCounts[f.key] ?? 0), 0), total: Object.values(adrCounts).reduce((a, b) => a + b, 0) })}
          </span>
        </div>
      )}

      {/* ── Component filter bar ─────────────────────────────────────────────── */}
      {section === 'components' && Object.keys(compAreaCounts).length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        }}>
          {Object.entries(compAreaCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([area, cnt]) => {
              const on = compAreaSel.has(area);
              const color = areaColor(area);
              return (
                <span key={area}
                  onClick={() => setCompAreaSel(prev => {
                    const n = new Set(prev); n.has(area) ? n.delete(area) : n.add(area); return n;
                  })}
                  title={`${area}: ${cnt}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    userSelect: 'none', fontSize: 11, padding: chipPad, borderRadius: 12, whiteSpace: 'nowrap',
                    border: `1px solid ${on ? color : 'var(--b3)'}`,
                    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                    color: on ? 'var(--t1)' : 'var(--t3)',
                  }}
                >
                  {area}
                  <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{cnt}</span>
                </span>
              );
            })}
          {compAreaSel.size > 0 && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />
              <span
                onClick={() => setCompAreaSel(new Set())}
                style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
                title={t('lore.page.components.resetAreaFilterTitle', 'Сбросить фильтр по area')}
              >✕ {t('lore.page.filters.reset', 'сброс')}</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            {t('lore.page.components.totalCount', '{{count}} компонентов', { count: Object.values(compAreaCounts).reduce((a, b) => a + b, 0) })}
          </span>
        </div>
      )}

      {/* ── Sprint stats row ─────────────────────────────────────────────────── */}
      {section === 'sprints' && sprintStats.total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'stretch',
          borderBottom: '1px solid var(--bd)', flexShrink: 0, overflowX: 'auto',
        }}>
          {([
            { label: t('lore.page.sprints.stats.total', 'всего'),      value: sprintStats.total,     color: 'var(--t1)' },
            { label: t('lore.page.sprints.stats.done', 'завершено'),  value: sprintStats.done,      color: '#4dc9a0'   },
            { label: t('lore.page.sprints.stats.active', 'активных'),   value: sprintStats.active,    color: 'var(--acc)'},
            { label: t('lore.page.sprints.stats.p0Open', 'P0 открыто'), value: sprintStats.p0Open,    color: '#E24B4A'   },
            { label: t('lore.page.sprints.stats.noRelease', 'без релиза'), value: sprintStats.noRelease, color: 'var(--t3)' },
          ]).map((s, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '3px 14px', flexShrink: 0,
              borderLeft: i === 0 ? 'none' : '1px solid var(--bd)',
            }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: s.color, lineHeight: 1.1 }}>{s.value}</span>
              <span style={{ fontSize: 9, color: 'var(--t3)', whiteSpace: 'nowrap', marginTop: 1 }}>{s.label}</span>
            </div>
          ))}
          {/* % выполнено */}
          {(() => { const pct = sprintStats.total > 0 ? Math.round(sprintStats.done / sprintStats.total * 100) : 0; return (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '3px 14px', flexShrink: 0, borderLeft: '1px solid var(--bd)',
          }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: '#4dc9a0', lineHeight: 1.1 }}>
              {pct}%
            </span>
            <div style={{ width: 44, height: 3, background: 'var(--b2)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`,
                height: '100%', background: '#4dc9a0', borderRadius: 2,
              }} />
            </div>
            <span style={{ fontSize: 9, color: 'var(--t3)', whiteSpace: 'nowrap', marginTop: 1 }}>{t('lore.page.sprints.stats.percentDone', 'выполнено')}</span>
          </div>
          ); })()}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={S.body}>
        {/* ── Master-detail layout ─────────────────────────────────────────── */}
        {/* MOB-04: on narrow screens the side-by-side pair becomes a two-step
            flow — list full-width until something is selected, then the detail
            takes the whole screen with a "← к списку" bar (clearItem). */}
        {isMasterDetail && (!narrow || !hasDetailSelection) && (
          <>
          <div style={{ ...S.listPanel, width: narrow ? '100%' : listW }} className="lore-panel-scroll">
            {/* List panel header — search only for ADRs; sprints use the full-width bar above */}
            {section === 'adrs' && (
              <div style={S.listPanelHeader}>
                🔍
                <input
                  style={S.listPanelSearch}
                  placeholder={t('lore.page.adrs.searchPlaceholder', 'ADR-...')}
                  value={listSearch}
                  onChange={e => setListSearch(e.target.value)}
                />
                {passport && (
                  <button
                    onClick={clearItem}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                             color: 'var(--t3)', fontSize: 11, padding: '0 2px' }}
                    title={t('lore.page.adrs.clearSelectionTitle', 'Сбросить выбор')}
                  >✕</button>
                )}
              </div>
            )}

            {/* List content */}
            {section === 'adrs' && (
              <LoreAdrList
                module=""
                q={listSearch}
                statusSel={adrStatusSel}
                selectedId={passport === '__new' ? undefined : passport}
                onError={handleFetchError}
                onOpen={selectItem}
                onNew={() => selectItem('__new')}
                onCounts={setAdrCounts}
              />
            )}
            {section === 'sprints' && (
              <>
                {/* Поиск по имени/ID — в шапке левой панели */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 10px', height: 30, flexShrink: 0,
                  borderBottom: '1px solid var(--bd)',
                }}>
                  <span style={{ color: 'var(--t3)', fontSize: 12, flexShrink: 0 }}>🔍</span>
                  <input
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)',
                    }}
                    placeholder={t('lore.page.sprints.searchPlaceholder', 'спринт…')}
                    aria-label={t('lore.page.sprints.searchAriaLabel', 'поиск по имени спринта')}
                    value={sprintQ}
                    onChange={e => setSprintQ(e.target.value)}
                  />
                  {sprintQ && (
                    <span onClick={() => setSprintQ('')}
                      style={{ color: 'var(--t3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</span>
                  )}
                  <button
                    onClick={() => selectItem('__new')}
                    title={t('lore.page.sprints.newSprintTitle', 'Новый спринт')}
                    style={{
                      flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                      border: '1px solid var(--bd)', background: 'transparent',
                      color: 'var(--acc)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >+</button>
                </div>
                <LoreSprintTree
                  module=""
                  q={sprintQ}
                  statusFilter={sprintStatusSel}
                  priorityFilter={sprintPriorityFilter}
                  projectFilter={sprintProjSel}
                  componentFilter={sprintCompSel}
                  noRelease={sprintNoRelease}
                  datePeriod={sprintDatePeriod}
                  selectedId={passport === '__new' ? undefined : passport}
                  onError={handleFetchError}
                  onSelect={selectItem}
                  onCounts={setSprintCounts}
                  onStats={setSprintStats}
                  onProjectFacets={setSprintProjFacets}
                  onComponentFacets={setSprintCompFacets}
                />
              </>
            )}
            {section === 'components' && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 10px', height: 30, flexShrink: 0,
                  borderBottom: '1px solid var(--bd)',
                }}>
                  <span style={{ color: 'var(--t3)', fontSize: 12, flexShrink: 0 }}>🔍</span>
                  <input
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)',
                    }}
                    placeholder={t('lore.page.components.searchPlaceholder', 'компонент…')}
                    aria-label={t('lore.page.components.searchAriaLabel', 'поиск по компонентам')}
                    value={compQ}
                    onChange={e => setCompQ(e.target.value)}
                  />
                  {compQ && (
                    <span onClick={() => setCompQ('')}
                      style={{ color: 'var(--t3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</span>
                  )}
                </div>
                <LoreComponentList
                  q={compQ}
                  areaSel={compAreaSel}
                  selectedId={passport}
                  onSelect={selectItem}
                  onCounts={setCompAreaCounts}
                  onError={handleFetchError}
                />
              </>
            )}
            {section === 'qg' && (
              <LoreQualityGateList
                onError={handleFetchError}
                onOpen={id => selectItem(id)}
              />
            )}
            {section === 'knowledge' && (
              <LoreArtifactList
                kinds={KNOWLEDGE_ARTIFACT_KINDS}
                onError={handleFetchError}
                onOpen={(kind, id) => {
                  if (kind === 'spec') { setParams(p => { p.set('spec', id); p.delete('kind'); p.delete('art'); return p; }); }
                  else if (kind === 'runbook' || kind === 'doc') { openArt(kind, id); }
                }}
                selectedKind={spec ? 'spec' : artKind}
                selectedId={spec ? spec : artId}
                headerContainer={knowledgeFilterBar}
              />
            )}
          </div>
          {!narrow && (
            <div
              className="lore-resize-handle"
              onMouseDown={e => { dragRef.current = { x: e.clientX, w: listW }; e.preventDefault(); }}
            />
          )}
          </>
        )}

        {/* ── Content area ─────────────────────────────────────────────────── */}
        {!(narrow && isMasterDetail && !hasDetailSelection) && (
        // S.content is a ROW flex — with the narrow back-button (width:100%)
        // inside it, the button ate the row and pushed the detail out of view
        // (blank ADR page bug). Column direction when the back bar is shown.
        <div style={narrow && isMasterDetail && hasDetailSelection ? { ...S.content, flexDirection: 'column' } : S.content}>
          {/* adrs' own passport view already renders a "← К списку" — skip the
              generic bar there to avoid two stacked back controls; knowledge's
              LoreArtifactDoc has its own back button too. */}
          {narrow && isMasterDetail && hasDetailSelection && section !== 'adrs' && section !== 'knowledge' && (
            <button
              onClick={clearItem}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                padding: '7px 12px', border: 'none', borderBottom: '1px solid var(--bd)',
                background: 'var(--bg1)', color: 'var(--acc)', fontSize: 12,
                fontFamily: 'var(--mono)', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
              }}
            >← {t('lore.page.backToList', 'к списку')}</button>
          )}
          <LoreErrorBoundary label={t('lore.page.sectionError', 'Ошибка секции «{{section}}»', { section })}>
          {/* Plan */}
          {section === 'plan' && <LorePlanBoard onError={handleFetchError} onNavigateToSprint={navigateToSprint} />}

          {/* ADR — new */}
          {section === 'adrs' && passport === '__new' && (
            <LoreAdrEditor
              onSaved={id => navigateToAdr(id)}
              onCancel={clearItem}
            />
          )}
          {/* ADR detail */}
          {section === 'adrs' && passport && passport !== '__new' && (
            <LoreAdrPassportView
              adrId={passport}
              onError={handleFetchError}
              onBack={clearItem}
              onNavigate={navigateToAdr}
            />
          )}
          {section === 'adrs' && !passport && (
            <div style={{ ...S.placeholder, flexDirection: 'column' as const, gap: 8 }}>
              <GameIcon slug="scroll-quill" size={28} style={{ color: 'var(--t3)', opacity: 0.4 }} />
              <span>{t('lore.page.adrs.emptySelectHint', 'Выберите ADR из списка слева')}</span>
              <span style={{ fontSize: 10, color: 'var(--t3)' }}>{t('lore.page.adrs.emptyCreateHint', 'или нажмите «+ новый ADR» чтобы создать')}</span>
            </div>
          )}

          {/* Decisions: composite feed */}
          {section === 'decisions' && (
            <LoreDecisionBoard q={debouncedQ} onError={handleFetchError} />
          )}

          {/* Releases */}
          {section === 'releases' && (
            <LoreReleasesBoard q={debouncedQ} onClearQ={() => setParams(p => { p.delete('q'); return p; })} onError={handleFetchError} onNavigateToSprint={navigateToSprint} />
          )}

          {/* Sprints: new / detail / placeholder */}
          {section === 'sprints' && passport === '__new' && (
            <LoreSprintEditor
              onSaved={id => navigateToSprint(id)}
              onCancel={clearItem}
            />
          )}
          {section === 'sprints' && passport && passport !== '__new' && (
            <LoreSprintDetail sprintId={passport} onError={handleFetchError} onNavigateToComponent={navigateToComponent} onNavigateToSprint={navigateToSprint} onNavigateToAdr={navigateToAdr} />
          )}
          {section === 'sprints' && !passport && (
            <div style={S.placeholder}>{t('lore.page.sprints.emptySelectHint', 'Выберите спринт из списка слева')}</div>
          )}

          {/* Components — master-detail: component list → component passport */}
          {section === 'components' && spec && (
            <LoreSpecView
              specId={spec}
              onError={handleFetchError}
              onBack={clearSpec}
              onNavigateComponent={selectItem}
            />
          )}
          {section === 'components' && !spec && passport && (
            <LoreComponentPassport
              componentId={passport}
              onError={handleFetchError}
              onNavigateComponent={selectItem}
            />
          )}
          {section === 'components' && !spec && !passport && (
            <div style={S.placeholder}>{t('lore.page.components.emptySelectHint', 'Выберите компонент из списка слева')}</div>
          )}

          {/* QG — master-detail: list left, detail right */}
          {section === 'qg' && passport && (
            <LoreQGDetail
              qgId={passport}
              onError={handleFetchError}
              onBack={clearItem}
              onNavigateToSprint={navigateToSprint}
            />
          )}
          {section === 'qg' && !passport && (
            <div style={{ ...S.placeholder, flexDirection: 'column' as const, gap: 8 }}>
              <GameIcon slug="checkered-flag" size={28} style={{ color: 'var(--t3)', opacity: 0.4 }} />
              <span>{t('lore.page.qg.emptySelectHint', 'Выберите Quality Gate из списка слева')}</span>
            </div>
          )}

          {/* Knowledge — spec / Runbook / doc master-detail */}
          {section === 'knowledge' && spec && (
            <LoreSpecView
              specId={spec}
              onError={handleFetchError}
              onBack={clearSpec}
              onNavigateComponent={navigateToComponent}
            />
          )}
          {section === 'knowledge' && !spec && artKind && artId && (
            <LoreArtifactDoc
              kind={artKind as DocKind}
              id={artId}
              onError={handleFetchError}
              onBack={closeArt}
              onNavigateSprint={navigateToSprint}
            />
          )}
          {section === 'knowledge' && !spec && !(artKind && artId) && (
            <div style={{ ...S.placeholder, flexDirection: 'column' as const, gap: 8 }}>
              <GameIcon slug="spell-book" size={28} style={{ color: 'var(--t3)', opacity: 0.4 }} />
              <span>{t('lore.page.knowledge.emptySelectHint', 'Выберите элемент из списка слева')}</span>
            </div>
          )}

          {/* Evolution */}
          {section === 'evolution' && <LoreEvolutionView onError={handleFetchError} />}

          {/* Tech registry (SPRINT_TECH_REGISTRY) — version/date/license per component */}
          {section === 'tech' && <LoreTechRegistry onError={handleFetchError} />}

          {/* Timeline */}
          {section === 'timeline' && (
            <LoreTimeline module="" q={debouncedQ} onError={handleFetchError}
              onSelect={navigateToAdr} onSelectSprint={navigateToSprint} />
          )}

          {/* Analytics — aggregated task/sprint/component/release stats */}
          {section === 'milestones' && (
            <LoreMilestonesView onError={handleFetchError} onNavigateToSprint={navigateToSprint} />
          )}

          {section === 'analytics' && (
            <LoreAnalyticsView
              onError={handleFetchError}
              onNavigateToSprint={navigateToSprint}
              onNavigateToComponent={navigateToComponent}
              onNavigateToQG={navigateToQG}
            />
          )}

          {/* MCP API — published reference for the aida-lore MCP server */}
          {section === 'mcp' && <LoreMcpApiScreen />}
          </LoreErrorBoundary>
        </div>
        )}
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  // status may arrive raw ("✅ DONE", "🟡 PARTIAL") or as a clean key ("accepted").
  // resolveStatusMeta normalizes both so we never fall back to the generic
  // checkbox-tree icon. Displayed text goes through the shared "status.*" i18n
  // namespace keyed by the SAME normalized taskTick key — statusLabel's
  // marker-stripped raw text is only the fallback for an unmapped status.
  const { t } = useTranslation();
  const { icon, color } = resolveStatusMeta(status);
  const normalized = taskTick(status).status;
  const label = t(`status.${normalized}`, statusLabel(status));
  // MOB: on narrow screens the badge was often wider than the row's own text —
  // collapse to icon-only, the label moves to the tooltip.
  const narrow = useIsNarrow(720);
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, padding: narrow ? '2px 3px' : '1px 5px 1px 4px', borderRadius: 3,
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <GameIcon slug={icon} size={narrow ? 13 : 11} style={{ color: 'inherit' }} />
      {!narrow && label}
    </span>
  );
}
