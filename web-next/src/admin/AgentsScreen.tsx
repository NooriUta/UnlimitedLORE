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
import { Forbidden, LoadError, Pill, Skeleton, EmptyState, useKitLang, useLoadState, useUrlParam } from '@seidr/kit';
import { AgentProjectsPanel } from './AccessBlocks';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  fetchAgents, filterAgents, harnessCounts, HARNESS_NONE, offRegistry, setAgentHarness, setAgentMachine,
  type AgentRow, type AgentsData,
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
  const data = res.data;
  const counts = useMemo(() => (data ? harnessCounts(data.rows, data.registry) : []), [data]);
  const rows = useMemo(() => (data ? filterAgents(data.rows, harness) : []), [data, harness]);
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
                        <MachineEditor row={r} fetchImpl={fetchImpl} onSaved={res.reload} />
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
 * Машина агента в его карточке (S7B-16): «не привязана» словами, привязка по
 * имени, «Отвязать». Сервер принимает правку только вместе с владельцем и
 * учёткой — нет их, правки нет, и причина сказана (а не кнопка, которая упадёт).
 */
function MachineEditor({ row, fetchImpl, onSaved }: { row: AgentRow; fetchImpl?: typeof fetch; onSaved: () => void }) {
  const t = useAppT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bound = row.machine_id !== null;
  const save = async (machine: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await setAgentMachine(row, machine, fetchImpl);
      setValue('');
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
              data-testid="adm-machine-input" onChange={e => setValue(e.target.value)} />
          </label>
          <button type="button" className="adm-btn" data-testid="adm-machine-save"
            disabled={busy || value.trim() === ''} onClick={() => { void save(value); }}>{t('admin.machine.save')}</button>
          {bound && (
            <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-machine-unbind" disabled={busy}
              onClick={() => { void save(null); }}>{t('admin.machine.unbind')}</button>
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (v: string) => {
    setBusy(true);
    setErr(null);
    try {
      await setAgentHarness(row, v === '' ? null : v, fetchImpl);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr data-testid={`adm-agent-${row.actor_id}`}>
      <th scope="row">
        <span className="adm-name">{row.name ?? row.actor_id}</span>
        <span className="adm-id">{row.actor_id}</span>
      </th>
      <td>
        {registry ? (
          <select className="adm-select" aria-label={t('admin.harness.edit', { agent: row.name ?? row.actor_id })}
            value={row.harness ?? ''} disabled={busy} onChange={e => { void save(e.target.value); }}
            data-none={row.harness === null || undefined}>
            <option value="">{t('admin.harness.none')}</option>
            {/* Код у актора есть, а в активном справочнике нет — показываем как есть, с пометкой. */}
            {off && row.harness && <option value={row.harness}>{t('admin.harness.offDict', { code: labels[row.harness] ?? row.harness })}</option>}
            {registry.map(h => <option key={h} value={h}>{labels[h] ?? h}</option>)}
          </select>
        ) : row.harness ? <Pill variant="id">{labels[row.harness] ?? row.harness}</Pill> : <span className="adm-missing">{t('admin.harness.none')}</span>}
        {off && <span className="adm-missing" data-testid="adm-off-dict">{t('admin.harness.offDictNote')}</span>}
        {err && <span className="adm-err" role="alert">{err}</span>}
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
