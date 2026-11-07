// errBlock ≠ «пусто (проверено)» (SPRINT_UXR_S10_SEIDR_KIT/K-06).
//
// Блок экрана (журнал, связи, вкладка записи, overview) отвечает одним из:
//   error      — данные блока не получены: KitMeta.errors[{block, reason}]
//                (block '*' — не проверен ни один), или его render бросил;
//   unverified — 0 записей, но выдача обрезана (truncated) или метаданных нет:
//                проверенным нулём это назвать нельзя;
//   empty      — запрос выполнен, записей нет — «Пусто (проверено)»;
//   ok         — рисуем содержимое, но в своей границе ошибок: исключение в
//                overview/render вкладки ломает ТОЛЬКО этот блок.
// Переиспользуют K-10/K-13; K-04 (запись) может перейти на ErrBlockBoundary.
import { Component, type ReactNode } from 'react';
import type { KitCtx, KitMeta, KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { kitT, useKitLang } from '../i18n';
import { EmptyState, LoadError, STATE_ICONS } from '../states/StateViews';
import { describeError } from './errorText';

export type BlockOutcome =
  | { kind: 'error'; reason: string }
  | { kind: 'unverified' }
  | { kind: 'empty' }
  | { kind: 'ok' };

/** Чем ответил блок: ошибка из meta важнее записей, ноль без полноты — не «пусто». */
export function blockOutcome(meta: KitMeta | null | undefined, block: string, count: number): BlockOutcome {
  const err = meta?.errors?.find((e) => e.block === block || e.block === '*');
  if (err) return { kind: 'error', reason: err.reason };
  if (count > 0) return { kind: 'ok' };
  if (!meta || meta.truncated) return { kind: 'unverified' };
  return { kind: 'empty' };
}

export interface ErrBlockProps {
  /** Имя блока — в data-block (тесты, K-10/K-13 находят блок по нему). */
  block: string;
  /** Подпись для человека; нет — имя блока. */
  label?: string;
  /** Причина из KitMeta.errors. */
  reason?: string;
  /** Исключение render (вместо reason). */
  error?: unknown;
  onRetry?: () => void;
  /** Рендер упал (а не данные не пришли) — другой заголовок. */
  crashed?: boolean;
}

/** «Блок не смогли проверить» — role=alert, data-state=error; не «пусто». */
export function ErrBlock({ block, label, reason, error, onRetry, crashed }: ErrBlockProps) {
  const lang = useKitLang();
  const name = label ?? block;
  const detail = reason ?? (error === undefined ? undefined : describeError(error));
  return (
    <div className="sk-errblock" data-block={block}>
      <LoadError
        compact
        error={detail}
        onRetry={onRetry}
        title={kitT(lang, crashed ? 'kit.block.crashed' : 'kit.block.error', { block: name })}
        hint={kitT(lang, crashed ? 'kit.block.crashed.hint' : 'kit.block.error.hint')}
      />
    </div>
  );
}

/** 0 записей без проверенной полноты: не ошибка и не «пусто». */
export function UnverifiedBlock({ block, label }: { block: string; label?: string }) {
  const lang = useKitLang();
  return (
    <div className="sk-errblock" data-block={block}>
      <div className="sk-state sk-state--unverified sk-state--compact" data-state="unverified">
        <GameIcon slug={STATE_ICONS.truncated} size={16} className="sk-state__icon" />
        <p className="sk-state__title">{kitT(lang, 'kit.block.unverified', { block: label ?? block })}</p>
        <p className="sk-state__hint">{kitT(lang, 'kit.block.unverified.hint')}</p>
      </div>
    </div>
  );
}

interface BoundaryProps {
  block: string;
  label?: string;
  /** Смена ключа (другая запись/вкладка) снимает ошибку. */
  resetKey?: string;
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface BoundaryState { error: unknown; failed: boolean }

/** Граница ошибок одного блока — без глобальных слушателей (они у ErrorBoundary экрана). */
export class ErrBlockBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ error: null, failed: false });
  }

  private retry = () => this.setState({ error: null, failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrBlock
        crashed
        block={this.props.block}
        label={this.props.label}
        error={this.state.error}
        onRetry={this.retry}
      />
    );
  }
}

export interface KitSlotProps {
  render: (r: KitRecord, ctx: KitCtx) => ReactNode | string;
  record: KitRecord;
  ctx: KitCtx;
}

/**
 * Вызов render из конфига (overview, вкладка) внутри React-рендера — чтобы
 * исключение поймала ближайшая ErrBlockBoundary, а не уронило весь экран.
 */
export function KitSlot({ render, record, ctx }: KitSlotProps) {
  return <>{render(record, ctx)}</>;
}

export interface KitBlockProps {
  block: string;
  label?: string;
  meta: KitMeta | null | undefined;
  /** Сколько записей у блока после фильтра. */
  count: number;
  resetKey?: string;
  onRetry?: () => void;
  /** Своё «пусто» (с действием) вместо стандартного. */
  empty?: ReactNode;
  children: ReactNode;
}

/** Блок с честным состоянием: error / unverified / empty / содержимое в своей границе. */
export function KitBlock({ block, label, meta, count, resetKey, onRetry, empty, children }: KitBlockProps) {
  const o = blockOutcome(meta, block, count);
  switch (o.kind) {
    case 'error':
      return <ErrBlock block={block} label={label} reason={o.reason} onRetry={onRetry} />;
    case 'unverified':
      return <UnverifiedBlock block={block} label={label} />;
    case 'empty':
      return <div className="sk-errblock" data-block={block}>{empty ?? <EmptyState compact />}</div>;
    case 'ok':
      return <ErrBlockBoundary block={block} label={label} resetKey={resetKey}>{children}</ErrBlockBoundary>;
  }
}

