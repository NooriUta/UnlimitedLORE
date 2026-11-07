// errBlock (SPRINT_UXR_S10_SEIDR_KIT/K-04, контракт ядра): исключение в
// overview/render вкладки/вердикте конфига ломает ТОЛЬКО свой блок — на его
// месте компактная ошибка с текстом исключения, остальная запись работает.
// В отличие от ErrorBoundary экрана (S4-00f) — без глобальных слушателей.
import { Component, type ReactNode } from 'react';
import { LoadError } from '../states/StateViews';
import { kitT, type KitLang } from '../i18n';

interface Props {
  /** Имя блока — в data-block и в заголовке ошибки. */
  block: string;
  /** Подпись блока для человека; нет — имя блока. */
  label?: string;
  lang: KitLang;
  /** Смена ключа (другая запись) сбрасывает ошибку. */
  resetKey?: string;
  children: ReactNode;
}

interface State { error: unknown; failed: boolean }

export class BlockBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ error: null, failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { block, label, lang } = this.props;
    const err = this.state.error;
    return (
      <div className="sk-rec-err" data-block={block}>
        <LoadError
          compact
          error={err instanceof Error || typeof err === 'string' ? err : String(err)}
          title={kitT(lang, 'kit.record.blockError', { block: label ?? block })}
          hint={kitT(lang, 'kit.record.blockError.hint')}
        />
      </div>
    );
  }
}
