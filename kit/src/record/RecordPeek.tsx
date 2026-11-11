// Peek записи (SPRINT_UXR_S5_RECORD_TASKS/S5-12): быстрый просмотр справа —
// главное записи (задачи, затем текст) и кнопка «Читать целиком», которая ведёт
// в режим чтения (S5-04/S5-05). Куда именно ведёт — решает экран: onReadFull
// и/или readHref (тогда кнопка — ссылка, её можно открыть в новой вкладке).
//
// Задачи — записи, входящие в эту ребром одного из taskEdges (у LORE —
// IN_SPRINT). Нет taskEdges — блока задач нет (peek задачи — только текст).
// Честные состояния: упавший блок рёбер — ошибка, а не «задач нет»; обрезанная
// выборка — пометка; ноль задач — проверенный ноль.
// Открытый peek живёт в URL (?peek=<id>, useRecordPeek), как и вкладка записи.
import { useCallback } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { Drawer } from '../shell/Sheet';
import { EmptyState, LoadError } from '../states/StateViews';
import { useUrlParam } from '../resilience/useUrlParam';
import { kitT, useKitLang, type KitLang } from '../i18n';
import { blockError } from './RecordLinks';
import { StatusPill, findRecord } from './fmt';

export const PEEK_PARAM = 'peek';
const DEFAULT_TASK_LIMIT = 8;

export interface PeekTask { id: string; record?: KitRecord }

/** Задачи записи: входящие рёбра типов taskEdges, порядок рёбер, без дублей. */
export function peekTasks(id: string, ctx: KitCtx, taskEdges: readonly string[]): PeekTask[] {
  const types = new Set(taskEdges);
  const seen = new Set<string>();
  const out: PeekTask[] = [];
  for (const e of ctx.data.edges) {
    if (e.to !== id || !types.has(e.type) || seen.has(e.from)) continue;
    seen.add(e.from);
    out.push({ id: e.from, record: findRecord(ctx, e.from) });
  }
  return out;
}

/** Открытый peek в URL: [id | null, открыть, закрыть]. */
export function useRecordPeek(): [string | null, (id: string) => void, () => void] {
  const [value, set] = useUrlParam(PEEK_PARAM);
  const open = useCallback((id: string) => set(id), [set]);
  const close = useCallback(() => set(null), [set]);
  return [value || null, open, close];
}

export interface RecordPeekProps {
  /** Запись в peek; null — peek закрыт. */
  record: KitRecord | null;
  ctx: KitCtx;
  onClose: () => void;
  /** «Читать целиком» — перейти в режим чтения записи (S5-04/S5-05). */
  onReadFull: (id: string) => void;
  /** URL режима чтения: кнопка становится ссылкой (клик всё равно зовёт onReadFull). */
  readHref?: (id: string) => string;
  /** Типы рёбер «задача → запись» (у LORE — IN_SPRINT). Нет — блока задач нет. */
  taskEdges?: readonly string[];
  /** Сколько задач показать; остальные — «ещё N — в полном чтении». */
  taskLimit?: number;
}

function isDone(ctx: KitCtx, code: string | undefined): boolean {
  return ctx.config.statuses.items.find(s => s.code === code)?.category === 'done';
}

function PeekTasks({ record, ctx, lang, taskEdges, limit }: {
  record: KitRecord; ctx: KitCtx; lang: KitLang; taskEdges: readonly string[]; limit: number;
}) {
  const failed = blockError(ctx, 'edges');
  const tasks = failed === undefined ? peekTasks(record.id, ctx, taskEdges) : [];
  const done = tasks.filter(t => isDone(ctx, t.record?.status)).length;
  const shown = tasks.slice(0, Math.max(0, limit));
  const rest = tasks.length - shown.length;
  return (
    <section className="sk-peek__tasks" data-testid="kit-peek-tasks" aria-label={kitT(lang, 'kit.peek.tasks')}>
      <h3 className="sk-peek__h">
        <span>{kitT(lang, 'kit.peek.tasks')}</span>
        {failed === undefined && tasks.length > 0 && (
          <span className="sk-peek__count">{kitT(lang, 'kit.peek.tasks.progress', { done, total: tasks.length })}</span>
        )}
      </h3>
      {failed !== undefined && <LoadError compact title={kitT(lang, 'kit.peek.tasks.failed')} error={failed} />}
      {failed === undefined && tasks.length === 0 && (
        <EmptyState compact title={kitT(lang, 'kit.peek.tasks.empty')} hint={kitT(lang, 'kit.peek.tasks.emptyHint')} />
      )}
      {failed === undefined && ctx.data.meta.truncated && (
        <p className="sk-rec-note" role="note">{kitT(lang, 'kit.peek.tasks.truncated')}</p>
      )}
      {shown.length > 0 && (
        <ul className="sk-peek__list">
          {shown.map(t => (
            <li key={t.id} className="sk-peek__task" data-testid="kit-peek-task" data-missing={t.record ? undefined : 'true'}>
              {t.record
                ? <StatusPill code={t.record.status} kind={t.record.kind} ctx={ctx} unknownTitle={kitT(lang, 'kit.record.status.unknown')} />
                : <span className="sk-peek__missing">{kitT(lang, 'kit.record.links.missing')}</span>}
              <a className="sk-rec-ref sk-peek__ref" href={ctx.href(t.id)}>
                <span>{t.record ? t.record.title : t.id}</span>
              </a>
              {t.record && <span className="sk-pill sk-pill--id">{t.id}</span>}
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="sk-peek__more">{kitT(lang, 'kit.peek.tasks.more', { n: rest })}</p>}
    </section>
  );
}

export function RecordPeek({ record, ctx, onClose, onReadFull, readHref, taskEdges, taskLimit = DEFAULT_TASK_LIMIT }: RecordPeekProps) {
  const lang = useKitLang();
  if (!record) return null;
  const label = kitT(lang, 'kit.peek.readFull');
  const read = () => onReadFull(record.id);
  const readAction = readHref
    ? (
      <a className="sk-btn sk-peek__read" href={readHref(record.id)} onClick={e => {
        // Обычный клик — переход экраном; Ctrl/⌘/средняя — браузеру (новая вкладка).
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        read();
      }}>{label}</a>
    )
    : <button type="button" className="sk-btn sk-peek__read" onClick={read}>{label}</button>;
  return (
    <Drawer open title={record.title} onClose={onClose} actions={readAction} className="sk-peek">
      <div className="sk-peek__meta">
        <span className="sk-pill sk-pill--id">{record.id}</span>
        <StatusPill code={record.status} kind={record.kind} ctx={ctx} unknownTitle={kitT(lang, 'kit.record.status.unknown')} />
      </div>
      {taskEdges && taskEdges.length > 0 && (
        <PeekTasks record={record} ctx={ctx} lang={lang} taskEdges={taskEdges} limit={taskLimit} />
      )}
      <section className="sk-peek__text" data-testid="kit-peek-text" aria-label={kitT(lang, 'kit.peek.text')}>
        <h3 className="sk-peek__h"><span>{kitT(lang, 'kit.peek.text')}</span></h3>
        {record.body_md?.trim()
          ? <div className="sk-peek__body">{ctx.md(record.body_md)}</div>
          : <EmptyState compact title={kitT(lang, 'kit.record.body.empty')} hint={kitT(lang, 'kit.record.body.emptyHint')} />}
      </section>
    </Drawer>
  );
}
