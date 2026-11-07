import { Component, type ErrorInfo, type ReactNode } from 'react';
import { kitT, type KitLang } from '../i18n';
import { describeError as describe, isBenignError } from './errorText';

// Ошибка на экран вместо белого листа (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f).
// Ловит ошибки рендера (getDerivedStateFromError) и то, что React не видит:
// window 'error' (обработчики событий, таймеры) и 'unhandledrejection'.

interface Props {
  children: ReactNode;
  lang?: KitLang;
  /** Слушать window error / unhandledrejection (по умолчанию да). */
  catchGlobal?: boolean;
  onError?: (error: unknown, info?: ErrorInfo) => void;
}

interface State {
  error: unknown;
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidMount() {
    if (this.props.catchGlobal === false || typeof window === 'undefined') return;
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  componentWillUnmount() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  private onWindowError = (e: ErrorEvent) => {
    if (isBenignError(e.message, e.error)) return;
    this.report(e.error ?? e.message ?? '');
  };

  private onRejection = (e: Event) => {
    this.report((e as PromiseRejectionEvent).reason);
  };

  private report(error: unknown) {
    this.props.onError?.(error);
    this.setState({ error, hasError: true });
  }

  private retry = () => this.setState({ error: null, hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    const lang = this.props.lang ?? 'ru';
    return (
      <div role="alert" className="sk-error">
        <h2 className="sk-error__title">{kitT(lang, 'kit.error.title')}</h2>
        <pre className="sk-error__message">{describe(this.state.error)}</pre>
        <button type="button" className="sk-btn" onClick={this.retry}>
          {kitT(lang, 'kit.error.retry')}
        </button>
      </div>
    );
  }
}
