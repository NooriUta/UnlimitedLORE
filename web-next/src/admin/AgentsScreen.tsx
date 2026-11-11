// Экран «Агенты» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16; сценарии
// UC-7 «новый ноутбук» и UC-8 «кто где» в SPEC-ADMIN-LORE-UC 1.2.0).
//
// Что видно сразу, без раскрытий:
//   • сводка «сколько агентов какого harness» — чипы, они же фильтр;
//   • у каждого агента — harness, машина, владелец, профиль (client_id);
//   • «не указан» / «не привязана» — словами и цветом предупреждения, потому
//     что пустая клетка читается как «так и надо».
// Правка harness — выбором из реестра сервера, только если сервер его прислал.
import { Fragment, useMemo, useState } from 'react';
import { DiffPreview, Forbidden, LoadError, Pill, Skeleton, EmptyState, useKitLang, useLoadState, useUrlParam, type DiffRow } from '@seidr/kit';
import { AgentProjectsPanel } from './AccessBlocks';
import { RotatePanel } from './KcDanger';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  agentWhy, agentsWithoutMachine, AGENTS_NO_MACHINE, fetchAgentOrphans, fetchAgents, filterAgents, graphOrphans, harnessCounts, HARNESS_NONE, offRegistry,
  setAgentHarness, setAgentMachine,
  type AgentRow, type AgentsData, type KcOrphan,
} from './agents';
import './Admin.css';

export interface AgentsScreenProps {
  /** Подмена fetch (тесты). */
  fetchImpl?: typeof fetch;
}

export function AgentsScreen({ fetchImpl }: AgentsScreenProps) {
  const t = useAppT();
  const lang = useKitLang();
  const res = useLoadState<AgentsData>(signal => fetchAgents(signal, fetchImpl, lang), [fetchImpl, lang], { rows: d => d.rows });
  const [harness, setHarness] = useState<string | null>(null);
  // Раскрытый агент (вкладка «Проекты») — в адресе: ?adm-agent=actor_id (S7B-12).
  const [openAgent, setOpenAgent] = useUrlParam('adm-agent');
  // S7B-25: фильтр «без машины» — в адресе: на него ведёт карточка Главной (S7B-26).
  const [agentsF, setAgentsF] = useUrlParam('adm-agents-f');
  const noMachine = agentsF === AGENTS_NO_MACHINE;
  const data = res.data;
  const counts = useMemo(() => (data ? harnessCounts(data.rows, data.registry) : []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const byHarness = filterAgents(data.rows, harness);
    return noMachine ? agentsWithoutMachine(byHarness) : byHarness;
  }, [data, harness, noMachine]);
  const label = (k: string) => (k === HARNESS_NONE ? t('admin.harness.none') : data?.labels[k] ?? k);

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={6} label={t('admin.agents.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={res.error instanceof Error ? res.error.message : undefined} />;
  else if (res.state === 'error' || !data) body = <LoadError error={res.error} onRetry={res.reload} />;
  else if (data.rows.length === 0) body = <EmptyState title={t('admin.agents.empty')} />;
  else {
    body = (
      <>
        <div className="adm-chips" role="group" aria-label={t('admin.harness.filter')} data-testid="adm-harness-chips">
          <button type="button" className="adm-chip" aria-pressed={harness === null} onClick={() => setHarness(null)}>
            {t('admin.harness.all')} <b>{data.rows.length}</b>
          </button>
          {counts.map(c => (
            <button key={c.key} type="button" className="adm-chip" aria-pressed={harness === c.key}
              data-testid={`adm-harness-${c.key}`} data-none={c.key === HARNESS_NONE || undefined}
              onClick={() => setHarness(h => (h === c.key ? null : c.key))}>
              {label(c.key)} <b>{c.n}</b>
            </button>
          ))}
          <button type="button" className="adm-chip" aria-pressed={noMachine} data-testid="adm-agents-nomachine"
            data-none={agentsWithoutMachine(data.rows).length > 0 || undefined}
            onClick={() => setAgentsF(noMachine ? null : AGENTS_NO_MACHINE, { replace: true })}>
            {t('admin.machine.noneChip')} <b>{agentsWithoutMachine(data.rows).length}</b>
          </button>
        </div>
        {data.truncated && <p className="adm-note" data-tone="wrn" role="status">{t('admin.agents.truncated')}</p>}
        {data.registryProblem && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-no-registry" data-kind={data.registryProblem.kind}>
            {data.registryProblem.kind === 'empty'
              ? t('admin.harness.dictEmpty')
              : t('admin.harness.dictError', { reason: data.registryProblem.reason })}
          </p>
        )}
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-agents">
            <thead>
              <tr>
                <th scope="col">{t('admin.col.agent')}</th>
                <th scope="col">{t('admin.col.harness')}</th>
                <th scope="col">{t('admin.col.machine')}</th>
                <th scope="col">{t('admin.col.owner')}</th>
                <th scope="col">{t('admin.col.profile')}</th>
                <th scope="col">{t('admin.col.projects')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.actor_id}>
                  <AgentLine row={r} registry={data.registry} labels={data.labels} fetchImpl={fetchImpl} onSaved={res.reload}
                    expanded={openAgent === r.actor_id}
                    onToggle={() => setOpenAgent(openAgent === r.actor_id ? null : r.actor_id)} />
                  {openAgent === r.actor_id && (
                    <tr data-testid={`adm-agent-row-${r.actor_id}`}>
                      <td colSpan={6}>
                        <AgentWhyLine row={r} />
                        <MachineEditor row={r} all={data.rows} fetchImpl={fetchImpl} onSaved={res.reload} />
                        {/* S7B-03: ротация секрета — дифф → ввод clientId → секрет один раз; отменить нельзя. */}
                        <RotatePanel clientId={r.client_id} fetchImpl={fetchImpl} />
                        <AgentProjectsPanel clientId={r.client_id} agentScope={r.agent_role}
                          ownerName={r.owner_display_name} fetchImpl={fetchImpl} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <OrphansBlock rows={data.rows} fetchImpl={fetchImpl} />
      </>
    );
  }
  return (
    <section className="adm" aria-labelledby="adm-agents-h">
      <h2 id="adm-agents-h" className="adm-h">{t('admin.agents.title')}</h2>
      <p className="adm-lead">{t('admin.agents.lead')}</p>
      {body}
    </section>
  );
}

/**
 * S7B-04: почему агент видит проекты — цепочка сервера словами: учётка →
 * агент → владелец → его проекты; пишет по профилю (D4). Список проектов —
 * ниже, в AgentProjectsPanel (ответ сервера).
 */
function AgentWhyLine({ row }: { row: AgentRow }) {
  const t = useAppT();
  const why = agentWhy(row);
  const text = why.kind === 'inherits'
    ? t('admin.agentWhy.inherits', { owner: why.owner, scope: why.scope ?? t('admin.agentWhy.noScope') })
    : why.kind === 'noowner' ? t('admin.agentWhy.noowner') : t('admin.agentWhy.noclient');
  return (
    <p className={why.kind === 'inherits' ? 'adm-sub' : 'adm-note'} data-tone={why.kind === 'inherits' ? undefined : 'wrn'}
      data-testid="adm-agent-why" data-why={why.kind}>
      <b>{t('admin.agentWhy.title')}:</b> {text}
    </p>
  );
}

/**
 * S7B-16: находки детектора осиротевших агентов.
 *   • граф — агенты без владельца (из того же agent_owners, без запроса);
 *   • Keycloak — GET /lore/kc/agent-orphans: клиенты с сервисной учёткой без
 *     агента в графе. «Сирот нет» — только если KC ответил; 403, «KC не
 *     настроен» (503 KC_NOT_CONFIGURED) и сбой — каждое своими словами.
 */
function OrphansBlock({ rows, fetchImpl }: { rows: AgentRow[]; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lonely = graphOrphans(rows);
  const res = useLoadState<KcOrphan[]>(signal => fetchAgentOrphans(signal, fetchImpl), [fetchImpl]);
  const err = res.error;
  let kc;
  if (res.state === 'forbidden' || (err instanceof LoreHttpError && err.status === 403)) {
    kc = <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-orphans-kc-forbidden">{t('admin.orphans.kcForbidden')}</p>;
  } else if (err instanceof LoreHttpError && err.status === 503 && err.code === 'KC_NOT_CONFIGURED') {
    kc = <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-orphans-kc-unconfigured">{t('admin.orphans.kcUnconfigured')}</p>;
  } else if (res.state === 'error' || (err && !res.data)) {
    const reason = err instanceof LoreHttpError ? (err.detail || err.message) : err instanceof Error ? err.message : String(err);
    kc = <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-orphans-kc-error">{t('admin.orphans.kcError', { reason })}</p>;
  } else if (!res.data) {
    kc = <Skeleton lines={2} label={t('admin.orphans.kcLoading')} />;
  } else if (res.data.length === 0) {
    kc = <p className="adm-sub" data-testid="adm-orphans-kc-none">{t('admin.orphans.kcNone')}</p>;
  } else {
    kc = (
      <>
        <ul className="adm-plist">
          {res.data.map(o => (
            <li key={o.clientId} data-testid={`adm-orphan-kc-${o.clientId}`} data-enabled={o.enabled === null ? undefined : String(o.enabled)}>
              <span className="adm-mono">{o.clientId}</span>
              {o.enabled === false && <span className="adm-missing"> · {t('admin.orphans.disabled')}</span>}
            </li>
          ))}
        </ul>
        <p className="adm-hint">{t('admin.orphans.kcHint')}</p>
      </>
    );
  }
  return (
    <section className="adm-access" aria-labelledby="adm-orphans-h" data-testid="adm-orphans-box">
      <h3 id="adm-orphans-h" className="adm-access__h">{t('admin.orphans.title')}</h3>
      <div data-testid="adm-orphans-graph">
        {lonely.length === 0
          ? <p className="adm-sub">{t('admin.orphans.graphNone')}</p>
          : (
            <p className="adm-note" data-tone="wrn" role="status">
              {t('admin.orphans.graph', { n: lonely.length })}{' '}
              {lonely.map(a => <Pill key={a.actor_id} variant="id">{a.name ?? a.actor_id}</Pill>)}
            </p>
          )}
      </div>
      <div data-testid="adm-orphans-kc" role="group" aria-label={t('admin.orphans.kc')}>
        <h4 className="adm-field__l">{t('admin.orphans.kc')}</h4>
        {kc}
      </div>
    </section>
  );
}

/**
 * Машина агента в его карточке (S7B-16): «не привязана» словами, привязка по
 * имени, «Отвязать». Сервер принимает правку только вместе с владельцем и
 * учёткой — нет их, правки нет, и причина сказана (а не кнопка, которая упадёт).
 */
function MachineEditor({ row, all, fetchImpl, onSaved }: { row: AgentRow; all: readonly AgentRow[]; fetchImpl?: typeof fetch; onSaved: () => void }) {
  const t = useAppT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bound = row.machine_id !== null;
  // S7B-25: отвязка — не в один клик: сперва вопрос с именем машины.
  const [asking, setAsking] = useState(false);
  // S7B-25: подсказка занятых имён — машины, уже известные по другим агентам.
  const known = useMemo(() => [...new Set(all.filter(a => a.actor_id !== row.actor_id && a.machine_id).map(a => a.machine_id!))].sort(), [all, row.actor_id]);
  const typedName = value.trim();
  const sharing = typedName === '' ? [] : all.filter(a => a.actor_id !== row.actor_id && a.machine_id === typedName);
  const listId = `adm-machines-${row.actor_id}`;
  const save = async (machine: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await setAgentMachine(row, machine, fetchImpl);
      setValue('');
      setAsking(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const blocker = !row.owner_kc_sub ? 'noowner' : !row.client_id ? 'noclient' : null;
  return (
    <div className="adm-filters" role="group" aria-label={t('admin.machine.title')}
      data-testid={`adm-machine-${row.actor_id}`} data-bound={String(bound)}>
      <span className="adm-field__l">{t('admin.machine.title')}</span>
      {bound
        ? <span className="adm-mono">{t('admin.machine.bound', { id: row.machine_id! })}</span>
        : <span className="adm-missing">{t('admin.machine.none')}</span>}
      {blocker ? (
        <p className="adm-note" data-tone="wrn" role="status" data-testid={`adm-machine-${blocker}`}>
          {blocker === 'noowner' ? t('admin.machine.noOwner') : t('admin.machine.noClient')}
        </p>
      ) : (
        <>
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.machine.input')}</span>
            <input className="adm-input adm-mono" type="text" value={value} disabled={busy} spellCheck={false}
              list={listId} data-testid="adm-machine-input" onChange={e => setValue(e.target.value)} />
          </label>
          <datalist id={listId}>{known.map(m => <option key={m} value={m} />)}</datalist>
          {sharing.length > 0 && (
            <p className="adm-note" data-tone="inf" role="status" data-testid="adm-machine-taken">
              {t('admin.machine.taken', { id: typedName, agents: sharing.map(a => a.name ?? a.actor_id).join(', ') })}
            </p>
          )}
          <button type="button" className="adm-btn" data-testid="adm-machine-save"
            disabled={busy || value.trim() === ''} onClick={() => { void save(value); }}>{t('admin.machine.save')}</button>
          {bound && !asking && (
            <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-machine-unbind" disabled={busy}
              onClick={() => setAsking(true)}>{t('admin.machine.unbind')}</button>
          )}
          {bound && asking && (
            <p className="adm-note" data-tone="wrn" role="group" data-testid="adm-machine-unbind-ask">
              {t('admin.machine.unbindAsk', { id: row.machine_id! })}{' '}
              <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-machine-unbind-yes" disabled={busy}
                onClick={() => { void save(null); }}>{t('admin.machine.unbindYes')}</button>{' '}
              <button type="button" className="adm-btn" data-testid="adm-machine-unbind-no" disabled={busy}
                onClick={() => setAsking(false)}>{t('admin.machine.unbindNo')}</button>
            </p>
          )}
          <p className="adm-hint">{t('admin.machine.hint')}</p>
        </>
      )}
      {err && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-machine-error">{t('admin.machine.error', { reason: err })}</p>}
    </div>
  );
}

function AgentLine({ row, registry, labels, fetchImpl, onSaved, expanded, onToggle }: {
  row: AgentRow; registry: string[] | null; labels: Record<string, string>; fetchImpl?: typeof fetch; onSaved: () => void;
  expanded: boolean; onToggle: () => void;
}) {
  const off = offRegistry(row.harness, registry);
  const t = useAppT();
  const lang = useKitLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // S7B-25: выбор не пишет сразу — сперва дифф «было → станет» и «Применить»/«Отмена»;
  // применённое можно вернуть одним нажатием (прежнее значение помним здесь).
  const [pending, setPending] = useState<string | null>(null);
  const [revertTo, setRevertTo] = useState<{ value: string | null } | null>(null);
  const name = (h: string | null) => (h ? labels[h] ?? h : t('admin.harness.none'));
  const save = async (v: string, after?: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await setAgentHarness(row, v === '' ? null : v, fetchImpl);
      after?.();
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const was = row.harness;
  const apply = () => {
    if (pending === null) return;
    const to = pending;
    void save(to, () => { setPending(null); setRevertTo({ value: was }); });
  };
  const revert = () => {
    if (!revertTo) return;
    void save(revertTo.value ?? '', () => setRevertTo(null));
  };
  const diff: DiffRow[] = pending === null ? [] : [harnessDiff(t('admin.col.harness'), was, pending === '' ? null : pending, name)];
  return (
    <tr data-testid={`adm-agent-${row.actor_id}`}>
      <th scope="row">
        <span className="adm-name">{row.name ?? row.actor_id}</span>
        <span className="adm-id">{row.actor_id}</span>
      </th>
      <td>
        {registry ? (
          <select className="adm-select" aria-label={t('admin.harness.edit', { agent: row.name ?? row.actor_id })}
            value={pending ?? row.harness ?? ''} disabled={busy}
            onChange={e => { const v = e.target.value; setRevertTo(null); setPending(v === (row.harness ?? '') ? null : v); }}
            data-none={row.harness === null || undefined}>
            <option value="">{t('admin.harness.none')}</option>
            {/* Код у актора есть, а в активном справочнике нет — показываем как есть, с пометкой. */}
            {off && row.harness && <option value={row.harness}>{t('admin.harness.offDict', { code: labels[row.harness] ?? row.harness })}</option>}
            {registry.map(h => <option key={h} value={h}>{labels[h] ?? h}</option>)}
          </select>
        ) : row.harness ? <Pill variant="id">{labels[row.harness] ?? row.harness}</Pill> : <span className="adm-missing">{t('admin.harness.none')}</span>}
        {off && <span className="adm-missing" data-testid="adm-off-dict">{t('admin.harness.offDictNote')}</span>}
        {err && <span className="adm-err" role="alert">{err}</span>}
        {pending !== null && (
          <div className="adm-harness-pending" data-testid={`adm-harness-pending-${row.actor_id}`}>
            <DiffPreview rows={diff} onApply={apply} busy={busy} lang={lang} />
            <button type="button" className="adm-btn" data-testid="adm-harness-cancel" disabled={busy}
              onClick={() => setPending(null)}>{t('admin.harness.cancel')}</button>
          </div>
        )}
        {revertTo && pending === null && (
          <button type="button" className="adm-btn" data-testid={`adm-harness-revert-${row.actor_id}`} disabled={busy}
            onClick={revert}>{t('admin.harness.revert', { was: name(revertTo.value) })}</button>
        )}
      </td>
      <td>{row.machine_id ? <span className="adm-mono">{row.machine_id}</span> : <span className="adm-missing">{t('admin.machine.none')}</span>}</td>
      <td>{row.owner_display_name ?? row.owner_kc_sub ?? <span className="adm-missing">{t('admin.owner.none')}</span>}</td>
      <td><span className="adm-mono">{row.client_id ?? '—'}</span>{row.agent_role && <span className="adm-role"> · {row.agent_role}</span>}</td>
      <td>
        <button type="button" className="adm-btn" aria-expanded={expanded} data-testid={`adm-agent-proj-btn-${row.actor_id}`}
          onClick={onToggle}>{t('admin.access.agentTab')}</button>
      </td>
    </tr>
  );
}

/**
 * Строка диффа правки harness (S7B-25). Вид — по правде: было и стало —
 * смена; не было — добавление; станет пусто — снятие. Проверка — «checked»:
 * варианты пришли из справочника сервера, а не придуманы здесь.
 */
function harnessDiff(text: string, from: string | null, to: string | null, name: (h: string | null) => string): DiffRow {
  const check = { state: 'checked' as const };
  if (from && to) return { id: 'harness', kind: 'change', text, from: name(from), to: name(to), check };
  if (to) return { id: 'harness', kind: 'add', text: `${text}: ${name(to)}`, check };
  return { id: 'harness', kind: 'remove', text: `${text}: ${name(from)}`, check };
}
