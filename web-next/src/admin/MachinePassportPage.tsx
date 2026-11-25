// Паспорт машины в админке (SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT). Прототип
// docs/prototypes/ap-machine-passport.html, экран Б (1280 и 390); «да» владельца 25.11.
//
// Запись — из МОДЕЛИ: тип machine (lore-model.json) через общий паспорт ListPassport, как у остальных
// типов (владелец, шлюз, harness, обе отметки, вкладка «Агенты машины» по ребру USES_MACHINE).
// Вокруг — то, чего у записи модели нет и что решил владелец:
//   • 6б — обе даты с подписью источника: отметка машины (KnowMachine.last_seen_at) и последнее действие
//     в журнале (agent_actions), потому что отметка отставала (6в чинится на сервере);
//   • 2б — «были сессией, но ребра нет»: ребро ставится только на ЗАПИСИ агента;
//   • «Доступы» — ссылкой на прежний экран допусков и матрицу (правка там, здесь не дублируется);
//   • журнал машины — последние записи среза agent_actions.
// Состояния честные: «не смогли прочитать / нет прав» ≠ «пусто», у каждого блока своё.
import { Suspense, type ReactNode } from 'react';
import { EmptyState, LoadError, Pill, Skeleton, useLoadState, type LoadResult } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { lazyChunk } from '../shell/staleChunk';
import type { Machine } from './machines';
import {
  ACTIONS_LIMIT, edgeAgents, fetchGraphMachine, fetchMachineActions, fetchMachineSessions, sessionOnly,
  type ActionRow, type GraphMachine, type SessionRow,
} from './machineGraph';
import './Admin.css';

const ListPassport = lazyChunk(() => import('../record/ListPassport'));

/** ISO-время → «ДД.ММ.ГГГГ ЧЧ:ММ» (UTC, как журнал и прототип); не время — как есть. */
export function fmtUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);
const denied = (e: unknown) => e instanceof LoreHttpError && (e.status === 401 || e.status === 403);

export interface MachinePassportPageProps {
  id: string;
  /** Строка machine_acl этой машины (шлюз и допуски); null — шлюза в допусках нет. */
  acl: Machine | null;
  fetchImpl?: typeof fetch;
  /** Запись модели; по умолчанию — общий паспорт (ListPassport type=machine). Подмена — в тестах. */
  record?: (id: string) => ReactNode;
  onBack: () => void;
  /** Открыть прежний экран допусков машины (Drawer «Доступ к машинам»). */
  onGrants: () => void;
  onMatrix: () => void;
  /** Завести шлюз машине без шлюза — мастер «Новая машина» с её именем (решение 3б). */
  onEnroll: (id: string) => void;
}

export function MachinePassportPage({ id, acl, fetchImpl, record, onBack, onGrants, onMatrix, onEnroll }: MachinePassportPageProps) {
  const t = useAppT();
  const row = useLoadState<GraphMachine | null>(signal => fetchGraphMachine(id, signal, fetchImpl), [id, fetchImpl]);
  const sessions = useLoadState<SessionRow[]>(signal => fetchMachineSessions(id, signal, fetchImpl), [id, fetchImpl], { rows: d => d });
  const actions = useLoadState<ActionRow[]>(signal => fetchMachineActions(id, signal, fetchImpl), [id, fetchImpl], { rows: d => d });

  const back = (
    <button type="button" className="adm-btn" data-testid="adm-mpass-back" onClick={onBack}>{t('admin.mpass.back')}</button>
  );
  if (row.state === 'loading' && row.data === undefined) {
    return <section className="adm" data-testid={`adm-mpass-${id}`}>{back}<Skeleton lines={6} label={t('admin.mpass.loading')} /></section>;
  }
  if (row.data === undefined) {
    return <section className="adm" data-testid={`adm-mpass-${id}`}>{back}<LoadError error={row.error} onRetry={row.reload} /></section>;
  }
  const m = row.data;
  if (m === null) {
    return (
      <section className="adm" data-testid={`adm-mpass-${id}`}>
        {back}
        <div data-testid="adm-mpass-notfound"><EmptyState title={t('admin.mpass.notFound', { id })} hint={t('admin.mpass.notFoundHint')} /></div>
      </section>
    );
  }

  const edge = edgeAgents(m);
  const lastAction = actions.data?.[0]?.ts ?? null;
  const gateway = m.gateway ?? acl?.client_id ?? null;

  return (
    <section className="adm adm-mpass" data-testid={`adm-mpass-${id}`} aria-label={t('admin.mpass.aria', { id })}>
      <p className="adm-sub">{back}</p>

      <div data-testid="adm-mpass-record">
        {record ? record(id) : (
          <Suspense fallback={<Skeleton lines={6} label={t('admin.mpass.loading')} />}>
            <ListPassport type="machine" id={id} placement="full" fetchImpl={fetchImpl} readOnly backLabel={t('admin.macl.title')} onBack={onBack} />
          </Suspense>
        )}
      </div>

      {/* 6б: обе даты, у каждой — источник. Отметка — не «последнее действие». */}
      <h3 className="adm-h">{t('admin.mpass.activity')}</h3>
      <table className="adm-table" data-testid="adm-mpass-activity">
        <tbody>
          <tr>
            <th scope="row">{t('admin.mpass.seen')}</th>
            <td>{fmtUtc(m.last_seen_at) ?? <span className="adm-missing">{t('admin.mpass.never')}</span>}</td>
            <td className="adm-mono">{t('admin.mpass.seenSrc')}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.mpass.lastAction')}</th>
            <td>
              {actions.data !== undefined
                ? (fmtUtc(lastAction) ?? <span className="adm-dim">{t('admin.mpass.noActions')}</span>)
                : actions.state === 'loading' ? '…'
                  : <span className="adm-err" data-testid="adm-mpass-actions-forbidden">{t('admin.mpass.actionsFailed', { reason: reasonOf(actions.error) })}</span>}
            </td>
            <td className="adm-mono">{t('admin.mpass.lastActionSrc', { id })}</td>
          </tr>
          <tr>
            <th scope="row">{t('admin.mpass.firstSeen')}</th>
            <td>{fmtUtc(m.first_seen_at) ?? '—'}</td>
            <td className="adm-mono">{t('admin.mpass.firstSeenSrc')}</td>
          </tr>
        </tbody>
      </table>

      {/* 2б: ребро — в записи выше; здесь — кто был сессией без ребра. */}
      <h3 className="adm-h">{t('admin.mpass.agents')}</h3>
      <p className="adm-sub" data-testid="adm-mpass-agents">
        <Pill>{t('admin.mpass.agentsEdge', { n: edge.length })}</Pill>
        {gateway && <Pill variant="id">{gateway}</Pill>}
      </p>
      <h4 className="adm-field__l">{t('admin.mpass.sessionOnly')}</h4>
      <p className="adm-hint">{t('admin.mpass.sessionOnlyHint')}</p>
      <SessionOnlyBlock state={sessions} edge={m.agent_ids} />

      <h3 className="adm-h">{t('admin.mpass.access')}</h3>
      <div data-testid="adm-mpass-access" className="adm-field">
        {acl ? (
          <>
            <p className="adm-sub">
              {acl.grants.length
                ? <Pill>{t('admin.mpass.grants', { n: acl.grants.length })}</Pill>
                : <span className="adm-dim">{t('admin.mpass.grantsNone', { owner: acl.owner_name ?? acl.owner_kc_sub ?? '—' })}</span>}
            </p>
            <div className="adm-field--btns">
              <button type="button" className="adm-btn" data-testid="adm-mpass-grants" onClick={onGrants}>{t('admin.mpass.openGrants')}</button>
              <button type="button" className="adm-btn" data-testid="adm-mpass-matrix" onClick={onMatrix}>{t('admin.mpass.openMatrix')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="adm-note" role="status">{t('admin.mpass.noGateway', { id })}</p>
            <div className="adm-field--btns">
              <button type="button" className="adm-btn" data-testid="adm-mpass-enroll" onClick={() => onEnroll(id)}>{t('admin.macl.nogw.enroll')}</button>
            </div>
          </>
        )}
      </div>

      <h3 className="adm-h">{t('admin.mpass.journal')}</h3>
      <ActionsBlock state={actions} />
    </section>
  );
}

type Loaded<T> = LoadResult<T>;

function SessionOnlyBlock({ state, edge }: { state: Loaded<SessionRow[]>; edge: readonly string[] }) {
  const t = useAppT();
  if (state.data === undefined) {
    if (state.state === 'loading') return <Skeleton lines={2} label={t('admin.mpass.loading')} />;
    return <p className="adm-err" role="alert" data-testid="adm-mpass-sessions-error">{t('admin.mpass.sessionsError', { reason: reasonOf(state.error) })}</p>;
  }
  const rows = sessionOnly(state.data, edge);
  if (!rows.length) return <p className="adm-dim" data-testid="adm-mpass-sessiononly-empty">{t('admin.mpass.sessionOnlyEmpty')}</p>;
  return (
    <div className="adm-tablewrap">
      <table className="adm-table" data-testid="adm-mpass-sessiononly">
        <thead><tr><th>{t('admin.mpass.col.agent')}</th><th>{t('admin.mpass.col.session')}</th><th>{t('admin.mpass.col.when')}</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.actor_id ?? '-'}|${r.session_id}`}>
              <td>{r.actor_id ?? <span className="adm-missing">{t('admin.mpass.noAgent')}</span>}</td>
              <td><span className="adm-mono">{r.session_id.slice(0, 8)}</span> {r.dialogue_name ?? ''}</td>
              <td>{fmtUtc(r.last_activity_at) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionsBlock({ state }: { state: Loaded<ActionRow[]> }) {
  const t = useAppT();
  if (state.data === undefined) {
    if (state.state === 'loading') return <Skeleton lines={3} label={t('admin.mpass.loading')} />;
    if (denied(state.error)) return null; // «нет прав» уже сказано в строке «Последнее действие»
    return <LoadError compact error={state.error} onRetry={state.reload} />;
  }
  if (!state.data.length) return <p className="adm-dim" data-testid="adm-mpass-actions-empty">{t('admin.mpass.actionsEmpty')}</p>;
  return (
    <>
      <p className="adm-hint">{t('admin.mpass.journalNote', { n: Math.min(state.data.length, ACTIONS_LIMIT) })}</p>
      <div className="adm-tablewrap">
        <table className="adm-table" data-testid="adm-mpass-actions">
          <thead><tr>
            <th>{t('admin.mpass.col.ts')}</th><th>{t('admin.mpass.col.family')}</th><th>{t('admin.mpass.col.entity')}</th>
            <th>{t('admin.mpass.col.client')}</th><th>{t('admin.mpass.col.status')}</th>
          </tr></thead>
          <tbody>
            {state.data.map((a, i) => (
              <tr key={`${a.ts ?? ''}|${i}`}>
                <td>{fmtUtc(a.ts) ?? '—'}</td><td>{a.family ?? '—'}</td><td className="adm-mono">{a.entity_id ?? '—'}</td>
                <td className="adm-mono">{a.client ?? '—'}</td><td>{a.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
