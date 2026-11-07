// Честные состояния (S4-00c): Skeleton, EmptyState, LoadError, Forbidden.
// «Пусто» ≠ «ошибка» ≠ «нет прав»: у каждого свой текст, свой тон (токен),
// своя иконка и data-state — экран и тест отличают их не по догадке.
// Ошибка — role=alert (её надо услышать сразу), загрузка — role=status,
// пусто и нет прав — обычный текст: это ответ, а не тревога.
import type { ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { kitT, useKitLang } from '../i18n';
import { errorDetail } from './loadState';

/** Иконки состояний — слаги game-icons (проверяются тестом на наличие в наборе). */
export const STATE_ICONS = {
  empty: 'empty-hourglass',
  error: 'unplugged',
  forbidden: 'padlock',
  truncated: 'scissors',
} as const satisfies Record<string, string>;

export interface SkeletonProps {
  /** Сколько полосок-строк показать. */
  lines?: number;
  /** Подпись для чтения (по умолчанию «Загрузка…»). */
  label?: string;
  className?: string;
}

export function Skeleton({ lines = 3, label, className }: SkeletonProps) {
  const lang = useKitLang();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-state="loading"
      className={['sk-skel', className].filter(Boolean).join(' ')}
    >
      <span className="sk-sr">{label ?? kitT(lang, 'kit.state.loading')}</span>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span key={i} className="sk-skel__line" aria-hidden="true" />
      ))}
    </div>
  );
}

interface BoxProps {
  kind: 'empty' | 'error' | 'forbidden';
  icon: string;
  title: string;
  hint?: ReactNode;
  detail?: string;
  action?: ReactNode;
  role?: 'alert';
  compact?: boolean;
  className?: string;
}

function StateBox({ kind, icon, title, hint, detail, action, role, compact, className }: BoxProps) {
  const cls = ['sk-state', `sk-state--${kind}`, compact ? 'sk-state--compact' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} data-state={kind} role={role}>
      <GameIcon slug={icon} size={compact ? 16 : 24} className="sk-state__icon" />
      <p className="sk-state__title">{title}</p>
      {hint && <p className="sk-state__hint">{hint}</p>}
      {detail && <code className="sk-state__detail">{detail}</code>}
      {action && <div className="sk-state__action">{action}</div>}
    </div>
  );
}

export interface StateTextProps {
  title?: string;
  hint?: ReactNode;
  /** Действие: «Сбросить фильтр», «Создать»… */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** Проверенный ноль: запрос выполнен, записей нет. */
export function EmptyState({ title, hint, action, compact, className }: StateTextProps) {
  const lang = useKitLang();
  return (
    <StateBox
      kind="empty"
      icon={STATE_ICONS.empty}
      title={title ?? kitT(lang, 'kit.state.empty.title')}
      hint={hint ?? kitT(lang, 'kit.state.empty.hint')}
      action={action}
      compact={compact}
      className={className}
    />
  );
}

export interface LoadErrorProps extends StateTextProps {
  error?: unknown;
  /** Есть — кнопка «Повторить»; нет — кнопки нет (не обещаем того, чего нет). */
  onRetry?: () => void;
}

/** Данные не получены — это не «пусто». */
export function LoadError({ error, onRetry, title, hint, action, compact, className }: LoadErrorProps) {
  const lang = useKitLang();
  const detail = error === undefined ? '' : errorDetail(error);
  return (
    <StateBox
      kind="error"
      role="alert"
      icon={STATE_ICONS.error}
      title={title ?? kitT(lang, 'kit.state.error.title')}
      hint={hint ?? kitT(lang, 'kit.state.error.hint')}
      detail={detail || undefined}
      action={action ?? (onRetry ? (
        <button type="button" className="sk-btn" onClick={onRetry}>{kitT(lang, 'kit.state.error.retry')}</button>
      ) : undefined)}
      compact={compact}
      className={className}
    />
  );
}

export interface ForbiddenProps extends StateTextProps {
  /** Причина с бэкенда (outside_scope.reason и т.п.). */
  reason?: string;
}

/** Нет прав — данные скрыты, а не отсутствуют. */
export function Forbidden({ reason, title, hint, action, compact, className }: ForbiddenProps) {
  const lang = useKitLang();
  return (
    <StateBox
      kind="forbidden"
      icon={STATE_ICONS.forbidden}
      title={title ?? kitT(lang, 'kit.state.forbidden.title')}
      hint={hint ?? kitT(lang, 'kit.state.forbidden.hint')}
      detail={reason}
      action={action}
      compact={compact}
      className={className}
    />
  );
}
