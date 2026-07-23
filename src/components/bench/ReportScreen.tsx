import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { muninnFileUrl } from '../../api/muninn';
import { ScreenTitle } from './shared';

const REPORT_PATH = 'docs/RAG_VS_PARSE_EXPERIMENT.html';

/**
 * Screen — static experiment report embedded read-only (iframe) until the
 * page's data-islands are generated from the mart. sandbox without
 * allow-same-origin isolates the report's inline JS from app cookies/DOM.
 */
export function ReportScreen() {
  const { t } = useTranslation();
  const url = muninnFileUrl(REPORT_PATH);
  return (
    <div data-testid="bench-report">
      <ScreenTitle text={t('bench.secReport', 'Static experiment report (v0.9)')} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
          {t('bench.reportHint', 'Static page docs/RAG_VS_PARSE_EXPERIMENT.html embedded read-only')}
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-ghost"
           style={{ textDecoration: 'none' }}>
          <ExternalLink size={13} />
          {t('bench.openReport', 'Open in a new tab')}
        </a>
      </div>
      <iframe
        src={url}
        title="RAG vs Parse experiment report"
        sandbox="allow-scripts"
        style={{ width: '100%', height: '75vh', border: '1px solid var(--bd)',
                 borderRadius: 8, background: '#0f1115' }}
      />
    </div>
  );
}
