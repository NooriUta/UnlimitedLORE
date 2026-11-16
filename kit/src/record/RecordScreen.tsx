// Рамка экрана записи (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 4: экран «список + паспорт»
// переезжает в kit по частям). Перенесено из web-next ListPassport — дерево состояний одно на
// любое приложение:
//   сборщик предупреждений → оговорки модели → полоса над записью → тело.
// MP2-09/10: полоса есть в ЛЮБОМ состоянии (загрузка, сбой, чтение) и стоит на одном месте дерева —
// React сохраняет её узлы, фокус и раскрытое меню, паспорт не «скачет» между состояниями.
// «Записи нет» (404) — ответ сервера, а не сбой загрузки: без «Повторить» (находка preprod 14.11).
import type { ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { EmptyState, LoadError, Skeleton } from '../states/StateViews';
import { RecordModelNotes } from './ModelNotes';
import { RecordBar } from './RecordReader';
import { WarningsProvider } from './warnings';

export type RecordScreenState =
  | { kind: 'loading' }
  | { kind: 'notFound'; id: string }
  | { kind: 'error'; error: unknown; onRetry?: () => void }
  | { kind: 'ready' };

export interface RecordScreenProps {
  state: RecordScreenState;
  /** Полоса над записью: крошки, листалка, инструменты (место, закрыть). */
  bar: { crumbs?: ReactNode; pager?: ReactNode; tools?: ReactNode };
  /** Оговорки разбора модели — в общий значок «⚠ N». */
  notes?: string[];
  /** Тело при state.kind === 'ready'. */
  children?: ReactNode;
}

export function RecordScreen({ state, bar, notes = [], children }: RecordScreenProps) {
  const lang = useKitLang();
  let body: ReactNode;
  if (state.kind === 'loading') body = <Skeleton lines={8} label={kitT(lang, 'kit.record.screen.loading')} />;
  else if (state.kind === 'notFound') body = <EmptyState title={kitT(lang, 'kit.record.screen.notFound', { id: state.id })} hint={kitT(lang, 'kit.record.screen.notFoundHint', { id: state.id })} />;
  else if (state.kind === 'error') body = <LoadError error={state.error} onRetry={state.onRetry} />;
  else body = children;
  return (
    <WarningsProvider>
      <RecordModelNotes notes={notes} />
      <RecordBar crumbs={bar.crumbs} pager={bar.pager} tools={bar.tools} />
      {body}
    </WarningsProvider>
  );
}
