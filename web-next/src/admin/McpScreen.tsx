// Экран «MCP» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-07): подключения и сбои по
// ПРОФИЛЯМ агентов. Сессии не различаем — так и сказано на экране (решение
// владелицы 10.11).
//
// Честные исходы, названные разными словами:
//   «на связи» / «не видели дольше суток» / «вызовов не видели»;
//   сбоев 0 / «сбои не смогли прочитать» (не 0);
//   «вызовов агентов не видели» (не «всё в порядке») / «нет прав» / сбой загрузки.
// Фильтры — в адресе: ?adm-mcp-f=silent («только не видели») и =failures («только с отказами»;
// с ним ведёт карточка Главной). Ниже — сами отказы построчно (S7B-30): столько, сколько насчитано.
import { EmptyState, Forbidden, LoadError, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { QuickCommands } from './QuickCommands';
import {
  fetchMcp, fetchMcpFailureRows, isSilent, MCP_ONLY_FAILURES, type McpData, type McpFailureRowsData, type McpHealth,
} from './mcp';
import { mcpFailureTotal } from './home';
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
  const onlyFailures = filter === MCP_ONLY_FAILURES;
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
    const rows = onlySilent ? data.profiles.filter(isSilent)
      : onlyFailures ? data.profiles.filter(p => (p.failures ?? 0) > 0)
      : data.profiles;
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
          <button type="button" className="adm-chip" aria-pressed={onlyFailures} data-testid="adm-mcp-only-failures"
            onClick={() => setFilter(onlyFailures ? null : MCP_ONLY_FAILURES, { replace: true })}>
            {t('admin.mcp.onlyFailures')} <b>{data.profiles.filter(p => (p.failures ?? 0) > 0).length}</b>
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
      {data && <FailureRows fetchImpl={fetchImpl} total={mcpFailureTotal(data).n} />}
      {/* S7B-31 п.5а: быстрые команды подключения — из старой вкладки v1. */}
      <QuickCommands />
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

/**
 * Отказы записей агентов ПОСТРОЧНО (S7B-30) — детализация карточки Главной
 * «N отказов ≥ 400». Тот же ряд и то же условие, что у счётчика (mcp_failure_rows
 * ↔ mcp_failures), поэтому строк столько же, сколько насчитано; меньше — только
 * под пределом выдачи, и это сказано словами «показаны N из M».
 * Честные исходы: ноль — «отказов нет»; не прочитали — «не смогли», а не пусто.
 */
function FailureRows({ fetchImpl, total }: { fetchImpl?: typeof fetch; total: number | null }) {
  const t = useAppT();
  const res = useLoadState<McpFailureRowsData>(
    signal => fetchMcpFailureRows(signal, fetchImpl),
    [fetchImpl],
    { rows: d => d.rows },
  );
  const data = res.data;

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={3} label={t('admin.mcp.fails.loading')} />;
  else if (!data) {
    const reason = res.error instanceof Error ? res.error.message : String(res.error ?? '');
    body = (
      <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-mcp-fails-error">
        {t('admin.mcp.fails.error', { reason })}
      </p>
    );
  } else if (data.rows.length === 0 && (total === 0 || total === null)) {
    body = (
      <div data-testid="adm-mcp-fails-empty">
        <EmptyState title={t('admin.mcp.fails.empty')} hint={t('admin.mcp.fails.emptyHint')} />
      </div>
    );
  } else {
    const short = data.truncated || (total !== null && data.rows.length < total);
    body = (
      <>
        <p className="adm-note" data-tone={short ? 'wrn' : 'inf'} role="status" data-testid="adm-mcp-fails-count">
          {total === null
            ? t('admin.mcp.fails.shownNoTotal', { n: data.rows.length })
            : t('admin.mcp.fails.shown', { n: data.rows.length, m: total })}
        </p>
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-mcp-fails-table">
            <caption className="sk-sr">{t('admin.mcp.fails.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.mcp.fails.col.ts')}</th>
                <th scope="col">{t('admin.mcp.col.profile')}</th>
                <th scope="col">{t('admin.mcp.fails.col.family')}</th>
                <th scope="col">{t('admin.mcp.fails.col.entity')}</th>
                <th scope="col">{t('admin.mcp.fails.col.code')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.ts ?? 'x'}-${i}`} data-testid={`adm-mcp-fail-row-${i}`}>
                  <td><When ms={r.ts} /></td>
                  <td>{r.caller === null ? <span className="adm-missing">{t('admin.mcp.none')}</span> : <span className="adm-mono">{r.caller}</span>}</td>
                  <td>{r.family === null ? <span className="adm-dim">{t('admin.mcp.none')}</span> : <span className="adm-mono">{r.family}</span>}</td>
                  <td>{r.entity_id === null ? <span className="adm-dim">{t('admin.mcp.none')}</span> : <span className="adm-mono">{r.entity_id}</span>}</td>
                  <td><span className="adm-outcome adm-mono" data-outcome="refused">{r.status ?? t('admin.mcp.none')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="adm-mcp-fails-h" data-testid="adm-mcp-fails">
      <h3 id="adm-mcp-fails-h" className="adm-access__h">{t('admin.mcp.fails.title')}</h3>
      {body}
    </section>
  );
}
