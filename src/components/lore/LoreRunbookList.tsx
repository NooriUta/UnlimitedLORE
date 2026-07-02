import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import { GameIcon } from './GameIcon';

interface RunbookRow {
  runbook_id: string;
  name: string;
  area: string;
  date_created: string | null;
}

// Static fallback colors; real areas are discovered from data
const AREA_COLORS: Record<string, string> = {
  recovery: '#e57373',
  infra:    '#ff9800',
  deploy:   '#2196f3',
  ops:      '#9e9e9e',
  auth:     '#ab47bc',
  db:       '#26a69a',
  service:  '#42a5f5',
};

// Game-icons slugs per area (bundled offline)
const AREA_ICONS: Record<string, string> = {
  recovery: 'health-potion',
  infra:    'brick-wall',
  deploy:   'parachute',
  ops:      'cog',
  auth:     'padlock',
  db:       'database',
  service:  'gear-hammer',
};

function areaColor(a: string): string {
  return AREA_COLORS[a] ?? 'var(--t3)';
}

function exportMd(rows: RunbookRow[], areaFilter: string) {
  const filtered = areaFilter ? rows.filter(r => r.area === areaFilter) : rows;
  const byArea: Record<string, RunbookRow[]> = {};
  filtered.forEach(r => {
    (byArea[r.area] ??= []).push(r);
  });
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Runbook Checklist — ${date}`,
    areaFilter ? `\nArea: **${areaFilter}**` : '',
    '',
  ];
  Object.entries(byArea).sort(([a], [b]) => a.localeCompare(b)).forEach(([area, rbs]) => {
    lines.push(`\n## ${area.toUpperCase()}\n`);
    rbs.forEach(r => lines.push(`- [ ] **${r.name}** \`${r.runbook_id}\``));
  });
  const a = document.createElement('a');
  a.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  a.download = `runbooks-checklist-${date}.md`;
  a.click();
}

interface Props {
  onError: (e: unknown) => void;
  onOpen?: (id: string) => void;
}

export default function LoreRunbookList({ onError, onOpen }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]       = useState<RunbookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea]       = useState('');

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<RunbookRow>('runbooks', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // Dynamic areas discovered from data — T04
  const allAreas = ['', ...new Set(rows.map(r => r.area).filter(Boolean)).values()];

  const shown = area ? rows.filter(r => r.area === area) : rows;

  return (
    <div style={S.root}>
      {/* Area filter + export — T04 + T07 */}
      <div style={S.toolbar}>
        {allAreas.map(a => (
          <button key={a || 'all'} style={S.chip(area === a, areaColor(a))} onClick={() => setArea(a)}>
            {a ? (
              <>
                {AREA_ICONS[a] && (
                  <GameIcon slug={AREA_ICONS[a]} size={11} style={{ color: 'inherit', flexShrink: 0 }} />
                )}
                {a}
              </>
            ) : t('lore.runbookList.allFilter', 'все')}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={S.exportBtn} onClick={() => exportMd(rows, area)} title={t('lore.runbookList.exportTitle', 'Экспорт чеклиста в Markdown')}>
          ↓ MD
        </button>
      </div>

      {/* Count badge */}
      <div style={S.countRow}>
        <span style={{ color: 'var(--t3)', fontSize: 10 }}>
          {shown.length} runbook{shown.length !== 1 ? 's' : ''}
          {area ? ` · ${area}` : ''}
        </span>
      </div>

      {loading ? (
        <div style={S.state}>{t('lore.runbookList.loading', 'Загрузка runbooks…')}</div>
      ) : (
        <div style={S.list}>
          {shown.map(r => (
            <div
              key={r.runbook_id}
              style={S.row}
              onClick={() => onOpen?.(r.runbook_id)}
            >
              <span style={S.areaChip(r.area)}>
                {AREA_ICONS[r.area] && (
                  <GameIcon slug={AREA_ICONS[r.area]} size={10} style={{ color: 'inherit', flexShrink: 0 }} />
                )}
                {r.area}
              </span>
              <span style={S.id}>{r.runbook_id}</span>
              <span style={S.name}>{r.name}</span>
              {onOpen && <span style={S.arrow}>→</span>}
              <span style={S.date}>{r.date_created?.slice(0, 10) ?? ''}</span>
            </div>
          ))}
          {shown.length === 0 && <div style={S.state}>{t('lore.runbookList.empty', 'Runbooks не найдены.')}</div>}
        </div>
      )}
    </div>
  );
}

const S = {
  root:    { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px',
    borderBottom: '1px solid var(--bd)', flexShrink: 0, flexWrap: 'wrap' as const,
  },
  chip: (active: boolean, color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    height: 24, padding: '0 9px', border: `1px solid ${active ? color : 'var(--b3)'}`,
    borderRadius: 12, cursor: 'pointer', fontSize: 10, userSelect: 'none' as const,
    background: active ? `color-mix(in srgb, ${color} 20%, transparent)` : 'transparent',
    color: active ? color : 'var(--t3)',
    fontFamily: 'inherit',
  }),
  exportBtn: {
    height: 22, padding: '0 8px', border: '1px solid var(--b3)', borderRadius: 3,
    cursor: 'pointer', fontSize: 10, background: 'var(--b2)', color: 'var(--t2)',
    fontFamily: 'inherit',
  },
  countRow: {
    padding: '3px 14px', borderBottom: '1px solid var(--bd)',
    flexShrink: 0,
  },
  list:  { flex: 1, overflowY: 'auto' as const },
  state: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 14px', borderBottom: '1px solid var(--bd)', fontSize: 12, cursor: 'pointer',
  },
  areaChip: (a: string) => {
    const color = areaColor(a);
    return {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, padding: '1px 7px', borderRadius: 10, flexShrink: 0,
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    };
  },
  arrow: { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
  id:    { color: 'var(--t3)', fontSize: 11, minWidth: 160, flexShrink: 0 },
  name:  { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  date:  { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
};
