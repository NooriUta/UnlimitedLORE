// Экран «Флаги и версия» админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-08).
//
// Сразу видно: из какой сборки работает LORE (коммит, время сборки, версия
// схемы, тег релиза) и какие флаги стоят не по умолчанию. Изменённый флаг
// помечен, фильтр «только изменённые» — в адресе (?adm-flags=changed).
// Тег релиза не передан выкаткой и «не смогли прочитать» — разные слова.
import { EmptyState, Forbidden, LoadError, Pill, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT } from '../i18n';
import { fetchFlagsAndRelease, type FlagsData, type ReleaseInfo } from './flags';
import './Admin.css';

export interface FlagsScreenProps {
  fetchImpl?: typeof fetch;
}

type Loaded = FlagsData & { release: ReleaseInfo };

export function FlagsScreen({ fetchImpl }: FlagsScreenProps) {
  const t = useAppT();
  const [only, setOnly] = useUrlParam('adm-flags');
  const changedOnly = only === 'changed';
  const res = useLoadState<Loaded>(signal => fetchFlagsAndRelease({ signal, fetchImpl }), [fetchImpl], { rows: d => d.flags });
  const data = res.data;

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={6} label={t('admin.flags.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={res.error instanceof Error ? res.error.message : undefined} />;
  else if (res.state === 'error' || !data) body = <LoadError error={res.error} onRetry={res.reload} />;
  else {
    const rows = changedOnly ? data.flags.filter(f => f.overridden) : data.flags;
    const built = kitMinute(data.version.built_at);
    body = (
      <>
        <table className="adm-table" data-testid="adm-version">
          <tbody>
            <tr>
              <th scope="row">{t('admin.flags.commit')}</th>
              <td>{data.version.commit ? <span className="adm-mono">{data.version.commit}</span> : <span className="adm-missing">{t('admin.flags.unknown')}</span>}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.flags.builtAt')}</th>
              <td>{built ? <span className="adm-mono" title={built.title}>{built.text}</span> : <span className="adm-missing">{t('admin.flags.unknown')}</span>}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.flags.schema')}</th>
              <td>{data.version.schema_version !== null ? <span className="adm-mono">{String(data.version.schema_version)}</span> : <span className="adm-missing">{t('admin.flags.unknown')}</span>}</td>
            </tr>
            <tr>
              <th scope="row">{t('admin.flags.release')}</th>
              <td data-testid="adm-release" data-state={data.release.state}>
                {data.release.state === 'ok' && <Pill variant="id">{data.release.tag}</Pill>}
                {data.release.state === 'none' && <span className="adm-missing">{t('admin.flags.releaseNone')}</span>}
                {data.release.state === 'error' && <span className="adm-err">{t('admin.flags.releaseError', { reason: data.release.reason })}</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="adm-chips" role="group" aria-label={t('admin.flags.filter')}>
          <button type="button" className="adm-chip" aria-pressed={!changedOnly} data-testid="adm-flags-all"
            onClick={() => setOnly(null)}>{t('admin.flags.all')} <b>{data.flags.length}</b></button>
          <button type="button" className="adm-chip" aria-pressed={changedOnly} data-testid="adm-flags-changed"
            onClick={() => setOnly(changedOnly ? null : 'changed')}>
            {t('admin.flags.changed')} <b data-testid="adm-flags-overridden">{data.overridden}</b>
          </button>
        </div>
        {data.flags.length === 0 ? <EmptyState title={t('admin.flags.empty')} /> : rows.length === 0
          ? <p className="adm-note" data-tone="inf" role="status">{t('admin.flags.noneChanged')}</p>
          : (
            <div className="adm-tablewrap">
              <table className="adm-table" data-testid="adm-flags">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.col.flag')}</th>
                    <th scope="col">{t('admin.col.value')}</th>
                    <th scope="col">{t('admin.col.default')}</th>
                    <th scope="col">{t('admin.col.meaning')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(f => (
                    <tr key={f.key} data-testid={`adm-flag-${f.key}`} data-overridden={f.overridden || undefined}>
                      <th scope="row"><span className="adm-mono">{f.key}</span></th>
                      <td>
                        <span className="adm-flag" data-on={f.value}>{f.value ? t('admin.flags.on') : t('admin.flags.off')}</span>
                        {f.overridden && <span className="adm-me">{t('admin.flags.overridden')}</span>}
                      </td>
                      <td><span className="adm-dim">{f.def ? t('admin.flags.on') : t('admin.flags.off')}</span></td>
                      <td>{f.meaning ?? <span className="adm-missing">{t('admin.flags.noMeaning')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </>
    );
  }
  return (
    <section className="adm" aria-labelledby="adm-flags-h">
      <h2 id="adm-flags-h" className="adm-h">{t('admin.flags.title')}</h2>
      <p className="adm-lead">{t('admin.flags.lead')}</p>
      {body}
    </section>
  );
}
