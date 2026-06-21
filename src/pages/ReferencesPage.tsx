import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../hooks/usePageTitle';
import { ReferencesScreen } from '../components/bench/RegistryScreens';

/**
 * Standalone bibliography route — kept for deep links (Story epilogue and
 * shared URLs); the content lives in ReferencesScreen, which is also a
 * sidebar tab of the benchmark panel.
 */
export default function ReferencesPage() {
  const { t } = useTranslation();
  usePageTitle(`${t('bench.refs.title', 'Bibliography')} — ${t('bench.title', 'RAG vs Parse — experiment')}`);
  return (
    <div className="page-content bench-scroll" style={{ padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}
         data-testid="references-page">
      <Link to="/benchmark?tab=references" style={{ fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
        {t('bench.sub.back', '← Benchmark panel')}
      </Link>
      <div style={{ marginTop: 10 }}>
        <ReferencesScreen />
      </div>
    </div>
  );
}
