import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GameIcon } from './GameIcon';

interface Props { children: ReactNode; label?: string; }
interface State { error: Error | null; }

function ErrorBoundaryFallback({ label, message, onRetry }: { label?: string; message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 10, padding: 32, color: 'var(--t3)', fontSize: 'var(--fs-base)',
    }}>
      <GameIcon slug="broken-heart" size={32} />
      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
        {label ?? t('lore.errorBoundary.title', 'Ошибка рендера')}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', maxWidth: 480, textAlign: 'center', color: 'var(--t2)' }}>
        {message}
      </span>
      <button
        style={{ marginTop: 8, cursor: 'pointer', fontSize: 'var(--fs-sm)', padding: '4px 12px' }}
        onClick={onRetry}
      >
        {t('lore.errorBoundary.retry', 'Повторить')}
      </button>
    </div>
  );
}

export class LoreErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: Error): State { return { error: e }; }

  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error('[LoreErrorBoundary]', e, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ErrorBoundaryFallback
        label={this.props.label}
        message={error.message}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
