// LoreBragiExtras — FE-05: "Ключи" / "Архив" / "Инсайты" / "Интеграции" tabs
// of LoreBragiScreen. Four straightforward table/card views, each driven by
// one slice (bragi_keys/bragi_insights/bragi_integrations) or a small
// client-side join over bragi_calendar + fetchBragiMetrics (Архив has no
// dedicated backend slice — see note below).
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@mantine/core';
import { fetchLoreSlice, fetchBragiMetrics } from '../../api/lore';
import LoreBragiIntegrationEditor, { type LoreBragiIntegrationEditData } from './LoreBragiIntegrationEditor';
import LoreBragiKeywordEditor, { type LoreBragiKeywordEditData } from './LoreBragiKeywordEditor';
import LoreBragiRubricManager, { type RubricRow } from './LoreBragiRubricManager';
import { FilterBar, FilterDimensionMulti, type FilterTagData } from './FilterPrimitives';

// Shared facet helpers for the Bragi tables (T35) — same "empty = all,
// counts exclude own dimension" model as Forseti (T33/T34).
function facetCount<T>(rows: T[], base: (r: T) => boolean, values: (r: T) => (string | null)[]): Record<string, number> {
  const m: Record<string, number> = {};
  rows.filter(base).forEach(r => new Set(values(r).filter(Boolean) as string[]).forEach(v => { m[v] = (m[v] || 0) + 1; }));
  return m;
}
function mkSetToggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (v: string) => setter(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });
}
function distinct<T>(rows: T[], values: (r: T) => (string | null)[]): string[] {
  const s = new Set<string>();
  rows.forEach(r => values(r).forEach(v => { if (v) s.add(v); }));
  return Array.from(s).sort();
}

// ── Ключи ────────────────────────────────────────────────────────────────
interface KeywordRow {
  keyword_id: string; phrase: string; cluster: string | null;
  freq_exact: number | null; intent: string | null; page_url: string[];
  rubric_ids: string[]; rubric_names: string[];
}

export function LoreBragiKeys() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<KeywordRow[]>([]);
  const [rubrics, setRubrics] = useState<RubricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingRow, setEditingRow] = useState<KeywordRow | null>(null);

  const [intentSel, setIntentSel] = useState<Set<string>>(new Set());
  const [clusterSel, setClusterSel] = useState<Set<string>>(new Set());
  const [rubricSel, setRubricSel] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      fetchLoreSlice<KeywordRow>('bragi_keys'),
      fetchLoreSlice<RubricRow>('bragi_rubrics'),
    ])
      .then(([r, rub]) => { setRows(r); setRubrics(rub); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const intents  = useMemo(() => distinct(rows, r => [r.intent]), [rows]);
  const clusters = useMemo(() => distinct(rows, r => [r.cluster]), [rows]);
  const rubricNames = useMemo(() => distinct(rows, r => r.rubric_names), [rows]);

  const matchIntent  = useCallback((r: KeywordRow) => intentSel.size === 0 || (r.intent != null && intentSel.has(r.intent)), [intentSel]);
  const matchCluster = useCallback((r: KeywordRow) => clusterSel.size === 0 || (r.cluster != null && clusterSel.has(r.cluster)), [clusterSel]);
  const matchRubric  = useCallback((r: KeywordRow) => rubricSel.size === 0 || r.rubric_names.some(n => rubricSel.has(n)), [rubricSel]);

  const filtered = useMemo(() => rows.filter(r => matchIntent(r) && matchCluster(r) && matchRubric(r)),
    [rows, matchIntent, matchCluster, matchRubric]);
  const intentCounts  = useMemo(() => facetCount(rows, r => matchCluster(r) && matchRubric(r), r => [r.intent]), [rows, matchCluster, matchRubric]);
  const clusterCounts = useMemo(() => facetCount(rows, r => matchIntent(r) && matchRubric(r), r => [r.cluster]), [rows, matchIntent, matchRubric]);
  const rubricCounts  = useMemo(() => facetCount(rows, r => matchIntent(r) && matchCluster(r), r => r.rubric_names), [rows, matchIntent, matchCluster]);

  const toggleIntent = mkSetToggle(setIntentSel);
  const toggleCluster = mkSetToggle(setClusterSel);
  const toggleRubric = mkSetToggle(setRubricSel);
  const activeCount = intentSel.size + clusterSel.size + rubricSel.size;
  const clearAll = () => { setIntentSel(new Set()); setClusterSel(new Set()); setRubricSel(new Set()); };

  if (loading) return <div style={S.hint}>{t('bragi.extras.keys.loading', 'загрузка…')}</div>;

  /**
   * Форма — модалкой ПОВЕРХ таблицы, а не вместо неё (PL-38).
   *
   * Раньше редактор подменял собой всю панель: список ключевых слов исчезал
   * целиком, и правя фразу, нельзя было свериться с соседними — а именно
   * соседство и держит семантическое ядро (кластеры, дубли, интенты). Форма
   * при этом короткая: ей место в диалоге, а не в режиме экрана.
   */
  const editorModal = (
    <Modal
      opened={creating || !!editingRow}
      onClose={() => { setCreating(false); setEditingRow(null); }}
      title={editingRow
        ? `${t('bragi.extras.keys.editBtn', '✎ редактировать')} · ${editingRow.phrase}`
        : t('bragi.extras.keys.newBtn', '+ новое ключевое слово')}
      size={640}
    >
      <LoreBragiKeywordEditor
        editing={editingRow ? ({ ...editingRow } as LoreBragiKeywordEditData) : undefined}
        rubrics={rubrics}
        onSaved={() => { setCreating(false); setEditingRow(null); load(); }}
        onCancel={() => { setCreating(false); setEditingRow(null); }}
      />
    </Modal>
  );

  return (
    <div>
      {editorModal}
      <div style={S.descRow}>
        <div style={S.desc}>{t('bragi.extras.keys.desc', 'семантическое ядро: кластеры, точная частота [!], интент, целевая страница.')}</div>
        <button style={S.newBtn} onClick={() => setCreating(true)}>{t('bragi.extras.keys.newBtn', '+ новое ключевое слово')}</button>
      </div>
      <LoreBragiRubricManager rubrics={rubrics} onChanged={load} />
      {(intents.length + clusters.length + rubricNames.length) > 0 && (
        <div style={{ marginBottom: 12 }}>
          <FilterBar
            tier="local"
            label={t('bragi.extras.keys.filtersLabel', 'Фильтры')}
            activeCount={activeCount}
            summaryTags={[
              ...[...intentSel].map((v): FilterTagData => ({ key: 'in:' + v, label: t('bragi.keywordEditor.intent.' + v, v), onRemove: () => toggleIntent(v) })),
              ...[...clusterSel].map((v): FilterTagData => ({ key: 'cl:' + v, label: v, onRemove: () => toggleCluster(v) })),
              ...[...rubricSel].map((v): FilterTagData => ({ key: 'ru:' + v, label: v, onRemove: () => toggleRubric(v) })),
            ]}
            onClear={clearAll}
            open={filterOpen}
            onToggleOpen={() => setFilterOpen(o => !o)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {intents.length > 0 && (
                <FilterDimensionMulti label={t('bragi.extras.keys.colIntent', 'интент')}
                  options={intents.map(v => ({ value: v, label: t('bragi.keywordEditor.intent.' + v, v) }))}
                  selected={intentSel} onToggle={toggleIntent} counts={intentCounts} />
              )}
              {clusters.length > 0 && (
                <FilterDimensionMulti label={t('bragi.extras.keys.colCluster', 'кластер')}
                  options={clusters.map(v => ({ value: v, label: v }))}
                  selected={clusterSel} onToggle={toggleCluster} counts={clusterCounts} />
              )}
              {rubricNames.length > 0 && (
                <FilterDimensionMulti label={t('bragi.extras.keys.colRubric', 'рубрика')}
                  options={rubricNames.map(v => ({ value: v, label: v }))}
                  selected={rubricSel} onToggle={toggleRubric} counts={rubricCounts} />
              )}
            </div>
          </FilterBar>
        </div>
      )}
      <div style={S.card}>
        <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>{t('bragi.extras.keys.colPhrase', 'фраза')}</th><th style={S.th}>{t('bragi.extras.keys.colCluster', 'кластер')}</th><th style={S.th}>{t('bragi.extras.keys.colRubric', 'рубрика')}</th><th style={S.thNum}>{t('bragi.extras.keys.colFreq', '[!] /мес')}</th><th style={S.th}>{t('bragi.extras.keys.colIntent', 'интент')}</th><th style={S.th}>{t('bragi.extras.keys.colPage', 'страница')}</th><th style={S.th}></th></tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.keyword_id}>
                <td style={S.td}>{r.phrase}</td>
                <td style={S.td}>{r.cluster ?? '—'}</td>
                <td style={S.td}>{r.rubric_names[0] ?? '—'}</td>
                <td style={S.tdNum}>{r.freq_exact ?? '—'}</td>
                <td style={S.td}>{r.intent ?? '—'}</td>
                <td style={S.td}>{r.page_url[0] ?? '—'}</td>
                <td style={S.td}><button style={S.editBtn} onClick={() => setEditingRow(r)}>{t('bragi.extras.keys.editBtn', '✎ редактировать')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rows.length === 0 && <div style={S.hint}>{t('bragi.extras.keys.empty', 'ключей пока нет')}</div>}
        {rows.length > 0 && filtered.length === 0 && <div style={S.hint}>{t('bragi.extras.keys.emptyFiltered', 'ничего не найдено под этим фильтром')}</div>}
      </div>
    </div>
  );
}

// ── Архив ────────────────────────────────────────────────────────────────
// No dedicated backend slice — join bragi_calendar (published variants) with
// per-object metrics client-side. "вывод" (takeaway) isn't a modeled field
// on Publication/Variant in the v0.4 spec (it lives conceptually in
// BragiInsight.statement_md, but there's no direct edge from archive row to
// insight) — shown as "—" until that's modeled.
interface CalendarRow {
  variant_id: string; status: string | null; published_at: string;
  publication_id: string[]; title: string[]; channel_id: string[];
}
interface ArchiveRow extends CalendarRow { views: number; clicks: number; demo: number }

export function LoreBragiArchive() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelSel, setChannelSel] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLoreSlice<CalendarRow>('bragi_calendar').then(async cal => {
      const withMetrics = await Promise.all(cal.map(async c => {
        const [vm, pm] = await Promise.all([
          fetchBragiMetrics({ object_id: c.variant_id }),
          fetchBragiMetrics({ object_id: c.publication_id[0] ?? '' }),
        ]);
        const sum = (metric: string) =>
          [...vm, ...pm].filter(m => m.metric === metric).reduce((s, m) => s + m.value, 0);
        return { ...c, views: sum('views'), clicks: sum('clicks'), demo: sum('demo_conv') };
      }));
      if (!cancelled) { setRows(withMetrics); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const channels = useMemo(() => distinct(rows, r => r.channel_id), [rows]);
  const matchChannel = useCallback((r: ArchiveRow) => channelSel.size === 0 || r.channel_id.some(c => channelSel.has(c)), [channelSel]);
  const filtered = useMemo(() => rows.filter(matchChannel), [rows, matchChannel]);
  const channelCounts = useMemo(() => facetCount(rows, () => true, r => r.channel_id), [rows]);
  const toggleChannel = mkSetToggle(setChannelSel);

  if (loading) return <div style={S.hint}>{t('bragi.extras.archive.loading', 'загрузка…')}</div>;
  return (
    <div>
      <div style={S.desc}>{t('bragi.extras.archive.desc', 'ретроспектива: опубликованное и что оно дало.')}</div>
      {channels.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <FilterBar
            tier="local"
            label={t('bragi.extras.archive.filtersLabel', 'Фильтры')}
            activeCount={channelSel.size}
            summaryTags={[...channelSel].map((c): FilterTagData => ({ key: 'ch:' + c, label: c, onRemove: () => toggleChannel(c) }))}
            onClear={() => setChannelSel(new Set())}
            open={filterOpen}
            onToggleOpen={() => setFilterOpen(o => !o)}
          >
            <FilterDimensionMulti label={t('bragi.extras.archive.colChannel', 'канал')}
              options={channels.map(c => ({ value: c, label: c }))}
              selected={channelSel} onToggle={toggleChannel} counts={channelCounts} />
          </FilterBar>
        </div>
      )}
      <div style={S.card}>
        <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>{t('bragi.extras.archive.colPublication', 'публикация')}</th><th style={S.th}>{t('bragi.extras.archive.colChannel', 'канал')}</th><th style={S.th}>{t('bragi.extras.archive.colDate', 'дата')}</th>
            <th style={S.thNum}>{t('bragi.extras.archive.colViews', 'просмотры')}</th><th style={S.thNum}>{t('bragi.extras.archive.colClicks', 'переходы')}</th><th style={S.thNum}>{t('bragi.extras.archive.colDemo', 'демо')}</th>
          </tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.variant_id}>
                <td style={S.td}>{r.title[0] ?? r.publication_id[0]}</td>
                <td style={S.td}>{r.channel_id[0] ?? '—'}</td>
                <td style={S.td}>{r.published_at}</td>
                <td style={S.tdNum}>{r.views || '—'}</td>
                <td style={S.tdNum}>{r.clicks || '—'}</td>
                <td style={S.tdNum}>{r.demo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rows.length === 0 && <div style={S.hint}>{t('bragi.extras.archive.emptyState', 'опубликованных вариаций пока нет')}</div>}
        {rows.length > 0 && filtered.length === 0 && <div style={S.hint}>{t('bragi.extras.archive.emptyFiltered', 'ничего не найдено под этим фильтром')}</div>}
      </div>
    </div>
  );
}

// ── Инсайты ──────────────────────────────────────────────────────────────
interface InsightRow {
  insight_id: string; statement_md: string | null; insight_date: string | null;
  evidence_ref: string | null; led_tasks: string[]; led_adrs: string[];
}

export function LoreBragiInsights() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchLoreSlice<InsightRow>('bragi_insights').then(r => { if (!cancelled) { setRows(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  if (loading) return <div style={S.hint}>{t('bragi.extras.insights.loading', 'загрузка…')}</div>;
  return (
    <div>
      <div style={S.desc}>{t('bragi.extras.insights.title', 'выводы из данных → задачи и решения.')}</div>
      <div style={S.card}>
        {rows.map(r => (
          <div key={r.insight_id} style={S.insight}>
            <div style={S.insightDate}>{r.insight_date ?? '—'} {r.evidence_ref && `· ${r.evidence_ref}`}</div>
            <div style={S.insightTxt}>{r.statement_md}</div>
            {(r.led_tasks.length > 0 || r.led_adrs.length > 0) && (
              <div style={S.insightLinks}>
                {r.led_tasks.map(tk => <span key={tk} style={S.chipAcc}>{t('bragi.extras.insights.linkTask', '→ Forseti · {{id}}', { id: tk })}</span>)}
                {r.led_adrs.map(a => <span key={a} style={S.chipAcc}>{t('bragi.extras.insights.linkAdr', '→ ADR · {{id}}', { id: a })}</span>)}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <div style={S.hint}>{t('bragi.extras.insights.empty', 'инсайтов пока нет')}</div>}
      </div>
    </div>
  );
}

// ── Интеграции ───────────────────────────────────────────────────────────
interface IntegrationRow {
  integration_id: string; service: string | null; purpose: string | null;
  endpoint: string | null; scope: string | null;
  secret_ref: string | null; status: string | null; last_called_at: string | null;
}

export function LoreBragiIntegrations() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingRow, setEditingRow] = useState<IntegrationRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetchLoreSlice<IntegrationRow>('bragi_integrations')
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={S.hint}>{t('bragi.extras.integrations.loading', 'загрузка…')}</div>;
  return (
    <div>
      {/* Та же причина, что у ключевых слов: правя коннектор, надо видеть
          соседние — статусы и ссылки на секреты сверяют между собой. */}
      <Modal
        opened={creating || !!editingRow}
        onClose={() => { setCreating(false); setEditingRow(null); }}
        title={editingRow
          ? `${t('bragi.extras.integrations.editBtn', '✎ редактировать')} · ${editingRow.service ?? editingRow.integration_id}`
          : t('bragi.extras.integrations.newBtn', '+ новая интеграция')}
        size={640}
      >
        <LoreBragiIntegrationEditor
          editing={editingRow ? ({ ...editingRow } as LoreBragiIntegrationEditData) : undefined}
          onSaved={() => { setCreating(false); setEditingRow(null); load(); }}
          onCancel={() => { setCreating(false); setEditingRow(null); }}
        />
      </Modal>
      <div style={S.descRow}>
        <div style={S.desc}>{t('bragi.extras.integrations.title', 'коннекторы для сбора метрик и публикации. Токены — по ссылке на секрет, не значением.')}</div>
        <button style={S.newBtn} onClick={() => setCreating(true)}>{t('bragi.extras.integrations.newBtn', '+ новая интеграция')}</button>
      </div>
      <div style={S.card}>
        <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>{t('bragi.extras.integrations.colService', 'сервис')}</th><th style={S.th}>{t('bragi.extras.integrations.colPurpose', 'назначение')}</th><th style={S.th}>{t('bragi.extras.integrations.colStatus', 'статус')}</th><th style={S.th}>{t('bragi.extras.integrations.colSecret', 'секрет')}</th><th style={S.th}>{t('bragi.extras.integrations.colLastCalled', 'последний вызов')}</th><th style={S.th}></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.integration_id}>
                <td style={S.td}>{r.service ?? r.integration_id}</td>
                <td style={S.td}>{r.purpose ? t('bragi.integrationEditor.purpose.' + r.purpose.replace('/', '_'), r.purpose) : '—'}</td>
                <td style={S.td}>
                  <span style={statusDotStyle(r.status === 'active' ? 'var(--suc)' : 'var(--wrn)')} />
                  {r.status ? t('bragi.integrationEditor.status.' + r.status, r.status) : '—'}
                </td>
                <td style={S.td}><code style={{ fontSize: 'var(--fs-sm)' }}>{r.secret_ref ?? '—'}</code></td>
                <td style={S.td}>{r.last_called_at ?? '—'}</td>
                <td style={S.td}><button style={S.editBtn} onClick={() => setEditingRow(r)}>{t('bragi.extras.integrations.editBtn', '✎ редактировать')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rows.length === 0 && <div style={S.hint}>{t('bragi.extras.integrations.empty', 'интеграций пока нет')}</div>}
      </div>
    </div>
  );
}

function statusDotStyle(color: string): React.CSSProperties {
  return { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: color, marginRight: 6 };
}

const S: Record<string, React.CSSProperties> = {
  descRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  newBtn:  { flex: 'none', height: 28, padding: '0 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
             background: 'var(--acc)', color: 'var(--on-accent)', fontSize: 'var(--fs-base)', fontWeight: 600 },
  desc:    { color: 'var(--t2)', fontSize: 'var(--fs-lg)', marginBottom: 18 },
  hint:    { fontSize: 'var(--fs-base)', color: 'var(--t3)' },
  card:    { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '10px 18px' },
  tableWrap: { overflowX: 'auto' as const, width: '100%' },
  table:   { width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 'var(--fs-md)' },
  th:      { textAlign: 'left', color: 'var(--t3)', fontWeight: 400, fontSize: 'var(--fs-sm)', padding: '8px 10px',
             borderBottom: '1px solid var(--bd)', fontFamily: 'var(--mono)' },
  thNum:   { textAlign: 'right', color: 'var(--t3)', fontWeight: 400, fontSize: 'var(--fs-sm)', padding: '8px 10px',
             borderBottom: '1px solid var(--bd)', fontFamily: 'var(--mono)' },
  td:      { padding: '10px 10px', borderBottom: '1px solid var(--bd)', verticalAlign: 'top' },
  tdNum:   { padding: '10px 10px', borderBottom: '1px solid var(--bd)', textAlign: 'right', fontFamily: 'var(--mono)' },
  insight: { borderLeft: '2px solid var(--acc)', padding: '2px 0 2px 14px', marginBottom: 16 },
  insightDate: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 5 },
  insightTxt:  { fontSize: 'var(--fs-lg)', lineHeight: 1.5 },
  insightLinks:{ marginTop: 9, display: 'flex', gap: 7, flexWrap: 'wrap' },
  chipAcc: { background: 'color-mix(in srgb, var(--acc) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
             borderRadius: 6, padding: '1px 8px', fontSize: 'var(--fs-sm)', color: 'var(--acc)' },
  editBtn: { flex: 'none', fontSize: 'var(--fs-sm)', color: 'var(--t2)', background: 'transparent', border: '1px solid var(--b3)',
             borderRadius: 5, padding: '3px 9px', cursor: 'pointer' },
};
