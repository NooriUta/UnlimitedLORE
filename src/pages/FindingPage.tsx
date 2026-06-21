import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMartSlice } from '../hooks/useBench';
import type { FindingRow } from '../utils/benchData';
import { dedupe, pickLocale, strArr } from '../utils/benchData';
import { PanelMsg, StatusBadge } from '../components/bench/shared';
import { MartProse } from '../components/bench/MartProse';

const EMPTY_PARAMS: Record<string, string> = {};

function findingTone(statusId: string | undefined): 'suc' | 'warn' | 'err' | 'neutral' {
  if (statusId === 'fixed') return 'suc';
  if (statusId === 'open') return 'err';
  if (statusId === 'localized' || statusId === 'reported') return 'warn';
  return 'neutral';
}

/**
 * Finding profile (v6.1 prose): the full narrative of a bug/event, where it
 * came from (YIELDED_BY campaign) and which cases demonstrate it — each demo
 * case links into the drill-down.
 */
export default function FindingPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  usePageTitle(`${id ?? ''} — ${t('bench.title', 'RAG vs Parse — experiment')}`);

  const findings = useMartSlice<FindingRow>('findings', EMPTY_PARAMS);
  const f = (findings.rows ?? []).find(x => x.finding_id === id);
  const demoCases = dedupe(strArr(f?.demo_cases));

  const evid = f ? pickLocale(lang, f.evidence_ru_sci, f.evidence_en, f.evidence, f.evidence_ru) : undefined;
  const narrative = f ? pickLocale(lang, f.narrative_ru_sci, f.narrative_en, f.narrative, f.narrative_ru) : undefined;

  return (
    <div className="page-content bench-scroll" style={{ padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}
         data-testid="finding-page">
      <Link to="/benchmark?tab=campaigns" style={{ fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
        {t('bench.sub.back', '← Benchmark panel')}
      </Link>

      {findings.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={findings.reload} />}
      {!findings.unavailable && !findings.rows && !findings.error && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}
      {findings.rows && !f && (
        <PanelMsg kind="error" text={`${t('bench.find.notFound', 'Finding not found in the mart')}: ${id ?? ''}`} />
      )}

      {f && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '10px 0 4px' }}>
            <h1 className="page-title" style={{ margin: 0, fontFamily: 'var(--mono)' }}>{f.finding_id}</h1>
            <StatusBadge tone={findingTone(f.finding_status_id)} text={f.finding_status_id ?? '?'} />
            {f.finding_class_id && <span className="scope-tag">{f.finding_class_id}</span>}
            {f.side && <span className="scope-tag">{t('bench.findingSide', 'side')}: {f.side}</span>}
          </div>
          {f.title && (
            <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.55, maxWidth: 980, margin: '6px 0 14px' }}>
              {f.title}
            </p>
          )}

          <div className="analytics-card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
              {(f.campaigns ?? []).map(c => (
                <span key={c} className="scope-tag">YIELDED_BY: {c}</span>
              ))}
              {f.snapshot_id && <span className="scope-tag">snapshot: {f.snapshot_id}</span>}
              <span className="scope-tag">found: {f.found_ts ?? '—'}</span>
              <span className="scope-tag">resolved: {f.resolved_ts ?? '—'}</span>
            </div>
            {evid && (
              <p style={{ fontSize: 12, color: 'var(--t2)', margin: '8px 0 0', fontFamily: 'var(--mono)' }}>{evid}</p>
            )}
          </div>

          {narrative && (
            <div className="analytics-card" style={{ marginBottom: 12 }}>
              <div className="analytics-card-title">{t('bench.find.narrative', 'Full story (narrative)')}</div>
              <MartProse text={narrative} style={{ maxWidth: 980 }} />
            </div>
          )}

          {demoCases.length > 0 && (
            <div className="analytics-card" style={{ marginBottom: 12 }}>
              <div className="analytics-card-title">{t('bench.find.demo', 'Demonstrated by cases')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {demoCases.map(caseId => (
                  <Link key={caseId}
                        to={`/benchmark?tab=cases&case_id=${encodeURIComponent(caseId)}`}
                        className="scope-tag"
                        style={{ color: 'var(--acc)', textDecoration: 'none' }}>
                    {caseId}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
