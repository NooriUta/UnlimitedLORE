// Блок «Последние отказы доступа» в «Журнале» админки v2 (SPRINT_UXR_S7B_ADMIN/
// S7B-31 п.4, решение 4а). Перенесён из старой вкладки v1 «Настройки» (AL-45).
// Источник назван на экране: буфер памяти до рестарта, а не аудит.
import { EmptyState, Forbidden, LoadError, Skeleton, useLoadState } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { DENIALS_SHOWN, fetchDenials, type DenialsData } from './denials';
import { MachineCell } from './machineMark';
import './Admin.css';

export interface KcDenialsProps {
  fetchImpl?: typeof fetch;
}

export function KcDenials({ fetchImpl }: KcDenialsProps) {
  const t = useAppT();
  const res = useLoadState<DenialsData>(signal => fetchDenials({ signal, fetchImpl }), [fetchImpl], { rows: d => d.rows });
  const data = res.data;
  const e = res.error;
  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={3} label={t('admin.denials.loading')} />;
  else if (!data && (res.state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)))) {
    body = (
      <div data-testid="adm-denials-forbidden">
        <Forbidden compact hint={t('admin.denials.forbidden')} reason={e instanceof LoreHttpError ? (e.detail || e.message) : undefined} />
      </div>
    );
  } else if (!data) body = <LoadError compact error={e} onRetry={res.reload} />;
  else if (data.rows.length === 0) {
    body = (
      <div data-testid="adm-denials-empty">
        <EmptyState compact title={t('admin.denials.empty')} />
      </div>
    );
  } else {
    const rows = data.rows.slice(0, DENIALS_SHOWN);
    body = (
      <>
        {data.rows.length > rows.length && (
          <p className="adm-note" data-tone="inf" role="status" data-testid="adm-denials-more">
            {t('admin.denials.more', { n: rows.length, total: data.rows.length })}
          </p>
        )}
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-denials">
            <caption className="sk-sr">{t('admin.denials.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.denials.col.when')}</th>
                <th scope="col">{t('admin.denials.col.method')}</th>
                <th scope="col">{t('admin.denials.col.path')}</th>
                <th scope="col">{t('admin.denials.col.status')}</th>
                <th scope="col">{t('admin.denials.col.error')}</th>
                <th scope="col">{t('admin.denials.col.role')}</th>
                <th scope="col">{t('admin.col.machine')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => {
                const when = kitMinute(d.ts);
                return (
                  <tr key={`${d.ts}|${i}`}>
                    <td>{when ? <span className="adm-mono" title={when.title}>{when.text}</span> : <span className="adm-missing">{d.ts || '—'}</span>}</td>
                    <td><span className="adm-mono">{d.method || '—'}</span></td>
                    <th scope="row"><span className="adm-mono">{d.path || '—'}</span></th>
                    <td><span className="adm-err adm-mono">{d.status ?? '—'}</span></td>
                    <td><span className="adm-mono">{d.error || '—'}</span></td>
                    <td><span className="adm-mono">{d.role || '—'}</span></td>
                    <td><MachineCell value={d.machine} testId="adm-denial-machine" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <section aria-labelledby="adm-denials-h">
      <h3 id="adm-denials-h" className="adm-access__h">{t('admin.denials.title')}</h3>
      <p className="adm-hint" data-testid="adm-denials-src">
        {t('admin.denials.src')}{data?.source ? ` (${data.source})` : ''}
      </p>
      {body}
    </section>
  );
}
