import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoreDisabledError, LoreUpstreamError } from '../api/lore';
import LoreTimeline        from '../components/lore/LoreTimeline';
import LoreAdrList         from '../components/lore/LoreAdrList';
import LoreAdrPassportView from '../components/lore/LoreAdrPassportView';
import LoreSprintTree      from '../components/lore/LoreSprintTree';
import LoreArtifactList    from '../components/lore/LoreArtifactList';
import LoreArtifactDoc, { type DocKind } from '../components/lore/LoreArtifactDoc';
import LoreSpecView        from '../components/lore/LoreSpecView';
import LorePlanBoard       from '../components/lore/LorePlanBoard';
import LoreEvolutionView   from '../components/lore/LoreEvolutionView';
import LoreSprintDetail    from '../components/lore/LoreSprintDetail';
import LoreDecisionBoard   from '../components/lore/LoreDecisionBoard';
import LoreReleasesBoard   from '../components/lore/LoreReleasesBoard';
import LoreMcpApiScreen    from '../components/lore/LoreMcpApiScreen';
import { GameIcon }        from '../components/lore/GameIcon';
import { statusMeta }      from '../components/lore/lore-status';

// ── Sections ──────────────────────────────────────────────────────────────────
type Section =
  | 'plan' | 'sprints' | 'adrs' | 'decisions' | 'releases'
  | 'components'
  | 'evolution' | 'timeline' | 'mcp';

// icon = game-icons slug (bundled offline via addCollection in main.tsx)
const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: 'plan',       icon: 'compass',        label: 'План'         },
  { id: 'sprints',    icon: 'sprint',         label: 'Спринты'      },
  { id: 'adrs',       icon: 'scroll-quill',   label: 'ADR'          },
  { id: 'decisions',  icon: 'vote',           label: 'Решения'      },
  { id: 'releases',   icon: '',               label: 'Релизы'       },
  { id: 'components', icon: 'cog',            label: 'Компоненты'   },
  { id: 'evolution',  icon: 'hourglass',      label: 'История'      },
  { id: 'timeline',   icon: 'tied-scroll',    label: 'Лента'        },
  { id: 'mcp',        icon: 'plug',           label: 'MCP API'      },
];

// Sections that use master-detail layout (list panel + detail panel)
const MASTER_DETAIL: Section[] = ['adrs', 'sprints'];

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
    borderBottom: '1px solid var(--b2)',
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
    borderBottom: '1px solid var(--b2)',
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
  // List panel (master-detail) — width applied dynamically via listW state
  listPanel: {
    flexShrink: 0,
    borderRight: '1px solid var(--b2)',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  listPanelHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 12px', height: 32, flexShrink: 0,
    borderBottom: '1px solid var(--b2)',
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
  const [params, setParams] = useSearchParams();

  const section   = (params.get('section') as Section) || 'plan';
  const q         = params.get('q')         || '';
  const passport  = params.get('passport')  || '';
  const kind      = params.get('kind')      || '';
  const art       = params.get('art')       || '';

  const [loreDisabled, setLoreDisabled] = useState(false);
  const [loreUnreachable, setLoreUnreachable] = useState(false);
  const [search, setSearch] = useState(q);
  const [listSearch, setListSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [listW, setListW] = useState(LIST_W_DEFAULT);
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  const isMasterDetail = MASTER_DETAIL.includes(section);

  const go = (s: Section) => setParams(p => {
    p.set('section', s);
    p.delete('passport');
    p.delete('kind');
    p.delete('art');
    return p;
  });

  const selectItem    = (id: string) => setParams(p => { p.set('passport', id); return p; });
  const clearItem     = ()           => setParams(p => { p.delete('passport'); return p; });
  const navigateToAdr    = (id: string) => setParams(p => { p.set('section', 'adrs');    p.set('passport', id); p.delete('kind'); p.delete('art'); return p; });
  const navigateToSprint = (id: string) => setParams(p => { p.set('section', 'sprints'); p.set('passport', id); p.delete('kind'); p.delete('art'); return p; });

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
      {SECTIONS.map(s => (
        <button
          key={s.id}
          style={S.navItem(section === s.id)}
          onClick={() => go(s.id)}
          title={s.label}
        >
          {s.icon && <GameIcon slug={s.icon} size={15} style={{ color: 'inherit' }} />}
          <span>{s.label}</span>
        </button>
      ))}
    </nav>
  );

  if (loreDisabled) return (
    <div style={S.root}>
      <div style={{ ...S.body, ...S.disabledBanner }}>
        <span style={{ fontSize: 32 }}>📚</span>
        <span>LORE отключён в этой среде.</span>
        <span style={{ fontSize: 11 }}>Установить <code>lore.enabled=true</code> в heimdall-backend.</span>
      </div>
    </div>
  );

  if (loreUnreachable) return (
    <div style={S.root}>
      <div style={{ ...S.body, ...S.disabledBanner }}>
        <span style={{ fontSize: 32 }}>⚠️</span>
        <span>LORE недоступен — heimdall-backend не отвечает.</span>
        <button style={{ fontSize: 11, marginTop: 8, cursor: 'pointer' }} onClick={() => setLoreUnreachable(false)}>
          Повторить
        </button>
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      {/* ── Top search bar ─────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <span style={S.searchIcon}>🔍</span>
        <input
          style={S.searchInput}
          placeholder="поиск по базе знаний…"
          aria-label="поиск по базе знаний"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>

      {/* ── Horizontal section nav ─────────────────────────────────────────── */}
      {sectionNav}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={S.body}>
        {/* ── Master-detail layout ─────────────────────────────────────────── */}
        {isMasterDetail && (
          <>
          <div style={{ ...S.listPanel, width: listW }} className="lore-panel-scroll">
            {/* List panel header with search */}
            <div style={S.listPanelHeader}>
              🔍
              <input
                style={S.listPanelSearch}
                placeholder={section === 'adrs' ? 'ADR-...' : section === 'decisions' ? '#...' : 'спринт...'}
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
              />
              {passport && (
                <button
                  onClick={clearItem}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--t3)', fontSize: 11, padding: '0 2px' }}
                  title="Сбросить выбор"
                >✕</button>
              )}
            </div>

            {/* List content */}
            {section === 'adrs' && (
              <LoreAdrList
                module=""
                q={listSearch}
                selectedId={passport}
                onError={handleFetchError}
                onOpen={selectItem}
              />
            )}
            {section === 'sprints' && (
              <LoreSprintTree
                module=""
                q={listSearch}
                selectedId={passport}
                onError={handleFetchError}
                onSelect={selectItem}
              />
            )}
          </div>
          <div
            className="lore-resize-handle"
            onMouseDown={e => { dragRef.current = { x: e.clientX, w: listW }; e.preventDefault(); }}
          />
          </>
        )}

        {/* ── Content area ─────────────────────────────────────────────────── */}
        <div style={S.content}>
          {/* Plan */}
          {section === 'plan' && <LorePlanBoard onError={handleFetchError} />}

          {/* ADR detail */}
          {section === 'adrs' && passport && (
            <LoreAdrPassportView
              adrId={passport}
              onError={handleFetchError}
              onBack={clearItem}
              onNavigate={navigateToAdr}
            />
          )}
          {section === 'adrs' && !passport && (
            <div style={S.placeholder}>Выберите ADR из списка слева</div>
          )}

          {/* Decisions: composite feed */}
          {section === 'decisions' && (
            <LoreDecisionBoard q={q} onError={handleFetchError} />
          )}

          {/* Releases */}
          {section === 'releases' && (
            <LoreReleasesBoard q={q} onError={handleFetchError} onNavigateToSprint={navigateToSprint} />
          )}

          {/* Sprints: detail or placeholder */}
          {section === 'sprints' && passport && (
            <LoreSprintDetail sprintId={passport} onError={handleFetchError} />
          )}
          {section === 'sprints' && !passport && (
            <div style={S.placeholder}>Выберите спринт из списка слева</div>
          )}

          {/* Components — unified artifact list (ADR / specs / runbooks / docs / QG) */}
          {section === 'components' && (
            <>
              {/* List stays visible (master); detail opens beside it — like ADR */}
              <div style={{ width: 400, flexShrink: 0, borderRight: '1px solid var(--b2)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
                <LoreArtifactList
                  selectedKind={kind}
                  selectedId={art}
                  onError={handleFetchError}
                  onOpen={(k, id) => setParams(p => { p.set('kind', k); p.set('art', id); return p; })}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {kind && art ? (
                  kind === 'adr' ? (
                    <LoreAdrPassportView
                      adrId={art}
                      onError={handleFetchError}
                      onBack={() => setParams(p => { p.delete('kind'); p.delete('art'); return p; })}
                      onNavigate={id => setParams(p => { p.set('kind', 'adr'); p.set('art', id); return p; })}
                    />
                  ) : kind === 'spec' ? (
                    <LoreSpecView
                      specId={art}
                      onError={handleFetchError}
                      onBack={() => setParams(p => { p.delete('kind'); p.delete('art'); return p; })}
                    />
                  ) : (
                    <LoreArtifactDoc
                      kind={kind as DocKind}
                      id={art}
                      onError={handleFetchError}
                      onBack={() => setParams(p => { p.delete('kind'); p.delete('art'); return p; })}
                    />
                  )
                ) : (
                  <div style={S.placeholder}>Выберите артефакт из списка</div>
                )}
              </div>
            </>
          )}

          {/* Evolution */}
          {section === 'evolution' && <LoreEvolutionView onError={handleFetchError} />}

          {/* Timeline */}
          {section === 'timeline' && (
            <LoreTimeline module="" q={q} onError={handleFetchError}
              onSelect={navigateToAdr} onSelectSprint={navigateToSprint} />
          )}

          {/* MCP API — published reference for the aida-lore MCP server */}
          {section === 'mcp' && <LoreMcpApiScreen />}
        </div>
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const { icon, color } = statusMeta(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, padding: '1px 5px 1px 4px', borderRadius: 3,
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      <GameIcon slug={icon} size={11} style={{ color: 'inherit' }} />
      {status}
    </span>
  );
}
