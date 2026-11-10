// Вкладка «История» записи (SPRINT_UXR_S5_RECORD_TASKS/S5-11): версии SCD2
// новейшей первой, у каждой — кто правил (человек / агент / автор неизвестен),
// сравнение любой пары версий и возврат старой версии как НОВОЙ версии через
// write-API приложения (source.onRestore). Источник истории приносит экран —
// kit не знает про /lore/*.
//
// S9-09 (клиентская половина): фильтры и свёртка стали ОРГАНАМИ УПРАВЛЕНИЯ.
// Сервер принимает `author_kind`, `author`, `field` и `collapse=agent` давно,
// но вкладка их не показывала — параметр, который мы шлём, но не даём выбрать,
// это не возможность. Теперь запрос живёт в source.query, меняется через
// source.onQuery, а свёрнутая серия говорит, сколько в ней правок, и
// раскрывается (source.onExpand).
//
// Честные состояния: загрузка ≠ ошибка ≠ нет прав ≠ «история не ведётся» ≠
// «правок нет» ≠ «ничего не нашлось по фильтру». Возврат — в два касания
// (кнопка → «Вернуть»), отказ сервера — alert с причиной, а не тихий откат.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KitRecord } from '../core/contract';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states/StateViews';
import { errorDetail } from '../states/loadState';
import { describeError } from '../resilience/errorText';
import { kitT, useKitLang, type KitLang } from '../i18n';
import { valueText } from './fmt';
import {
  authorOptions, collapsedView, compareBase, currentVersion, diffVersions, historyAuthor, narrowed,
  restoreChanges, versionKey,
  type KitHistory, type KitHistoryAuthorOption, type KitHistoryQuery, type KitHistoryVersion,
  type KitRestoreRequest,
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
  /**
   * Догрузить следующую страницу истории (S9-09). Нет — кнопки «Показать
   * ещё» не будет: обещать кнопкой то, чего приложение не умеет, нельзя.
   * Сказать «показано N из M» и не дать посмотреть дальше — половина правды.
   */
  onMore?: () => void;
  /** Идёт догрузка: кнопка занята и второй раз не зовётся. */
  loadingMore?: boolean;
  /** Догрузка не удалась: причина словами, показанные версии остаются. */
  moreError?: unknown;
  /** Чем сейчас сужена и свёрнута выдача — то, что приложение спросило у сервера. */
  query?: KitHistoryQuery;
  /**
   * Сменить запрос. Нет — фильтров и переключателя свёртки не будет: показать
   * орган управления, которого экран не применит, значит соврать.
   */
  onQuery?: (q: KitHistoryQuery) => void;
  /**
   * Все авторы, которых приложение уже видело в этой истории. Нужны, чтобы
   * выбранный фильтр не съедал остальные варианты: выдача сужается до одного
   * автора, и переключиться на другого стало бы нечем. Нет — варианты берутся
   * из загруженных версий.
   */
  authors?: readonly KitHistoryAuthorOption[];
  /**
   * Развернуть свёрнутую серию: отдать её правки по одной. Нет — кнопки
   * разворота не будет, а серия скажет словами, как увидеть правки.
   */
  onExpand?: (v: KitHistoryVersion) => Promise<readonly KitHistoryVersion[]>;
}

export interface RecordHistoryProps {
  record: KitRecord;
  source: RecordHistorySource;
  lang?: KitLang;
}

/**
 * Сколько версий показать на ярлыке вкладки (только когда история загружена).
 * Сервер посчитал всю цепочку — берём его число: ярлык говорит о всей истории,
 * а не о загруженной странице. Не посчитал (page нет) — говорим о загруженном,
 * а не выдумываем.
 */
export function historyCount(source: RecordHistorySource | undefined): number | undefined {
  if (source?.state !== 'ok' || source.data?.tracking !== 'scd2') return undefined;
  return source.data.page?.total ?? source.data.versions.length;
}

const at = (v: KitHistoryVersion, lang: KitLang) =>
  v.valid_from ? v.valid_from.replace('T', ' ').slice(0, 16) : kitT(lang, 'kit.record.history.noDate');

const stamp = (iso: string | null, lang: KitLang) =>
  iso ? iso.replace('T', ' ').slice(0, 16) : kitT(lang, 'kit.record.history.noDate');

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

/**
 * Фильтры выдачи: вид автора, конкретный автор, что менялось, свёртка серий.
 * Вид автора и автор уходят ОДНИМ запросом — на сервере это условие «И».
 * Свёртка стоит здесь же, но сужением не считается: правки те же, строк меньше.
 */
function Filters({ q, authors, collapsed, onQuery, lang }: {
  q: KitHistoryQuery;
  authors: readonly KitHistoryAuthorOption[];
  collapsed: boolean;
  onQuery: (q: KitHistoryQuery) => void;
  lang: KitLang;
}) {
  const id = useId();
  const set = (patch: Partial<KitHistoryQuery>) => onQuery({ ...q, ...patch });
  return (
    <div className="sk-rec-history__filters" role="group" aria-label={kitT(lang, 'kit.record.history.filters')}>
      <label className="sk-rec-history__cmp" htmlFor={`${id}-kind`}>{kitT(lang, 'kit.record.history.fKind')}</label>
      <select id={`${id}-kind`} className="sk-rec-history__select" value={q.authorKind ?? ''}
        onChange={e => set({ authorKind: e.target.value === '' ? null : e.target.value as 'human' | 'agent' })}>
        <option value="">{kitT(lang, 'kit.record.history.fKindAll')}</option>
        <option value="human">{kitT(lang, 'kit.record.history.human')}</option>
        <option value="agent">{kitT(lang, 'kit.record.history.agent')}</option>
      </select>

      <label className="sk-rec-history__cmp" htmlFor={`${id}-author`}>{kitT(lang, 'kit.record.history.fAuthor')}</label>
      <select id={`${id}-author`} className="sk-rec-history__select" value={q.author ?? ''}
        onChange={e => set({ author: e.target.value === '' ? null : e.target.value })}>
        <option value="">{kitT(lang, 'kit.record.history.fAuthorAll')}</option>
        {authors.map(a => (
          <option key={a.caller} value={a.caller}>
            {kitT(lang, 'kit.record.history.authorOption', { caller: a.caller, count: a.count })}
          </option>
        ))}
      </select>

      <label className="sk-rec-history__cmp" htmlFor={`${id}-field`}>{kitT(lang, 'kit.record.history.fField')}</label>
      <select id={`${id}-field`} className="sk-rec-history__select" value={q.field ?? ''}
        onChange={e => set({ field: e.target.value === '' ? null : e.target.value as 'status' | 'content' })}>
        <option value="">{kitT(lang, 'kit.record.history.fFieldAll')}</option>
        <option value="status">{kitT(lang, 'kit.record.history.fFieldStatus')}</option>
        <option value="content">{kitT(lang, 'kit.record.history.fFieldContent')}</option>
      </select>

      <label className="sk-rec-history__toggle" htmlFor={`${id}-collapse`}>
        <input id={`${id}-collapse`} type="checkbox" checked={collapsed}
          onChange={e => set({ collapse: e.target.checked })} />
        {kitT(lang, 'kit.record.history.fCollapse')}
      </label>

      {narrowed(q) && (
        <button type="button" className="sk-btn sk-rec-history__reset"
          onClick={() => onQuery({ authorKind: null, author: null, field: null, collapse: q.collapse })}>
          {kitT(lang, 'kit.record.history.fReset')}
        </button>
      )}
    </div>
  );
}

type Restore = { phase: 'idle' } | { phase: 'confirm' } | { phase: 'saving' } | { phase: 'done' } | { phase: 'failed'; error: unknown };

/** Разворот свёрнутой серии: ещё не трогали / грузится / открыта / не вышло. */
type RunState =
  | { phase: 'busy' }
  | { phase: 'open'; rows: readonly KitHistoryVersion[] }
  | { phase: 'shut'; rows: readonly KitHistoryVersion[] }
  | { phase: 'failed'; error: unknown };

function HistoryBody({ record, history, source, lang }: { record: KitRecord; history: KitHistory; source: RecordHistorySource; lang: KitLang }) {
  const versions = history.versions;
  const keys = useMemo(() => versions.map((v, i) => versionKey(v, i)), [versions]);
  const current = currentVersion(versions);
  const currentKey = current ? keys[versions.indexOf(current)] : keys[0];
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selected, setSelected] = useState<string>(currentKey);
  const [base, setBase] = useState<string | null>(() => compareBase(versions, currentKey));
  const [restore, setRestore] = useState<Restore>({ phase: 'idle' });
  const compareId = useId();

  // Что человек ВИДИТ в списке: строки выдачи и правки развёрнутых серий.
  // Сравнивать и возвращать можно любую из них, а не только строку верхнего
  // уровня: иначе развёрнутая серия была бы картинкой, а не историей.
  const pool = useMemo(() => {
    const out: { key: string; v: KitHistoryVersion }[] = [];
    versions.forEach((v, i) => {
      const key = keys[i];
      out.push({ key, v });
      const st = runs[key];
      if (st?.phase === 'open') st.rows.forEach((c, j) => out.push({ key: c.state_uid ?? `${key}~${j}`, v: c }));
    });
    return out;
  }, [versions, keys, runs]);

  // Другой набор версий (перезагрузка после возврата или смена фильтра) —
  // выбор снова на текущей. Сброс — только при НАСТОЯЩЕЙ смене набора. На
  // монтировании выбор уже стоит на текущей (useState): эффект там лишний и
  // опасен — если щелчок по старой версии успел раньше пассивного эффекта
  // (медленный CI), эффект затирал выбор пользователя («Вернуть как новую
  // версию» пропадала).
  const sig = keys.join('|');
  const seenSig = useRef(sig);
  useEffect(() => {
    if (seenSig.current === sig) return;
    seenSig.current = sig;
    setSelected(currentKey);
    setBase(compareBase(versions, currentKey));
    setRuns({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- набор версий меняется по ключам, а не по ссылке массива
  }, [sig, currentKey]);

  /** Следующая более старая строка ИЗ ВИДИМОГО списка; у самой старой — ничего. */
  const nextOlder = (key: string) => {
    const i = pool.findIndex(p => p.key === key);
    return i >= 0 && i + 1 < pool.length ? pool[i + 1].key : null;
  };

  const pick = (key: string) => {
    setSelected(key);
    setBase(nextOlder(key));
    setRestore({ phase: 'idle' });
  };

  const expand = async (key: string, v: KitHistoryVersion) => {
    const st = runs[key];
    if (st?.phase === 'busy') return;
    if (st?.phase === 'open') { setRuns(r => ({ ...r, [key]: { phase: 'shut', rows: st.rows } })); return; }
    if (st?.phase === 'shut') { setRuns(r => ({ ...r, [key]: { phase: 'open', rows: st.rows } })); return; }
    if (!source.onExpand) return;
    setRuns(r => ({ ...r, [key]: { phase: 'busy' } }));
    try {
      const rows = await source.onExpand(v);
      setRuns(r => ({ ...r, [key]: { phase: 'open', rows } }));
    } catch (error) {
      setRuns(r => ({ ...r, [key]: { phase: 'failed', error } }));
    }
  };

  const sel = pool.find(p => p.key === selected)?.v ?? current;
  const baseV = base === null ? null : pool.find(p => p.key === base)?.v ?? null;
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
  const query = source.query;
  const collapsed = collapsedView(page, query);
  // Варианты автора: все, кого приложение помнит, иначе — авторы загруженного.
  const authors = source.authors ?? authorOptions(versions);
  const filters = source.onQuery && query
    ? <Filters q={query} authors={authors} collapsed={collapsed} onQuery={source.onQuery} lang={lang} />
    : null;

  /** Строка списка: когда, кто, статус, что изменилось. */
  const rowFace = (v: KitHistoryVersion) => (
    <>
      <time className="sk-rec-history__at" dateTime={v.valid_from ?? undefined}>{at(v, lang)}</time>
      <AuthorChip v={v} lang={lang} />
      {v.status && <span className="sk-pill sk-pill--id">{v.status}</span>}
      {v.is_open && <span className="sk-pill sk-pill--value sk-rec-history__current">{kitT(lang, 'kit.record.history.current')}</span>}
      {v.changed.length > 0 && (
        <span className="sk-rec-history__changed">{kitT(lang, 'kit.record.history.changed', { fields: v.changed.join(', ') })}</span>
      )}
    </>
  );

  return (
    <div className="sk-rec-history">
      {filters}
      {filters && authors.length > 0 && (
        <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.history.fAuthorsHint')}</p>
      )}
      {allUnknown && <p className="sk-rec-note" role="note">{kitT(lang, 'kit.record.history.noAuthors')}</p>}
      {history.warnings.map(w => <p key={`w:${w}`} className="sk-rec-note" role="note">{w}</p>)}
      {history.anomalies.map(a => (
        <p key={`a:${a}`} className="sk-rec-note sk-rec-history__anomaly" role="note">{kitT(lang, 'kit.record.history.anomaly', { code: a })}</p>
      ))}
      {page?.has_more && (
        <p className="sk-rec-note" role="note">
          {/* Со свёрткой «показано N из M» — про СТРОКИ, которые видит человек:
              сервер и считает их по свёрнутым, а не по сырым версиям. */}
          {kitT(lang, collapsed ? 'kit.record.history.partialRows' : 'kit.record.history.partial',
            { shown: versions.length, total: page.total })}
          {source.onMore && (
            <button
              type="button"
              className="sk-btn sk-rec-history__more"
              disabled={source.loadingMore}
              onClick={() => { if (!source.loadingMore) source.onMore?.(); }}
            >
              {kitT(lang, source.loadingMore ? 'kit.record.history.moreBusy' : 'kit.record.history.more')}
            </button>
          )}
        </p>
      )}
      {source.moreError !== undefined && (
        <p className="sk-rec-note sk-rec-history__morefail" role="alert">
          {kitT(lang, 'kit.record.history.moreFailed', { reason: describeError(source.moreError) })}
        </p>
      )}

      {versions.length === 0 ? (
        // Сузили фильтром — так и говорим. «Ничего не нашлось по фильтру» ≠
        // «правок нет»: второе — проверенный ноль, и подавать первое под его
        // видом значит соврать. Фильтры при этом остаются на экране, иначе
        // снять их нечем.
        narrowed(query)
          ? <EmptyState compact title={kitT(lang, 'kit.record.history.emptyFiltered')} hint={kitT(lang, 'kit.record.history.emptyFilteredHint')} />
          : <EmptyState compact title={kitT(lang, 'kit.record.history.empty')} hint={kitT(lang, 'kit.record.history.emptyHint')} />
      ) : (
        <ol className="sk-rec-history__list" aria-label={kitT(lang, 'kit.record.history.list')}>
          {versions.map((v, i) => {
            const key = keys[i];
            const author = historyAuthor(v.author).kind;
            const run = v.collapsed ?? null;
            const st = runs[key];
            const open = st?.phase === 'open';
            return (
              <li key={key} className="sk-rec-history__row" data-testid="kit-history-row" data-author={author}
                data-open={v.is_open ? 'true' : undefined} data-run={run ? String(run.count) : undefined}>
                <button type="button" className="sk-rec-history__pick" aria-pressed={key === selected}
                  aria-label={kitT(lang, 'kit.record.history.pick', { at: at(v, lang) })} onClick={() => pick(key)}>
                  {rowFace(v)}
                </button>
                {run && (
                  <div className="sk-rec-history__run">
                    <span className="sk-pill sk-pill--value sk-rec-history__runpill">
                      {kitT(lang, 'kit.record.history.run', { count: run.count })}
                    </span>
                    <span className="sk-rec-history__runat">
                      {kitT(lang, 'kit.record.history.runPeriod', { from: stamp(run.first_valid_from, lang), to: at(v, lang) })}
                    </span>
                    {source.onExpand ? (
                      <button type="button" className="sk-btn sk-rec-history__runmore" aria-expanded={open}
                        disabled={st?.phase === 'busy'} onClick={() => void expand(key, v)}>
                        {kitT(lang, st?.phase === 'busy' ? 'kit.record.history.runBusy'
                          : open ? 'kit.record.history.runClose' : 'kit.record.history.runOpen')}
                      </button>
                    ) : (
                      // Разворачивать некому — не делаем вид, что серия
                      // раскрывается, а говорим, как увидеть правки по одной.
                      <span className="sk-rec-history__why">{kitT(lang, 'kit.record.history.runNoExpand')}</span>
                    )}
                    {st?.phase === 'failed' && (
                      <span className="sk-rec-history__runfail" role="alert" data-testid="kit-history-run-failed">
                        {kitT(lang, 'kit.record.history.runFailed', { reason: describeError(st.error) })}
                      </span>
                    )}
                    {open && st.rows.length < run.count && (
                      <span className="sk-rec-history__runnote" data-testid="kit-history-run-partial">
                        {kitT(lang, 'kit.record.history.runPartial', { got: st.rows.length, count: run.count })}
                      </span>
                    )}
                  </div>
                )}
                {open && st.rows.length > 0 && (
                  <ol className="sk-rec-history__runlist" aria-label={kitT(lang, 'kit.record.history.runList')}>
                    {st.rows.map((c, j) => {
                      const ckey = c.state_uid ?? `${key}~${j}`;
                      return (
                        <li key={ckey} className="sk-rec-history__runrow" data-testid="kit-history-run-row"
                          data-author={historyAuthor(c.author).kind}>
                          <button type="button" className="sk-rec-history__pick" aria-pressed={ckey === selected}
                            aria-label={kitT(lang, 'kit.record.history.pick', { at: at(c, lang) })} onClick={() => pick(ckey)}>
                            {rowFace(c)}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {sel && (
        <section className="sk-rec-history__panel" aria-label={kitT(lang, 'kit.record.history.version', { at: at(sel, lang) })}>
          <div className="sk-rec-history__bar">
            <label className="sk-rec-history__cmp" htmlFor={compareId}>{kitT(lang, 'kit.record.history.compare')}</label>
            {/* Сравнить можно ЛЮБЫЕ две: в списке — все видимые строки, включая
                правки внутри развёрнутой серии, а не только соседняя версия. */}
            <select id={compareId} className="sk-rec-history__select" value={base ?? ''}
              onChange={e => setBase(e.target.value === '' ? null : e.target.value)}>
              <option value="">{kitT(lang, 'kit.record.history.compareNone')}</option>
              {pool.map(p => p.key === selected ? null : (
                <option key={p.key} value={p.key}>{at(p.v, lang)}{p.v.is_open ? ` · ${kitT(lang, 'kit.record.history.current')}` : ''}</option>
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
  // «Правок нет» и «ничего не нашлось по фильтру» рисует сам HistoryBody:
  // фильтры обязаны остаться на экране, иначе снять их нечем.
  return <HistoryBody key={record.id} record={record} history={history} source={source} lang={lang} />;
}
