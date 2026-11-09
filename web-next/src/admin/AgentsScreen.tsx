// Экран «Агенты» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-15, S7B-16; сценарии
// UC-7 «новый ноутбук» и UC-8 «кто где» в SPEC-ADMIN-LORE-UC 1.2.0).
//
// Что видно сразу, без раскрытий:
//   • сводка «сколько агентов какого harness» — чипы, они же фильтр;
//   • у каждого агента — harness, машина, владелец, профиль (client_id);
//   • «не указан» / «не привязана» — словами и цветом предупреждения, потому
//     что пустая клетка читается как «так и надо».
// Правка harness — выбором из реестра сервера, только если сервер его прислал.
import { useMemo, useState } from 'react';
import { Forbidden, LoadError, Pill, Skeleton, EmptyState, useLoadState } from '@seidr/kit';
import { useAppT } from '../i18n';
import {
  fetchAgents, filterAgents, harnessCounts, HARNESS_NONE, setAgentHarness, type AgentRow, type AgentsData,
} from './agents';
import './Admin.css';

export interface AgentsScreenProps {
  /** Подмена fetch (тесты). */
  fetchImpl?: typeof fetch;
}

export function AgentsScreen({ fetchImpl }: AgentsScreenProps) {
  const t = useAppT();
  const res = useLoadState<AgentsData>(signal => fetchAgents(signal, fetchImpl), [fetchImpl], { rows: d => d.rows });
  const [harness, setHarness] = useState<string | null>(null);
  const data = res.data;
  const counts = useMemo(() => (data ? harnessCounts(data.rows, data.registry) : []), [data]);
  const rows = useMemo(() => (data ? filterAgents(data.rows, harness) : []), [data, harness]);
  const label = (k: string) => (k === HARNESS_NONE ? t('admin.harness.none') : k);

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
        {data.registry === null && <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-no-registry">{t('admin.harness.noRegistry')}</p>}
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-agents">
            <thead>
              <tr>
                <th scope="col">{t('admin.col.agent')}</th>
                <th scope="col">{t('admin.col.harness')}</th>
                <th scope="col">{t('admin.col.machine')}</th>
                <th scope="col">{t('admin.col.owner')}</th>
                <th scope="col">{t('admin.col.profile')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <AgentLine key={r.actor_id} row={r} registry={data.registry} fetchImpl={fetchImpl} onSaved={res.reload} />
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

function AgentLine({ row, registry, fetchImpl, onSaved }: {
  row: AgentRow; registry: string[] | null; fetchImpl?: typeof fetch; onSaved: () => void;
}) {
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
            {registry.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        ) : row.harness ? <Pill variant="id">{row.harness}</Pill> : <span className="adm-missing">{t('admin.harness.none')}</span>}
        {err && <span className="adm-err" role="alert">{err}</span>}
      </td>
      <td>{row.machine_id ? <span className="adm-mono">{row.machine_id}</span> : <span className="adm-missing">{t('admin.machine.none')}</span>}</td>
      <td>{row.owner_display_name ?? row.owner_kc_sub ?? <span className="adm-missing">{t('admin.owner.none')}</span>}</td>
      <td><span className="adm-mono">{row.client_id ?? '—'}</span>{row.agent_role && <span className="adm-role"> · {row.agent_role}</span>}</td>
    </tr>
  );
}
