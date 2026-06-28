import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoreDisabledError, LoreUpstreamError } from '../api/lore';
import { LoreErrorBoundary } from '../components/lore/LoreErrorBoundary';
import LoreTimeline        from '../components/lore/LoreTimeline';
import LoreAdrList         from '../components/lore/LoreAdrList';
import LoreAdrPassportView from '../components/lore/LoreAdrPassportView';
import LoreAdrEditor       from '../components/lore/LoreAdrEditor';
import LoreSprintTree, { STATUS_FILTERS, type DatePeriod, type SprintStats } from '../components/lore/LoreSprintTree';
import LoreComponentList, { areaColor } from '../components/lore/LoreComponentList';
import LoreComponentPassport from '../components/lore/LoreComponentPassport';
import LoreSpecView           from '../components/lore/LoreSpecView';
import { ADR_STATUS_FILTERS } from '../components/lore/LoreAdrList';
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
  { id: 'releases',   icon: 'open-book',      label: 'Релизы'       },
  { id: 'components', icon: 'cog',            label: 'Компоненты'   },
  { id: 'evolution',  icon: 'hourglass',      label: 'История'      },
  { id: 'timeline',   icon: 'tied-scroll',    label: 'Лента'        },
  { id: 'mcp',        icon: 'plug',           label: 'MCP API'      },
];

// Sections that use master-detail layout (list panel + detail panel)
const MASTER_DETAIL: Section[] = ['adrs', 'sprints', 'components'];

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
  const [params, setParams] = useSearchParams();

  const section   = (params.get('section') as Section) || 'plan';
  const q         = params.get('q')         || '';
  const passport  = params.get('passport')  || '';
  const spec      = params.get('spec')      || '';

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

  const isMasterDetail = MASTER_DETAIL.includes(section);

  // Sections where the global search bar is actually passed to children
  const SEARCH_SECTIONS: Section[] = ['decisions', 'releases', 'timeline'];
  const showGlobalSearch = SEARCH_SECTIONS.includes(section);

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
  const openSpec      = (id: string) => setParams(p => { p.set('spec', id); p.delete('passport'); return p; });
  const clearSpec     = ()           => setParams(p => { p.delete('spec'); return p; });
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
        <span style={{ fontSize: 11 }}>Установить <code>lore.enabled=true</code> в lore-backend (:9100).</span>
      </div>
    </div>
  );

  if (loreUnreachable) return (
    <div style={S.root}>
      <div style={{ ...S.body, ...S.disabledBanner }}>
        <span style={{ fontSize: 32 }}>⚠️</span>
        <span>LORE недоступен — lore-backend (:9100) не отвечает.</span>
        <button style={{ fontSize: 11, marginTop: 8, cursor: 'pointer' }} onClick={() => setLoreUnreachable(false)}>
          Повторить
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
            placeholder="поиск по базе знаний…"
            aria-label="поиск по базе знаний"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* ── Horizontal section nav ─────────────────────────────────────────── */}
      {sectionNav}

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
                  userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? meta.color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${meta.color} 18%, transparent)` : 'transparent',
                  color: on ? 'var(--t1)' : 'var(--t3)',
                }}
              >
                <GameIcon slug={meta.icon} size={11} style={{ color: meta.color }} />
                {f.label}
                <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{cnt}</span>
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
            title="В работе + Частично"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
              userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintPresetWorking ? 'var(--acc)' : 'var(--b3)'}`,
              background: sprintPresetWorking ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
              color: sprintPresetWorking ? 'var(--acc)' : 'var(--t3)',
            }}
          >⚡ В работе</span>

          {/* Пресет: Нужно внимание */}
          <span
            onClick={() => {
              if (sprintPresetAttention) { setSprintStatusSel(new Set()); setSprintNoRelease(false); }
              else { setSprintStatusSel(new Set(['in_progress'])); setSprintNoRelease(true); }
            }}
            title="В работе без привязки к релизу"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
              userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintPresetAttention ? '#E24B4A' : 'var(--b3)'}`,
              background: sprintPresetAttention ? 'color-mix(in srgb, #E24B4A 16%, transparent)' : 'transparent',
              color: sprintPresetAttention ? '#E24B4A' : 'var(--t3)',
            }}
          >⚠ Внимание</span>

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
                  padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
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
            const label = p === 'month' ? 'Этот месяц' : p === 'quarter' ? 'Квартал' : '90 дней';
            const on    = sprintDatePeriod === p;
            return (
              <span key={p!}
                onClick={() => setSprintDatePeriod(on ? null : p)}
                style={{
                  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
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
              userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
              border: `1px solid ${sprintNoRelease ? 'var(--acc)' : 'var(--b3)'}`,
              background: sprintNoRelease ? 'color-mix(in srgb, var(--acc) 16%, transparent)' : 'transparent',
              color: sprintNoRelease ? 'var(--acc)' : 'var(--t3)',
            }}
          >Без релиза</span>

          {/* Сброс */}
          {(sprintStatusSel.size > 0 || sprintNoRelease || sprintDatePeriod || sprintPriorityFilter.size > 0) && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--b2)', flexShrink: 0, margin: '0 2px' }} />
              <span
                onClick={() => { setSprintStatusSel(new Set()); setSprintNoRelease(false); setSprintDatePeriod(null); setSprintPriorityFilter(new Set()); }}
                style={{ fontSize: 11, color: 'var(--t3)', cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
                title="Сбросить фильтры"
              >✕ сброс</span>
            </>
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
                title={`${f.label}: ${cnt}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
                  border: `1px solid ${on ? f.color : 'var(--b3)'}`,
                  background: on ? `color-mix(in srgb, ${f.color} 18%, transparent)` : 'transparent',
                  color: on ? 'var(--t1)' : 'var(--t3)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                {f.label}
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
                title="Сбросить фильтры"
              >✕ сброс</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            {adrStatusSel.size === 0
              ? `${Object.values(adrCounts).reduce((a, b) => a + b, 0)} ADR всего`
              : `${ADR_STATUS_FILTERS.filter(f => adrStatusSel.has(f.key)).reduce((s, f) => s + (adrCounts[f.key] ?? 0), 0)} из ${Object.values(adrCounts).reduce((a, b) => a + b, 0)}`}
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
                    userSelect: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap',
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
                title="Сбросить фильтр по area"
              >✕ сброс</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            {Object.values(compAreaCounts).reduce((a, b) => a + b, 0)} компонентов
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
            { label: 'всего',      value: sprintStats.total,     color: 'var(--t1)' },
            { label: 'завершено',  value: sprintStats.done,      color: '#4dc9a0'   },
            { label: 'активных',   value: sprintStats.active,    color: 'var(--acc)'},
            { label: 'P0 открыто', value: sprintStats.p0Open,    color: '#E24B4A'   },
            { label: 'без релиза', value: sprintStats.noRelease, color: 'var(--t3)' },
          ] as const).map((s, i) => (
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
            <span style={{ fontSize: 9, color: 'var(--t3)', whiteSpace: 'nowrap', marginTop: 1 }}>выполнено</span>
          </div>
          ); })()}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={S.body}>
        {/* ── Master-detail layout ─────────────────────────────────────────── */}
        {isMasterDetail && (
          <>
          <div style={{ ...S.listPanel, width: listW }} className="lore-panel-scroll">
            {/* List panel header — search only for ADRs; sprints use the full-width bar above */}
            {section === 'adrs' && (
              <div style={S.listPanelHeader}>
                🔍
                <input
                  style={S.listPanelSearch}
                  placeholder="ADR-..."
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
                    placeholder="спринт…"
                    aria-label="поиск по имени спринта"
                    value={sprintQ}
                    onChange={e => setSprintQ(e.target.value)}
                  />
                  {sprintQ && (
                    <span onClick={() => setSprintQ('')}
                      style={{ color: 'var(--t3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</span>
                  )}
                </div>
                <LoreSprintTree
                  module=""
                  q={sprintQ}
                  statusFilter={sprintStatusSel}
                  priorityFilter={sprintPriorityFilter}
                  noRelease={sprintNoRelease}
                  datePeriod={sprintDatePeriod}
                  selectedId={passport}
                  onError={handleFetchError}
                  onSelect={selectItem}
                  onCounts={setSprintCounts}
                  onStats={setSprintStats}
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
                    placeholder="компонент…"
                    aria-label="поиск по компонентам"
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
          </div>
          <div
            className="lore-resize-handle"
            onMouseDown={e => { dragRef.current = { x: e.clientX, w: listW }; e.preventDefault(); }}
          />
          </>
        )}

        {/* ── Content area ─────────────────────────────────────────────────── */}
        <div style={S.content}>
          <LoreErrorBoundary label={`Ошибка секции «${section}»`}>
          {/* Plan */}
          {section === 'plan' && <LorePlanBoard onError={handleFetchError} />}

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
              <span>Выберите ADR из списка слева</span>
              <span style={{ fontSize: 10, color: 'var(--t3)' }}>или нажмите «+ новый ADR» чтобы создать</span>
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

          {/* Sprints: detail or placeholder */}
          {section === 'sprints' && passport && (
            <LoreSprintDetail sprintId={passport} onError={handleFetchError} />
          )}
          {section === 'sprints' && !passport && (
            <div style={S.placeholder}>Выберите спринт из списка слева</div>
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
              onNavigateAdr={navigateToAdr}
              onNavigateComponent={selectItem}
              onOpenSpec={openSpec}
            />
          )}
          {section === 'components' && !spec && !passport && (
            <div style={S.placeholder}>Выберите компонент из списка слева</div>
          )}

          {/* Evolution */}
          {section === 'evolution' && <LoreEvolutionView onError={handleFetchError} />}

          {/* Timeline */}
          {section === 'timeline' && (
            <LoreTimeline module="" q={debouncedQ} onError={handleFetchError}
              onSelect={navigateToAdr} onSelectSprint={navigateToSprint} />
          )}

          {/* MCP API — published reference for the aida-lore MCP server */}
          {section === 'mcp' && <LoreMcpApiScreen />}
          </LoreErrorBoundary>
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
