// Вкладка «История» записи (SPRINT_UXR_S5_RECORD_TASKS/S5-11): версии SCD2
// новейшей первой, у каждой — кто правил (человек / агент / автор неизвестен),
// сравнение любой пары версий и возврат старой версии как НОВОЙ версии через
// write-API приложения (source.onRestore). Источник истории приносит экран —
// kit не знает про /lore/*.
//
// Честные состояния: загрузка ≠ ошибка ≠ нет прав ≠ «история не ведётся» ≠
// «правок нет». Возврат — в два касания (кнопка → «Вернуть»), отказ сервера —
// alert с причиной, а не тихий откат.
import { useEffect, useId, useMemo, useState } from 'react';
import type { KitRecord } from '../core/contract';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states/StateViews';
import { errorDetail } from '../states/loadState';
import { kitT, useKitLang, type KitLang } from '../i18n';
import { valueText } from './fmt';
import {
  compareBase, currentVersion, diffVersions, historyAuthor, restoreChanges, versionKey,
  type KitHistory, type KitHistoryVersion, type KitRestoreRequest,
} from './history';

export interface RecordHistorySource {
  state: 'loading' | 'error' | 'forbidden' | 'ok';
  data?: KitHistory;
  error?: unknown;
  onRetry?: () => void;
  /** Поля, которые write-API умеет писать; пусто — возвращать нечем. */
  restorable?: readonly string[];
  /** Записать поля старой версии как новую версию. Нет — запись только для чтения. */
  onRestore?: (req: KitRestoreRequest) => Promise<void>;
}

export interface RecordHistoryProps {
  record: KitRecord;
  source: RecordHistorySource;
  lang?: KitLang;
}

/** Сколько версий показать на ярлыке вкладки (только когда история загружена). */
export function historyCount(source: RecordHistorySource | undefined): number | undefined {
  return source?.state === 'ok' && source.data?.tracking === 'scd2' ? source.data.versions.length : undefined;
}

const at = (v: KitHistoryVersion, lang: KitLang) =>
  v.valid_from ? v.valid_from.replace('T', ' ').slice(0, 16) : kitT(lang, 'kit.record.history.noDate');

function AuthorChip({ v, lang }: { v: KitHistoryVersion; lang: KitLang }) {
  const a = historyAuthor(v.author);
  if (a.kind === 'unknown') {
    return <span className="sk-pill sk-pill--value sk-rec-history__author" data-kind="unknown">{kitT(lang, 'kit.record.history.unknown')}</span>;
  }
  return (
    <span className="sk-rec-history__who">
      <span className="sk-pill sk-pill--value sk-rec-history__author" data-kind={a.kind}>
        {kitT(lang, a.kind === 'agent' ? 'kit.record.history.agent' : 'kit.record.history.human')}
      </span>
      <span className="sk-rec-history__name">{a.name}</span>
      {a.kind === 'agent' && a.owner && (
        <span className="sk-rec-history__owner">{kitT(lang, 'kit.record.history.owner', { who: a.owner })}</span>
      )}
    </span>
  );
}

function Value({ value }: { value: unknown }) {
  return <span className="sk-rec-history__val">{valueText(value)}</span>;
}

type Restore = { phase: 'idle' } | { phase: 'confirm' } | { phase: 'saving' } | { phase: 'done' } | { phase: 'failed'; error: unknown };

function HistoryBody({ record, history, source, lang }: { record: KitRecord; history: KitHistory; source: RecordHistorySource; lang: KitLang }) {
  const versions = history.versions;
  const keys = useMemo(() => versions.map((v, i) => versionKey(v, i)), [versions]);
  const current = currentVersion(versions);
  const currentKey = current ? keys[versions.indexOf(current)] : keys[0];
  const [selected, setSelected] = useState<string>(currentKey);
  const [base, setBase] = useState<string | null>(() => compareBase(versions, currentKey));
  const [restore, setRestore] = useState<Restore>({ phase: 'idle' });
  const compareId = useId();

  // Другой набор версий (перезагрузка после возврата) — выбор снова на текущей.
  const sig = keys.join('|');
  useEffect(() => {
    setSelected(currentKey);
    setBase(compareBase(versions, currentKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- набор версий меняется по ключам, а не по ссылке массива
  }, [sig, currentKey]);

  const pick = (key: string) => {
    setSelected(key);
    setBase(compareBase(versions, key));
    setRestore({ phase: 'idle' });
  };

  const sel = versions[keys.indexOf(selected)] ?? current;
  const baseV = base === null ? null : versions[keys.indexOf(base)] ?? null;
  const diff = sel ? diffVersions(baseV ? baseV.fields : null, sel.fields) : [];
  const plan = sel && current && sel !== current ? restoreChanges(sel, current, source.restorable ?? []) : [];
  const canWrite = Boolean(source.onRestore) && (source.restorable?.length ?? 0) > 0;
  const why = !canWrite ? kitT(lang, 'kit.record.history.restoreReadonly')
    : plan.length === 0 ? kitT(lang, 'kit.record.history.restoreSame') : null;

  const doRestore = async () => {
    if (!sel || !source.onRestore || plan.length === 0) return;
    setRestore({ phase: 'saving' });
    try {
      await source.onRestore({ record_id: record.id, version: sel, changes: plan });
      setRestore({ phase: 'done' });
    } catch (error) {
      setRestore({ phase: 'failed', error });
    }
  };

  const allUnknown = versions.length > 0 && versions.every(v => v.author.kind === 'unknown');
  const page = history.page;

  return (
    <div className="sk-rec-history">
      {allUnknown && <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.history.noAuthors')}</p>}
      {history.warnings.map(w => <p key={`w:${w}`} className="sk-rec-note" role="note">{w}</p>)}
      {history.anomalies.map(a => (
        <p key={`a:${a}`} className="sk-rec-note sk-rec-history__anomaly" role="note">{kitT(lang, 'kit.record.history.anomaly', { code: a })}</p>
      ))}
      {page?.has_more && (
        <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.history.partial', { shown: versions.length, total: page.total })}</p>
      )}

      <ol className="sk-rec-history__list" aria-label={kitT(lang, 'kit.record.history.list')}>
        {versions.map((v, i) => {
          const key = keys[i];
          const author = historyAuthor(v.author).kind;
          return (
            <li key={key} className="sk-rec-history__row" data-testid="kit-history-row" data-author={author}
              data-open={v.is_open ? 'true' : undefined}>
              <button type="button" className="sk-rec-history__pick" aria-pressed={key === selected}
                aria-label={kitT(lang, 'kit.record.history.pick', { at: at(v, lang) })} onClick={() => pick(key)}>
                <time className="sk-rec-history__at" dateTime={v.valid_from ?? undefined}>{at(v, lang)}</time>
                <AuthorChip v={v} lang={lang} />
                {v.status && <span className="sk-pill sk-pill--id">{v.status}</span>}
                {v.is_open && <span className="sk-pill sk-pill--value sk-rec-history__current">{kitT(lang, 'kit.record.history.current')}</span>}
                {v.changed.length > 0 && (
                  <span className="sk-rec-history__changed">{kitT(lang, 'kit.record.history.changed', { fields: v.changed.join(', ') })}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {sel && (
        <section className="sk-rec-history__panel" aria-label={kitT(lang, 'kit.record.history.version', { at: at(sel, lang) })}>
          <div className="sk-rec-history__bar">
            <label className="sk-rec-history__cmp" htmlFor={compareId}>{kitT(lang, 'kit.record.history.compare')}</label>
            <select id={compareId} className="sk-rec-history__select" value={base ?? ''}
              onChange={e => setBase(e.target.value === '' ? null : e.target.value)}>
              <option value="">{kitT(lang, 'kit.record.history.compareNone')}</option>
              {versions.map((v, i) => keys[i] === selected ? null : (
                <option key={keys[i]} value={keys[i]}>{at(v, lang)}{v.is_open ? ` · ${kitT(lang, 'kit.record.history.current')}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="sk-rec-history__diff" data-testid="kit-history-diff">
            {diff.length === 0
              ? <p className="sk-rec-history__same">{kitT(lang, 'kit.record.history.same')}</p>
              : (
                <dl className="sk-rec-history__fields">
                  {diff.map(d => (
                    <div key={d.field} className="sk-rec-history__drow" data-testid="kit-history-diff-row" data-field={d.field} data-change={d.change}>
                      <dt><code className="sk-rec-history__field">{d.field}</code></dt>
                      <dd className="sk-rec-history__change">
                        <del className="sk-rec-history__from"><Value value={d.from} /></del>
                        <ins className="sk-rec-history__to"><Value value={d.to} /></ins>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
          </div>

          {current && sel !== current && (
            <div className="sk-rec-history__restore">
              {restore.phase === 'confirm' || restore.phase === 'saving' ? (
                <div className="sk-rec-history__confirm" data-testid="kit-history-confirm" aria-busy={restore.phase === 'saving'}>
                  <p>{kitT(lang, 'kit.record.history.restoreConfirm', { count: plan.length })}</p>
                  <button type="button" className="sk-btn sk-rec-history__go" disabled={restore.phase === 'saving'} onClick={() => void doRestore()}>
                    {kitT(lang, 'kit.record.history.restoreGo')}
                  </button>
                  <button type="button" className="sk-btn" disabled={restore.phase === 'saving'} onClick={() => setRestore({ phase: 'idle' })}>
                    {kitT(lang, 'kit.record.history.cancel')}
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="sk-btn" disabled={why !== null}
                    aria-describedby={why ? `${compareId}-why` : undefined} onClick={() => setRestore({ phase: 'confirm' })}>
                    {kitT(lang, 'kit.record.history.restore')}
                  </button>
                  {why && <span id={`${compareId}-why`} className="sk-rec-history__why" data-testid="kit-history-restore-why">{why}</span>}
                </>
              )}
              {restore.phase === 'done' && <p className="sk-rec-history__ok" role="status">{kitT(lang, 'kit.record.history.restored')}</p>}
              {restore.phase === 'failed' && (
                <p className="sk-rec-history__fail" role="alert">
                  {kitT(lang, 'kit.record.history.restoreFailed')}
                  {errorDetail(restore.error) ? `: ${errorDetail(restore.error)}` : ''}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function RecordHistory({ record, source, lang: langProp }: RecordHistoryProps) {
  const ctxLang = useKitLang();
  const lang = langProp ?? ctxLang;
  if (source.state === 'loading') return <Skeleton lines={4} />;
  if (source.state === 'error') {
    return <LoadError compact title={kitT(lang, 'kit.record.history.failed')} error={source.error} onRetry={source.onRetry} />;
  }
  if (source.state === 'forbidden') {
    return <Forbidden compact reason={source.error === undefined ? undefined : errorDetail(source.error) || undefined} />;
  }
  const history = source.data;
  if (!history) return <LoadError compact title={kitT(lang, 'kit.record.history.failed')} onRetry={source.onRetry} />;
  if (history.tracking === 'not_tracked') {
    return <EmptyState compact title={kitT(lang, 'kit.record.history.notTracked')} hint={kitT(lang, 'kit.record.history.notTrackedHint')} />;
  }
  if (history.versions.length === 0) {
    return <EmptyState compact title={kitT(lang, 'kit.record.history.empty')} hint={kitT(lang, 'kit.record.history.emptyHint')} />;
  }
  return <HistoryBody key={record.id} record={record} history={history} source={source} lang={lang} />;
}
