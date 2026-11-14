// Экран «Журнал действий» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-02, пачка — S7B-13).
//
// Что видно: кто (вызывающий + ось человек/агент/не опознан), что (семейство +
// запись), когда (отметка), чем кончилось (код ответа) и шла ли правка пачкой.
//
// Все спорные исходы названы РАЗНЫМИ словами — это и есть задача экрана:
//   «показано N из M» / «сколько всего — неизвестно» / «обрезано пределом»;
//   «отказ» / «успех» / «исход не записан»;
//   «нет прав» / «журнал пуст» / «по фильтру ничего»;
//   «фильтр сервер не принял» (его слова + его список допустимых значений);
//   «одиночное действие» / «пачка» / «пачку раскрыть нечем».
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Forbidden, LoadError, Pill, Skeleton, useLoadState, useUrlParam, setUrlParams } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  ACTION_AXES, ACTION_FAMILIES, ACTION_LIMITS, actionTime, actionsSearch, badParamsOf, EMPTY_ACTIONS_QUERY,
  fetchActions, fetchBatch, hasActionFilters, isEndpointPath, outcomeOf, type ActionsData, type ActionsQuery, type BatchData,
  type BatchState,
} from './actions';
import { DangerBatch } from './DangerBatch';
import { KcDenials } from './KcDenials';
import { fetchAgents, type AgentRow } from './agents';
import { HarnessMark, callerHarness } from './HarnessMark';
import { MachineCell } from './machineMark';
import './Admin.css';

export interface ActionsScreenProps {
  /** Подмена fetch (тесты). */
  fetchImpl?: typeof fetch;
}

/** Фильтр — в адресе: ссылку на «что делал этот агент за эти сутки» можно послать. */
const URL_KEYS: Record<keyof ActionsQuery, string> = {
  caller: 'adm-caller', axis: 'adm-axis', family: 'adm-family', batch_id: 'adm-batch',
  from: 'adm-from', to: 'adm-to', limit: 'adm-limit',
};

const AXIS_LABEL: Record<string, AppKey> = {
  human: 'admin.log.axis.human', agent: 'admin.log.axis.agent', unauth: 'admin.log.axis.unauth',
};
const FAMILY_LABEL: Record<string, AppKey> = {
  dict: 'admin.log.family.dict', kc: 'admin.log.family.kc', admin: 'admin.log.family.admin',
  user: 'admin.log.family.user', project: 'admin.log.family.project',
  'project-actor': 'admin.log.family.project-actor',
};
const OUTCOME_LABEL = {
  ok: 'admin.log.outcome.ok', refused: 'admin.log.outcome.refused', unknown: 'admin.log.outcome.unknown',
} as const satisfies Record<string, AppKey>;

function useUrlQuery(): ActionsQuery {
  const [caller] = useUrlParam(URL_KEYS.caller);
  const [axis] = useUrlParam(URL_KEYS.axis);
  const [family] = useUrlParam(URL_KEYS.family);
  const [batch] = useUrlParam(URL_KEYS.batch_id);
  const [from] = useUrlParam(URL_KEYS.from);
  const [to] = useUrlParam(URL_KEYS.to);
  const [limit] = useUrlParam(URL_KEYS.limit);
  return useMemo(() => ({
    caller: caller ?? '', axis: axis ?? '', family: family ?? '', batch_id: batch ?? '',
    from: from ?? '', to: to ?? '', limit: limit ?? '',
  }), [caller, axis, family, batch, from, to, limit]);
}

export function ActionsScreen({ fetchImpl }: ActionsScreenProps) {
  const t = useAppT();
  const applied = useUrlQuery();
  const key = actionsSearch(applied);
  const [draft, setDraft] = useState<ActionsQuery>(applied);
  // Адрес — источник истины: «Назад» и правка строки адреса возвращают поля формы.
  useEffect(() => { setDraft(applied); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useLoadState<ActionsData>(
    signal => fetchActions(applied, { signal, fetchImpl }),
    [key, fetchImpl],
    { rows: d => d.rows },
  );
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  // S7B-22: знак harness у агента-вызывающего. Агенты читаются, только если в
  // выдаче есть строки оси «агент»; не прочитались — знака нет, журнал тот же
  // (знак — подсказка рядом с именем, а не данные журнала).
  const hasAgents = res.data?.rows.some(r => r.axis === 'agent') ?? false;
  const [agents, setAgents] = useState<AgentRow[]>([]);
  useEffect(() => {
    if (!hasAgents) return;
    const ac = new AbortController();
    fetchAgents(ac.signal, fetchImpl).then(d => setAgents(d.rows), () => setAgents([]));
    return () => ac.abort();
  }, [hasAgents, fetchImpl]);
  /** Пачки, у которых раскрывать нечего (404): раскрытие по ним больше не предлагаем. */
  const [deadBatches, setDeadBatches] = useState<readonly string[]>([]);
  const markDead = useCallback((id: string) => {
    setDeadBatches(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const set = (k: keyof ActionsQuery) => (v: string) => setDraft(d => ({ ...d, [k]: v }));
  const apply = () => {
    const patch: Record<string, string | null> = {};
    for (const k of Object.keys(URL_KEYS) as Array<keyof ActionsQuery>) {
      patch[URL_KEYS[k]] = draft[k].trim() === '' ? null : draft[k].trim();
    }
    setUrlParams(patch, { replace: true });
  };
  const reset = () => {
    const patch: Record<string, string | null> = {};
    for (const k of Object.keys(URL_KEYS) as Array<keyof ActionsQuery>) patch[URL_KEYS[k]] = null;
    setDraft(EMPTY_ACTIONS_QUERY);
    setUrlParams(patch, { replace: true });
  };

  const data = res.data;
  const bad = badParamsOf(res.error);
  let body;
  if (bad) {
    // 400 — не сбой загрузки: сервер назвал, что именно не принял.
    body = (
      <div className="adm-note" data-tone="dng" role="alert" data-testid="adm-log-badparams">
        <p className="adm-note__line">{t('admin.log.badParams', { detail: bad.detail })}</p>
        {bad.allowed.length > 0 && (
          <p className="adm-note__line" data-testid="adm-log-allowed">
            {t('admin.log.badParamsAllowed')}{' '}
            {bad.allowed.map(v => <Pill key={v} variant="id">{v}</Pill>)}
          </p>
        )}
      </div>
    );
  } else if (res.state === 'loading' && !data) {
    body = <Skeleton lines={6} label={t('admin.log.loading')} />;
  } else if (res.state === 'forbidden') {
    body = (
      <Forbidden
        title={t('admin.log.forbidden')}
        hint={t('admin.log.forbiddenHint')}
        reason={res.error instanceof Error ? res.error.message : undefined}
      />
    );
  } else if (res.state === 'error' || !data) {
    body = <LoadError error={res.error} onRetry={res.reload} />;
  } else {
    body = (
      <>
        <p className="adm-note" data-tone={data.totalState === 'exact' ? 'inf' : 'wrn'} role="status"
          data-testid="adm-log-total" data-total-state={data.totalState}>
          {data.totalState === 'exact' && data.total !== null
            ? t('admin.log.totalExact', { shown: data.shown, total: data.total })
            : t('admin.log.totalUnknown', { shown: data.shown })}
        </p>
        {data.truncated && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-log-truncated">
            {/* Предел сервер не назвал — про обрезку говорим, число не выдумываем. */}
            {data.limit === null ? t('admin.log.truncatedNoLimit') : t('admin.log.truncated', { limit: data.limit })}
          </p>
        )}
        {data.rows.length === 0 ? (
          <EmptyJournal filtered={hasActionFilters(applied)} onReset={reset} />
        ) : (
          <div className="adm-tablewrap">
            <table className="adm-table" data-testid="adm-log">
              <caption className="sk-sr">{t('admin.log.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.log.col.ts')}</th>
                  <th scope="col">{t('admin.log.col.family')}</th>
                  <th scope="col">{t('admin.log.col.entity')}</th>
                  <th scope="col">{t('admin.log.col.caller')}</th>
                  <th scope="col">{t('admin.log.col.axis')}</th>
                  <th scope="col">{t('admin.log.col.client')}</th>
                  <th scope="col">{t('admin.log.col.machine')}</th>
                  <th scope="col">{t('admin.log.col.outcome')}</th>
                  <th scope="col">{t('admin.log.col.batch')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const state: BatchState = r.batch_id === null
                    ? 'single'
                    : deadBatches.includes(r.batch_id) ? 'unexpandable' : 'batch';
                  const time = actionTime(r.ts);
                  const outcome = outcomeOf(r.status);
                  const open = r.batch_id !== null && openBatch === r.batch_id;
                  return (
                    <Fragment key={i}>
                      <tr data-testid={`adm-log-row-${i}`} data-outcome={outcome}>
                        <td>
                          {time ? (
                            <span className="adm-mono" data-testid="adm-log-ts" title={time.iso}>
                              {kitMinute(time.iso)?.text ?? time.iso}
                            </span>
                          ) : (
                            <span className="adm-missing" data-testid="adm-log-ts">{t('admin.log.ts.none')}</span>
                          )}
                        </td>
                        <td>{label(t, FAMILY_LABEL, r.family)}</td>
                        <th scope="row">
                          {isEndpointPath(r.entity_id) ? (
                            // PU-03: путь эндпоинта — «куда звали», а не «что изменили».
                            <span className="adm-missing" data-testid="adm-log-entity" title={r.entity_id ?? ''}>
                              {t('admin.log.entity.path')}
                            </span>
                          ) : (
                            <span className="adm-mono" data-testid="adm-log-entity">{r.entity_id ?? '—'}</span>
                          )}
                        </th>
                        <td>
                          {r.axis === 'agent' && (() => { const h = callerHarness(r.caller, agents); return h && <HarnessMark logo={h.logo} label={h.label} />; })()}
                          {r.caller ?? <span className="adm-missing">{t('admin.log.caller.none')}</span>}
                        </td>
                        <td>{label(t, AXIS_LABEL, r.axis)}</td>
                        <td><MachineCell value={r.client} testId="adm-log-client" /></td>
                        <td><MachineCell value={r.machine} testId="adm-log-machine" /></td>
                        <td>
                          <span className="adm-outcome" data-testid="adm-log-outcome" data-outcome={outcome}>
                            {t(OUTCOME_LABEL[outcome])}
                            {r.status !== null && <span className="adm-mono"> · {r.status}</span>}
                          </span>
                        </td>
                        <td>
                          <span className="adm-batch" data-testid="adm-log-batch" data-batch={state}>
                            {state === 'single' && <span className="adm-dim">{t('admin.log.batch.single')}</span>}
                            {state !== 'single' && <span className="adm-mono" title={r.batch_id ?? undefined}>{t('admin.log.batch.is')}</span>}
                            {state === 'unexpandable' && <span className="adm-missing"> {t('admin.log.batch.unexpandable')}</span>}
                          </span>
                          {state === 'batch' && (
                            <button type="button" className="adm-link" data-testid="adm-log-expand"
                              aria-expanded={open}
                              onClick={() => setOpenBatch(open ? null : r.batch_id)}>
                              {open ? t('admin.log.batch.collapse') : t('admin.log.batch.expand')}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7}>
                            <BatchPanel batchId={r.batch_id!} fetchImpl={fetchImpl}
                              onNothing={markDead} onClose={() => setOpenBatch(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-log-h">
      <h2 id="adm-log-h" className="adm-h">{t('admin.log.title')}</h2>
      <p className="adm-lead">{t('admin.log.lead')}</p>
      <form className="adm-filters" onSubmit={e => { e.preventDefault(); apply(); }}>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.caller')}</span>
          <input className="adm-input" type="text" value={draft.caller} onChange={e => set('caller')(e.target.value)} />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.axis')}</span>
          <select className="adm-select" value={draft.axis} onChange={e => set('axis')(e.target.value)}>
            <option value="">{t('admin.log.f.any')}</option>
            {ACTION_AXES.map(a => <option key={a} value={a}>{t(AXIS_LABEL[a])}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.family')}</span>
          <select className="adm-select" value={draft.family} onChange={e => set('family')(e.target.value)}>
            <option value="">{t('admin.log.f.any')}</option>
            {ACTION_FAMILIES.map(f => <option key={f} value={f}>{t(FAMILY_LABEL[f])}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.batch')}</span>
          <input className="adm-input adm-mono" type="text" value={draft.batch_id}
            onChange={e => set('batch_id')(e.target.value)} placeholder="rb-…" />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.from')}</span>
          <input className="adm-input" type={dayOrEmpty(draft.from) ? 'date' : 'text'} value={draft.from}
            onChange={e => set('from')(e.target.value)} placeholder="2026-11-10" />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.to')}</span>
          <input className="adm-input" type={dayOrEmpty(draft.to) ? 'date' : 'text'} value={draft.to}
            onChange={e => set('to')(e.target.value)} placeholder="2026-11-10" />
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.log.f.limit')}</span>
          <select className="adm-select" value={draft.limit} onChange={e => set('limit')(e.target.value)}>
            <option value="">{t('admin.log.f.limitDefault')}</option>
            {ACTION_LIMITS.map(n => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </label>
        <div className="adm-field adm-field--btns">
          <button type="submit" className="adm-btn" data-testid="adm-log-apply">{t('admin.log.apply')}</button>
          <button type="button" className="adm-btn" data-testid="adm-log-reset" onClick={reset}>{t('admin.log.reset')}</button>
        </div>
        <p className="adm-hint">{t('admin.log.f.timeHint')}</p>
      </form>
      {body}
      {/* S7B-31 п.4а: отказы доступа KC (буфер до рестарта) — из старой вкладки «Настройки». */}
      <KcDenials fetchImpl={fetchImpl} />
    </section>
  );
}

type T = ReturnType<typeof useAppT>;

/**
 * S7B-25: период — полем даты, а не текстом. Но сервер принимает и момент ISO,
 * и epoch millis (ссылка из чата может их нести): такое значение поле даты
 * показало бы пустым и молча потеряло бы. Поэтому дата или пусто — поле даты,
 * иное — текст как прислали.
 */
const dayOrEmpty = (v: string): boolean => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Код + подпись: кода нет в закрытом списке — показываем КАК ПРИСЛАЛИ. */
function label(t: T, map: Record<string, AppKey>, code: string | null) {
  if (code === null) return <span className="adm-missing">—</span>;
  const k = map[code];
  return <span title={code}>{k ? t(k) : code}</span>;
}

/** Ноль строк: «журнал пуст» и «по фильтру ничего» — разные ответы. */
function EmptyJournal({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  const t = useAppT();
  return (
    // S7B-25: пустое состояние — kit EmptyState; обёртка несёт только метку для проверок.
    <div data-testid="adm-log-empty" data-empty={filtered ? 'filter' : 'journal'}>
      <EmptyState
        title={filtered ? t('admin.log.emptyFilter') : t('admin.log.empty')}
        hint={filtered ? t('admin.log.emptyFilterHint') : t('admin.log.emptyHint')}
        action={filtered ? <button type="button" className="sk-btn" onClick={onReset}>{t('admin.log.reset')}</button> : undefined}
      />
    </div>
  );
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: BatchData }
  | { kind: 'nothing'; reason: string }
  | { kind: 'error'; reason: string };

/**
 * Раскрытая пачка (S7B-13): её назначения и окно отката СЛОВАМИ.
 *
 * 404 — отдельный исход: событий с этим id пачки нет. Так выглядят пачки,
 * применённые до выкатки раскрытия (у их событий нет batch_id), пробные
 * (dry_run) и те, что ничего не изменили. Это «мы не можем её собрать», а не
 * «пачка пустая», и после такого ответа раскрытие по строке не предлагается.
 *
 * Откат — запись: кнопка ведёт в тот же DangerBatch, что в «Ролях» (см. Rollback).
 */
function BatchPanel({ batchId, fetchImpl, onNothing, onClose, onChanged }: {
  batchId: string;
  fetchImpl?: typeof fetch;
  onNothing: (id: string) => void;
  onClose: () => void;
  /** Пачку откатили — журнал пора перечитать (в нём появится запись отката). */
  onChanged?: () => void;
}) {
  const t = useAppT();
  const [st, setSt] = useState<PanelState>({ kind: 'loading' });
  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    setSt({ kind: 'loading' });
    fetchBatch(batchId, { signal: ctl.signal, fetchImpl }).then(
      d => { if (alive) setSt({ kind: 'ok', data: d }); },
      (e: unknown) => {
        if (!alive) return;
        const reason = e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);
        if (e instanceof LoreHttpError && e.status === 404) {
          setSt({ kind: 'nothing', reason });
          onNothing(batchId);
        } else {
          setSt({ kind: 'error', reason });
        }
      },
    );
    return () => { alive = false; ctl.abort(); };
  }, [batchId, fetchImpl, onNothing]);

  return (
    <div className="adm-batchbox" data-testid="adm-log-batch-panel">
      <div className="adm-batchbox__head">
        <span className="adm-mono">{batchId}</span>
        <button type="button" className="adm-link" onClick={onClose}>{t('admin.log.batch.collapse')}</button>
      </div>
      {st.kind === 'loading' && <Skeleton lines={2} label={t('admin.log.batch.loading')} />}
      {st.kind === 'nothing' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-log-batch-none">
          {t('admin.log.batch.nothing')} <span className="adm-dim">{st.reason}</span>
        </p>
      )}
      {st.kind === 'error' && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-log-batch-error">
          {t('admin.log.batch.error', { reason: st.reason })}
        </p>
      )}
      {st.kind === 'ok' && (
        <>
          <p className="adm-sub">
            {t('admin.log.batch.count', { n: st.data.count })}
            {st.data.kc_sub && <span className="adm-mono"> · {st.data.kc_sub}</span>}
          </p>
          <p className="adm-note" data-tone={st.data.undoOpen ? 'inf' : 'wrn'} role="status"
            data-testid="adm-log-undo" data-open={String(st.data.undoOpen)}>
            {st.data.undoUntil === null
              ? t('admin.log.batch.undoUnknown')
              : st.data.undoOpen
                ? t('admin.log.batch.undoOpen', { until: st.data.undoUntil })
                : t('admin.log.batch.undoClosed', { until: st.data.undoUntil })}
          </p>
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.log.batch.col.project')}</th>
                <th scope="col">{t('admin.log.batch.col.action')}</th>
                <th scope="col">{t('admin.log.batch.col.role')}</th>
                <th scope="col">{t('admin.log.batch.col.before')}</th>
                <th scope="col">{t('admin.log.batch.col.at')}</th>
              </tr>
            </thead>
            <tbody>
              {st.data.items.map((it, i) => (
                <tr key={`${it.project}-${i}`} data-testid={`adm-log-batch-item-${i}`}>
                  <th scope="row"><span className="adm-mono">{it.project ?? '—'}</span></th>
                  <td>{it.action ?? '—'}</td>
                  <td>{it.role ? <Pill>{it.role}</Pill> : <span className="adm-dim">—</span>}</td>
                  <td>{it.role_before
                    ? <Pill>{it.role_before}</Pill>
                    : <span className="adm-missing">{t('admin.log.batch.before.none')}</span>}</td>
                  <td><span className="adm-mono" title={it.at ?? undefined}>{kitMinute(it.at)?.text ?? '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Rollback data={st.data} fetchImpl={fetchImpl} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}

/**
 * «Откатить пачку» (S7B-13). Тело — готовое от сервера (rollback.body), путь —
 * тот же DangerBatch, что в «Ролях»: дифф (dry_run с undo_of) → ввод слова →
 * одна пачка. Слово подтверждения — kc_sub человека: имени журнал не знает.
 * Окно закрыто, срок не назван или тела нет — честная надпись, а не кнопка.
 */
function Rollback({ data, fetchImpl, onChanged }: { data: BatchData; fetchImpl?: typeof fetch; onChanged?: () => void }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const body = data.rollback?.body ?? null;
  if (!data.undoOpen || !body) {
    return (
      <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-log-rollback-closed">
        {!body ? t('admin.log.batch.rollbackNoBody') : t('admin.log.batch.rollbackClosed')}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="adm-field--btns">
        <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-log-rollback-btn" onClick={() => setOpen(true)}>
          {t('admin.log.batch.rollback')}
        </button>
        <span className="adm-hint">{t('admin.log.batch.rollbackHint')}</span>
      </div>
    );
  }
  return (
    <DangerBatch person={{ kc_sub: body.kc_sub, name: body.kc_sub }} changes={body.changes} undoOf={body.undo_of}
      fetchImpl={fetchImpl} onClose={() => setOpen(false)} onChanged={onChanged} />
  );
}
