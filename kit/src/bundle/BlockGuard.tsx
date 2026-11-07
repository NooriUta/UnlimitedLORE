// errBlock для одного блока записи (K-08, контракт ядра): исключение в
// overview/tab render ломает только этот блок — остальная запись и список живы.
// Глобальные ошибки (window error) ловит не он, а ErrorBoundary всего mount.
import { Component, type ReactNode } from 'react';
import { LoadError } from '../states';
import { kitT, type KitLang } from '../i18n';

interface Props { block: string; lang: KitLang; children: ReactNode }
interface State { error: unknown }

export class BlockGuard extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('render failed') };
  }

  componentDidUpdate(prev: Props) {
    if (prev.block !== this.props.block && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div data-kit-block={this.props.block} data-state="error" className="sk-mount__block">
          <LoadError compact error={this.state.error} title={kitT(this.props.lang, 'kit.mount.blockFailed')} hint={kitT(this.props.lang, 'kit.mount.blockFailedHint')} />
        </div>
      );
    }
    return <div data-kit-block={this.props.block} className="sk-mount__block">{this.props.children}</div>;
  }
}
