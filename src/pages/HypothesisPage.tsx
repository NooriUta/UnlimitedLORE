import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMartSlice } from '../hooks/useMuninn';
import type { HypothesisRow } from '../utils/muninnData';
import { pickLocale } from '../utils/muninnData';
import { PanelMsg, StatusBadge, hypothesisTone } from '../components/bench/shared';
import { MartProse } from '../components/bench/MartProse';

const EMPTY_PARAMS: Record<string, string> = {};

function ProseBlock({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="analytics-card" style={{ marginBottom: 12 }}>
      <div className="analytics-card-title">{title}</div>
      <MartProse text={text} style={{ maxWidth: 980 }} />
    </div>
  );
}

/**
 * Hypothesis profile (v6.1 prose): the mart is a carrier of reasoning, not
 * just numbers — why the bet exists, how it is tested, what the verdict means,
 * and the pre-registration → verdict timeline (anti-p-hacking evidence).
 */
export default function HypothesisPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  usePageTitle(`${id ?? ''} — ${t('bench.title', 'RAG vs Parse — experiment')}`);

  const hypotheses = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);
  const h = (hypotheses.rows ?? []).find(x => x.hyp_id === id);

  const stmt = h ? pickLocale(lang, h.statement_ru_sci, h.statement_en, h.statement, h.statement_ru) : undefined;
  const evid = h ? pickLocale(lang, h.evidence_ru_sci, h.evidence_en, h.evidence, h.evidence_ru) : undefined;
  const rationale = h ? pickLocale(lang, h.rationale_ru_sci, h.rationale_en, h.rationale, h.rationale_ru) : undefined;
  const mechanism = h ? pickLocale(lang, h.mechanism_ru_sci, h.mechanism_en, h.mechanism, h.mechanism_ru) : undefined;
  const interpretation = h ? pickLocale(lang, h.interpretation_ru_sci, h.interpretation_en, h.interpretation, h.interpretation_ru) : undefined;

  return (
    <div className="page-content bench-scroll" style={{ padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}
         data-testid="hypothesis-page">
      <Link to="/benchmark?tab=campaigns" style={{ fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
        {t('bench.sub.back', '← Benchmark panel')}
      </Link>

      {hypotheses.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={hypotheses.reload} />}
      {!hypotheses.unavailable && !hypotheses.rows && !hypotheses.error && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}
      {hypotheses.rows && !h && (
        <PanelMsg kind="error" text={`${t('bench.hyp.notFound', 'Hypothesis not found in the mart')}: ${id ?? ''}`} />
      )}

      {h && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '10px 0 4px' }}>
            <h1 className="page-title" style={{ margin: 0, fontFamily: 'var(--mono)' }}>{h.hyp_id}</h1>
            <StatusBadge tone={hypothesisTone(h.status)} text={h.status ?? '?'} />
            {h.metric && <span className="scope-tag">{t('bench.hyp.metric', 'metric')}: {h.metric}</span>}
            {h.threshold && <span className="scope-tag">{t('bench.hyp.threshold', 'threshold')}: {h.threshold}</span>}
          </div>
          {stmt && (
            <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.55, maxWidth: 980, margin: '6px 0 14px' }}>
              {stmt}
            </p>
          )}

          <div className="analytics-card" style={{ marginBottom: 12 }}>
            <div className="analytics-card-title">{t('bench.hyp.timeline', 'Pre-registration → verdict')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <span className="scope-tag">{t('bench.registered', 'registered')}: {h.registered_ts ?? '—'}</span>
              <span style={{ color: 'var(--t3)' }}>→</span>
              {(h.campaigns ?? []).map(c => <span key={c} className="scope-tag">{t('bench.hypothesisTests', 'tests')}: {c}</span>)}
              <span style={{ color: 'var(--t3)' }}>→</span>
              {h.decided_ts
                ? <span className="scope-tag">{t('bench.decidedOn', 'decided on')}: {h.decided_on ?? '?'} · {h.decided_ts}</span>
                : <span className="scope-tag">{t('bench.hyp.open', 'no verdict yet')}</span>}
            </div>
            {evid && (
              <p style={{ fontSize: 12, color: 'var(--t2)', margin: '8px 0 0', fontFamily: 'var(--mono)' }}>{evid}</p>
            )}
          </div>

          <ProseBlock title={t('bench.hyp.why', 'Why (rationale)')} text={rationale} />
          <ProseBlock title={t('bench.hyp.how', 'How it is tested (mechanism)')} text={mechanism} />
          <ProseBlock title={t('bench.hyp.verdict', 'What the verdict means (interpretation)')} text={interpretation} />
        </>
      )}
    </div>
  );
}
