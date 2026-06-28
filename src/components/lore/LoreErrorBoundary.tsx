import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GameIcon } from './GameIcon';

interface Props { children: ReactNode; label?: string; }
interface State { error: Error | null; }

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
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10, padding: 32, color: 'var(--t3)', fontSize: 12,
      }}>
        <GameIcon slug="broken-heart" size={32} />
        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {this.props.label ?? 'Ошибка рендера'}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, maxWidth: 480, textAlign: 'center', color: 'var(--t2)' }}>
          {error.message}
        </span>
        <button
          style={{ marginTop: 8, cursor: 'pointer', fontSize: 11, padding: '4px 12px' }}
          onClick={() => this.setState({ error: null })}
        >
          Повторить
        </button>
      </div>
    );
  }
}
