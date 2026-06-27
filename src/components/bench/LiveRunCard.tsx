import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHuginnStatus } from '../../hooks/useHuginn';
import { humanizeSeconds, parseHuginnTimestamp } from '../../utils/huginnData';
import { StatusBadge } from './shared';

const POLL_ACTIVE_MS = 4000;
const POLL_COMPLETE_MS = 30000;

function FieldValue({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--t1)', fontFamily: mono ? 'var(--mono)' : undefined }}>{value}</div>
    </div>
  );
}

/**
 * Live progress of the RUNNING benchmark cell — the only file-based source left
 * after the mart switch: results/STATUS.json, rewritten by the orchestrator
 * every few seconds. Polls with keep-last-good semantics.
 */
export function LiveRunCard() {
  const { t } = useTranslation();
  // a finished cell barely changes — drop from 4s to 30s polling on complete
  const [intervalMs, setIntervalMs] = useState(POLL_ACTIVE_MS);
  const [expanded, setExpanded] = useState(false);
  const { status, stale, unavailable } = useHuginnStatus(intervalMs);
  useEffect(() => {
    setIntervalMs(status?.current === 'complete' ? POLL_COMPLETE_MS : POLL_ACTIVE_MS);
  }, [status?.current]);

  if (unavailable) {
    return (
      <div className="analytics-card" data-testid="bench-live-card" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          {t('bench.statusUnavailable', 'Live status unavailable — benchmark repo is not mounted')}
        </span>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="analytics-card" data-testid="bench-live-card" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t('bench.loading', 'Loading…')}</span>
      </div>
    );
  }

  const done = status.done ?? 0;
  const total = status.total ?? 0;
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const isComplete = status.current === 'complete';
  const updatedMs = parseHuginnTimestamp(status.updated);
  const ageSec = updatedMs !== null ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000)) : null;

  // a finished run is context, not news — collapse to a one-line strip and
  // give the first screen back to analytics (expand on click)
  if (isComplete && errors.length === 0 && !expanded) {
    return (
      <div className="analytics-card" data-testid="bench-live-card"
           onClick={() => setExpanded(true)}
           style={{ marginBottom: 12, padding: '8px 14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {t('bench.liveRun', 'Live run')}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t1)' }}>{status.manifest ?? '—'}</span>
        <StatusBadge tone="suc" text={t('bench.complete', 'complete')} />
        {stale && <StatusBadge tone="warn" text={t('bench.stale', 'stale')} />}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>
          {ageSec !== null ? `${humanizeSeconds(ageSec)} ${t('bench.agoSuffix', 'ago')}` : status.updated ?? ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>▸</span>
      </div>
    );
  }

  return (
    <div className="analytics-card" data-testid="bench-live-card" style={{ marginBottom: 12 }}
         onClick={isComplete ? () => setExpanded(false) : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="analytics-card-title" style={{ margin: 0 }}>{t('bench.liveRun', 'Live run')}</span>
        {errors.length > 0
          ? <StatusBadge tone="err" text={`${t('bench.errors', 'Errors')}: ${errors.length}`} />
          : <StatusBadge tone={isComplete ? 'suc' : 'info'}
                         text={isComplete ? t('bench.complete', 'complete') : t('bench.running', 'running')} />}
        {stale && <StatusBadge tone="warn" text={t('bench.stale', 'stale')} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: total > 0 ? `${Math.min(100, (done / total) * 100)}%` : '0%',
            height: '100%', background: 'var(--acc)', transition: 'width .4s ease',
          }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t1)' }}>{done}/{total}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <FieldValue label={t('bench.manifest', 'Manifest')} value={status.manifest ?? '—'} />
        <FieldValue label={t('bench.current', 'Current')} value={status.current ?? '—'} />
        <FieldValue label={t('bench.elapsed', 'Elapsed')}
                    value={status.elapsed_min !== undefined ? `${status.elapsed_min} min` : '—'} />
        <div style={{ minWidth: 150 }}>
          <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            {t('bench.updated', 'Updated')}
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--mono)',
                        color: ageSec !== null && ageSec > 60 ? 'var(--wrn)' : 'var(--t1)' }}>
            {status.updated ?? '—'}
            {ageSec !== null && ` · ${humanizeSeconds(ageSec)} ${t('bench.agoSuffix', 'ago')}`}
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {errors.slice(0, 5).map((e, i) => (
            <span key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--danger)' }}>
              {typeof e === 'string' ? e : JSON.stringify(e)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
