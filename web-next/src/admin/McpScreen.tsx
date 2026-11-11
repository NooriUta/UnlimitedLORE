// Экран «MCP» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-07): подключения и сбои по
// ПРОФИЛЯМ агентов. Сессии не различаем — так и сказано на экране (решение
// владелицы 10.11).
//
// Честные исходы, названные разными словами:
//   «на связи» / «не видели дольше суток» / «вызовов не видели»;
//   сбоев 0 / «сбои не смогли прочитать» (не 0);
//   «вызовов агентов не видели» (не «всё в порядке») / «нет прав» / сбой загрузки.
// Фильтр «только не видели» — в адресе (?adm-mcp-f=silent).
import { EmptyState, Forbidden, LoadError, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { fetchMcp, isSilent, type McpData, type McpHealth } from './mcp';
import './Admin.css';

export interface McpScreenProps {
  fetchImpl?: typeof fetch;
  /** «Сейчас» для порога молчания (тесты). */
  now?: number;
}

const HEALTH_LABEL: Record<McpHealth, AppKey> = {
  live: 'admin.mcp.health.live', stale: 'admin.mcp.health.stale', unseen: 'admin.mcp.health.unseen',
};

export function McpScreen({ fetchImpl, now }: McpScreenProps) {
  const t = useAppT();
  const res = useLoadState<McpData>(
    signal => fetchMcp(now ?? Date.now(), signal, fetchImpl),
    [fetchImpl, now],
    { rows: d => d.profiles },
  );
  const [filter, setFilter] = useUrlParam('adm-mcp-f');
  const onlySilent = filter === 'silent';
  const data = res.data;

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={5} label={t('admin.mcp.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={res.error instanceof Error ? res.error.message : undefined} />;
  else if (res.state === 'error' || !data) body = <LoadError error={res.error} onRetry={res.reload} />;
  else if (data.profiles.length === 0 && data.failError === null) {
    body = (
      // S7B-25: kit EmptyState, а не своя разметка; обёртка — метка для проверок.
      <div data-testid="adm-mcp-empty">
        <EmptyState title={t('admin.mcp.empty')} hint={t('admin.mcp.emptyHint')} />
      </div>
    );
  } else {
    const rows = onlySilent ? data.profiles.filter(isSilent) : data.profiles;
    body = (
      <>
        {data.failError !== null && (
          <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-mcp-fail-error">
            {t('admin.mcp.failError', { reason: data.failError })}
          </p>
        )}
        {data.truncated && <p className="adm-note" data-tone="wrn" role="status">{t('admin.mcp.truncated')}</p>}
        <div className="adm-chips" role="group" aria-label={t('admin.mcp.title')}>
          <button type="button" className="adm-chip" aria-pressed={onlySilent} data-testid="adm-mcp-only-silent"
            onClick={() => setFilter(onlySilent ? null : 'silent', { replace: true })}>
            {t('admin.mcp.onlySilent')} <b>{data.profiles.filter(isSilent).length}</b>
          </button>
        </div>
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-mcp">
            <caption className="sk-sr">{t('admin.mcp.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.mcp.col.profile')}</th>
                <th scope="col">{t('admin.mcp.col.health')}</th>
                <th scope="col">{t('admin.mcp.col.calls')}</th>
                <th scope="col">{t('admin.mcp.col.lastSeen')}</th>
                <th scope="col">{t('admin.mcp.col.failures')}</th>
                <th scope="col">{t('admin.mcp.col.lastFailure')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.caller} data-testid={`adm-mcp-${p.caller}`} data-health={p.health}>
                  <th scope="row"><span className="adm-mono">{p.caller}</span></th>
                  <td>
                    <span className={p.health === 'live' ? undefined : 'adm-missing'} data-testid="adm-mcp-health">
                      {t(HEALTH_LABEL[p.health])}
                    </span>
                  </td>
                  <td>{p.calls === null ? <span className="adm-missing">{t('admin.mcp.none')}</span> : <span className="adm-mono">{p.calls}</span>}</td>
                  <td><When ms={p.lastSeen} /></td>
                  <td>
                    <span data-testid="adm-mcp-failures" data-state={p.failures === null ? 'unknown' : 'known'}>
                      {p.failures === null
                        ? <span className="adm-missing">{t('admin.mcp.unknown')}</span>
                        : <span className="adm-mono">{p.failures}</span>}
                    </span>
                  </td>
                  <td><When ms={p.lastFailure} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <section className="adm" aria-labelledby="adm-mcp-h">
      <h2 id="adm-mcp-h" className="adm-h">{t('admin.mcp.title')}</h2>
      <p className="adm-lead">{t('admin.mcp.lead')}</p>
      <p className="adm-note" data-tone="inf" role="note" data-testid="adm-mcp-profiles-note">{t('admin.mcp.profilesNote')}</p>
      {body}
    </section>
  );
}

/** Отметка времени: epoch millis → kit-правило написания; нет отметки — прочерк. */
function When({ ms }: { ms: number | null }) {
  const t = useAppT();
  if (ms === null) return <span className="adm-dim">{t('admin.mcp.none')}</span>;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return <span className="adm-dim">{t('admin.mcp.none')}</span>;
  const iso = d.toISOString();
  return <span className="adm-mono" title={iso}>{kitMinute(iso)?.text ?? iso}</span>;
}
