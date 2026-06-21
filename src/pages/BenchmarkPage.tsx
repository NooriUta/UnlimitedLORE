import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../hooks/usePageTitle';
import { useIsMobile } from '../hooks/useIsMobile';
import { useMartSlice } from '../hooks/useBench';
import type {
  CapabilityRow, HopKindRow, RunRow, SnapshotRow, SubstrateRow, TaskRow,
} from '../utils/benchData';
import { LiveRunCard } from '../components/bench/LiveRunCard';
import { CampaignsScreen } from '../components/bench/CampaignsScreen';
import { StoryScreen } from '../components/bench/StoryScreen';
import { GenerationsScreen } from '../components/bench/GenerationsScreen';
import { MatrixScreen } from '../components/bench/MatrixScreen';
import { SemanticScreen } from '../components/bench/SemanticScreen';
import { DriftScreen } from '../components/bench/DriftScreen';
import { DispersionScreen } from '../components/bench/DispersionScreen';
import { CasesScreen } from '../components/bench/CasesScreen';
import { ParetoScreen } from '../components/bench/ParetoScreen';
import { ReportScreen } from '../components/bench/ReportScreen';
import {
  CasesDimScreen, FindingsScreen, HypothesesScreen, ReferencesScreen, SubstratesScreen,
} from '../components/bench/RegistryScreens';
import { DictionariesScreen } from '../components/bench/DictionariesScreen';
import { FinanceScreen } from '../components/bench/FinanceScreen';
import { AdvisorScreen } from '../components/bench/AdvisorScreen';
import { WinLossScreen } from '../components/bench/WinLossScreen';
import { BiblioScreen } from '../components/bench/BiblioScreen';
import {
  DesignScreen, MetricsScreen, ProjectScreen, RisksScreen,
} from '../components/bench/NarrativeScreens';
import { BenchErrorBoundary, PanelMsg } from '../components/bench/shared';

const EMPTY_PARAMS: Record<string, string> = {};

type TabId =
  | 'project' | 'story' | 'campaigns' | 'advisor' | 'report' | 'risks' | 'design'
  | 'substrates' | 'generations' | 'hypotheses' | 'findings'
  | 'case_registry' | 'references' | 'biblio' | 'dictionaries' | 'metrics'
  | 'matrix' | 'semantic' | 'drift' | 'dispersion' | 'cases' | 'pareto' | 'finance' | 'winloss';

// Sidebar in three registers (owner: corpora/substrates had no entry point,
// people got lost): Story — the narrative; Registries — flat directories of
// the entities (every substrate/corpus/hypothesis/finding is one click away);
// Slices — the analytical tools that verify the story.
const NAV_SECTIONS: Array<{
  titleKey: string; titleFallback: string;
  items: Array<{ id: TabId; labelKey: string; fallback: string }>;
}> = [
  {
    titleKey: 'bench.navStory', titleFallback: 'Story',
    items: [
      // N1: the project header — «why look at this at all» comes first
      { id: 'project',   labelKey: 'bench.tabProject',   fallback: 'Project' },
      { id: 'story',     labelKey: 'bench.tabStory',     fallback: 'Storyline' },
      { id: 'campaigns', labelKey: 'bench.tabCampaigns', fallback: 'Campaigns' },
      { id: 'advisor',   labelKey: 'bench.tabAdvisor',   fallback: 'Advisor' },
      { id: 'report',    labelKey: 'bench.tabReport',    fallback: 'Report' },
      // N3/N4: trust limits and the design rationale are part of the narrative
      { id: 'risks',     labelKey: 'bench.tabRisks',     fallback: 'Trust & risks' },
      { id: 'design',    labelKey: 'bench.tabDesign',    fallback: 'Design' },
    ],
  },
  {
    titleKey: 'bench.navRegistries', titleFallback: 'Registries',
    items: [
      { id: 'substrates',  labelKey: 'bench.tabSubstrates',  fallback: 'Configurations' },
      { id: 'generations', labelKey: 'bench.tabCorpora',     fallback: 'Corpora · generations' },
      { id: 'hypotheses',  labelKey: 'bench.tabHypotheses',  fallback: 'Hypotheses' },
      { id: 'findings',    labelKey: 'bench.tabFindings',    fallback: 'Findings' },
      { id: 'case_registry', labelKey: 'bench.tabCaseRegistry', fallback: 'Cases & gold' },
      { id: 'dictionaries', labelKey: 'bench.tabDictionaries', fallback: 'Dictionaries' },
      // N2: the legend behind every score (metric chips deep-link here)
      { id: 'metrics',     labelKey: 'bench.tabMetrics',     fallback: 'Metrics' },
    ],
  },
  {
    titleKey: 'bench.navLibrary', titleFallback: 'Library',
    items: [
      { id: 'references',  labelKey: 'bench.tabReferences',  fallback: 'Bibliography' },
      { id: 'biblio',      labelKey: 'bench.tabBiblio',      fallback: 'Biblio · RAGVSDL' },
    ],
  },
  {
    titleKey: 'bench.slicesDivider', titleFallback: 'Slices',
    items: [
      { id: 'matrix',     labelKey: 'bench.tabMatrix',     fallback: 'Matrix' },
      { id: 'semantic',   labelKey: 'bench.tabSemantic',   fallback: 'Semantics' },
      { id: 'drift',      labelKey: 'bench.tabDrift',      fallback: 'Drift' },
      { id: 'dispersion', labelKey: 'bench.tabDispersion', fallback: 'Dispersion' },
      { id: 'cases',      labelKey: 'bench.tabCases',      fallback: 'Cases' },
      { id: 'pareto',     labelKey: 'bench.tabPareto',     fallback: 'Pareto' },
      { id: 'finance',    labelKey: 'bench.tabFinance',    fallback: 'Finance' },
      { id: 'winloss',    labelKey: 'bench.tabWinLoss',    fallback: 'Win/loss' },
    ],
  },
];

const ALL_TABS = NAV_SECTIONS.flatMap(s => s.items);

/**
 * RAG vs Parse experiment panel (dev-only, SAGA section).
 *
 * Source of truth: the RAGVSDL experiment mart in ArcadeDB via /bench/mart
 * named slices (campaigns are the main navigation level). The only file-based
 * data left is the live STATUS.json of the running cell (LiveRunCard) and the
 * static report iframe. Strictly read-only on both paths.
 */
export default function BenchmarkPage() {
  const { t } = useTranslation();
  usePageTitle(t('bench.title', 'RAG vs Parse — experiment'));

  // tab + case-drill preset live in the URL — shareable slices, and matrix
  // cells can deep-link into the Cases tab (audit P0: number → cases → trace)
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: TabId = ALL_TABS.some(x => x.id === rawTab) ? (rawTab as TabId) : 'story';
  const isMobile = useIsMobile();
  const setTab = useCallback((next: TabId) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      return p;
    });
  }, [setSearchParams]);

  const casesPreset = useMemo(() => ({
    run: searchParams.get('run') ?? undefined,
    substrate: searchParams.get('substrate') ?? undefined,
    task: searchParams.get('task') ?? undefined,
    hopKind: searchParams.get('hop_kind') ?? undefined,
    caseId: searchParams.get('case_id') ?? undefined,
  }), [searchParams]);

  const openCases = useCallback((preset: { run: string; substrate?: string; task?: string; hopKind?: string }) => {
    setSearchParams(() => {
      const p = new URLSearchParams();
      p.set('tab', 'cases');
      p.set('run', preset.run);
      if (preset.substrate) p.set('substrate', preset.substrate);
      if (preset.task) p.set('task', preset.task);
      if (preset.hopKind) p.set('hop_kind', preset.hopKind);
      return p;
    });
  }, [setSearchParams]);

  // Д-6: пины дисперсии шарятся через URL (deep-link на конкретный срез snapshot×task)
  const dispersionPreset = useMemo(() => ({
    snapshot: searchParams.get('snapshot') ?? undefined,
    task: searchParams.get('task') ?? undefined,
  }), [searchParams]);

  const setDispersionPins = useCallback((pins: { snapshot: string; task: string }) => {
    setSearchParams(() => {
      const p = new URLSearchParams();
      p.set('tab', 'dispersion');
      if (pins.snapshot) p.set('snapshot', pins.snapshot);
      if (pins.task) p.set('task', pins.task);
      return p;
    });
  }, [setSearchParams]);

  // Shared dimensions, fetched once for all screens
  const runs       = useMartSlice<RunRow>('runs', EMPTY_PARAMS);
  const substrates = useMartSlice<SubstrateRow>('substrates', EMPTY_PARAMS);
  const snapshots  = useMartSlice<SnapshotRow>('snapshots', EMPTY_PARAMS);
  const tasks      = useMartSlice<TaskRow>('tasks', EMPTY_PARAMS);
  const hopKinds   = useMartSlice<HopKindRow>('hop_kinds', EMPTY_PARAMS);
  const capabilities = useMartSlice<CapabilityRow>('capabilities', EMPTY_PARAMS);

  const subLabel = useMemo(() => {
    const byId = new Map((substrates.rows ?? []).map(s => [s.substrate_id, s.short_name ?? s.substrate_id]));
    return (id: string) => byId.get(id) ?? id;
  }, [substrates.rows]);

  const martReady = runs.rows !== null;
  const martUnavailable = runs.unavailable;

  return (
    // height:100% — AppLayout's <main> is overflow:hidden; without a bounded
    // height .page-content grows to its content and overflow-y:auto never
    // engages (hypotheses below the fold were unreachable)
    <div className="page-content" style={{ padding: '16px 20px', height: '100%', boxSizing: 'border-box',
                                           display: 'flex', flexDirection: 'column' }}
         data-testid="bench-page">
      <h1 className="page-title">{t('bench.title', 'RAG vs Parse — experiment')}</h1>
      <p className="analytics-meta">{t('bench.subtitle',
        'Read-only view over the RAGVSDL measurement mart; the live card reads results/STATUS.json of the running cell')}</p>

      <LiveRunCard />

      {isMobile && (
        <select value={tab} onChange={e => setTab(e.target.value as TabId)}
                data-testid="bench-nav-select"
                style={{ width: '100%', marginBottom: 12, padding: '6px 8px', fontSize: 13,
                         background: 'var(--bg2)', color: 'var(--t1)', border: '1px solid var(--bd)', borderRadius: 6 }}>
          {NAV_SECTIONS.map(sec => (
            <optgroup key={sec.titleKey} label={t(sec.titleKey, sec.titleFallback) as string}>
              {sec.items.map(x => (
                <option key={x.id} value={x.id}>{t(x.labelKey, x.fallback) as string}</option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      <div style={{ display: 'flex', gap: 18, flex: 1, minHeight: 0 }}>
        {!isMobile && (
          <nav aria-label={t('bench.navAria', 'Benchmark sections')} className="bench-scroll"
               style={{ width: 178, flexShrink: 0, overflowY: 'auto',
                        borderRight: '1px solid var(--bd)', paddingRight: 10 }}>
            {NAV_SECTIONS.map(sec => (
              <div key={sec.titleKey} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase',
                              letterSpacing: '.07em', margin: '0 0 6px 8px' }}>
                  {t(sec.titleKey, sec.titleFallback)}
                </div>
                {sec.items.map(x => {
                  const active = tab === x.id;
                  return (
                    <button key={x.id} type="button" aria-current={active ? 'page' : undefined}
                            data-testid={`bench-tab-${x.id}`}
                            onClick={() => setTab(x.id)}
                            style={{ display: 'block', width: '100%', textAlign: 'left',
                                     padding: '5px 8px', marginBottom: 2, fontSize: 12.5,
                                     border: 'none', borderRadius: 6, cursor: 'pointer',
                                     background: active ? 'var(--acc-soft, color-mix(in srgb, var(--acc) 14%, transparent))' : 'transparent',
                                     color: active ? 'var(--acc)' : 'var(--t2)',
                                     fontWeight: active ? 600 : 400 }}>
                      {t(x.labelKey, x.fallback)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}

        <div className="bench-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {tab === 'report' && <ReportScreen />}
      {tab === 'biblio' && <BiblioScreen />}
      {tab !== 'report' && martUnavailable && (
        <PanelMsg kind="info" text={t('bench.unavailable',
          'Experiment mart is unavailable — the panel works in the heimdall dev stack only')} onRetry={runs.reload} />
      )}
      {tab !== 'report' && !martUnavailable && runs.error && (
        <PanelMsg kind="error" text={runs.error} onRetry={runs.reload} />
      )}
      {tab !== 'report' && !martUnavailable && !runs.error && !martReady && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {tab !== 'report' && !martUnavailable && !runs.error && martReady && (
        <BenchErrorBoundary key={tab}>
          {tab === 'story' && <StoryScreen runs={runs.rows ?? []} />}
          {tab === 'campaigns' && <CampaignsScreen runs={runs.rows ?? []} />}
          {tab === 'generations' && (
            <GenerationsScreen runs={runs.rows ?? []} snapshots={snapshots.rows ?? []}
                               substrates={substrates.rows ?? []} subLabel={subLabel} />
          )}
          {tab === 'matrix' && (
            <MatrixScreen runs={runs.rows ?? []} subLabel={subLabel} capabilities={capabilities.rows}
                          onOpenCases={openCases} />
          )}
          {tab === 'semantic' && (
            <SemanticScreen runs={runs.rows ?? []} subLabel={subLabel} capabilities={capabilities.rows}
                            onOpenCases={openCases} />
          )}
          {tab === 'drift' && (
            <DriftScreen runs={runs.rows ?? []} snapshots={snapshots.rows ?? []}
                         substrates={substrates.rows ?? []} subLabel={subLabel} />
          )}
          {tab === 'dispersion' && (
            <DispersionScreen key={`disp|${dispersionPreset.snapshot ?? ''}|${dispersionPreset.task ?? ''}`}
                              snapshots={snapshots.rows ?? []} tasks={tasks.rows ?? []} subLabel={subLabel}
                              preset={dispersionPreset} onPinsChange={setDispersionPins} />
          )}
          {tab === 'cases' && (
            <CasesScreen key={JSON.stringify(casesPreset)}
                         runs={runs.rows ?? []} substrates={substrates.rows ?? []}
                         tasks={tasks.rows ?? []} hopKinds={hopKinds.rows ?? []} subLabel={subLabel}
                         preset={casesPreset} />
          )}
          {tab === 'pareto' && <ParetoScreen runs={runs.rows ?? []} subLabel={subLabel} />}
          {tab === 'finance' && <FinanceScreen runs={runs.rows ?? []} />}
          {tab === 'advisor' && <AdvisorScreen runs={runs.rows ?? []} subLabel={subLabel} />}
          {tab === 'winloss' && (
            <WinLossScreen runs={runs.rows ?? []} substrates={substrates.rows ?? []} subLabel={subLabel} />
          )}
          {tab === 'substrates' && <SubstratesScreen substrates={substrates.rows ?? []} />}
          {tab === 'hypotheses' && <HypothesesScreen />}
          {tab === 'findings' && <FindingsScreen />}
          {tab === 'case_registry' && <CasesDimScreen />}
          {tab === 'references' && <ReferencesScreen />}
          {tab === 'dictionaries' && <DictionariesScreen />}
          {/* HBR-11 narrative pages (N1–N4): all prose from the mart */}
          {tab === 'project' && <ProjectScreen />}
          {tab === 'metrics' && (
            <MetricsScreen hopKinds={hopKinds.rows ?? []}
                           focus={searchParams.get('metric') ?? undefined} />
          )}
          {tab === 'risks' && <RisksScreen />}
          {tab === 'design' && <DesignScreen tasks={tasks.rows ?? []} />}
        </BenchErrorBoundary>
      )}
        </div>
      </div>
    </div>
  );
}
