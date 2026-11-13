// Блок «Включение аутентификации» на Главной админки (SPRINT_UXR_S7B_ADMIN/S7B-31
// п.4, решение 4а): чеклист из старой вкладки v1 «Настройки» — карточками рядом
// с «требует внимания». Каждая карточка — одна проверка сервера; «не смогли
// проверить» (число админов неизвестно) — своим словом и не зелёным.
import { Forbidden, LoadError, Skeleton, useLoadState } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { fetchPreflight, preflightChecks, type CheckState, type Preflight, type PreflightCheck } from './preflight';
import './Admin.css';

export interface AuthPreflightProps {
  fetchImpl?: typeof fetch;
}

const TONE: Record<CheckState, 'suc' | 'dng' | 'wrn'> = { ok: 'suc', fail: 'dng', unknown: 'wrn' };

export function AuthPreflight({ fetchImpl }: AuthPreflightProps) {
  const t = useAppT();
  const res = useLoadState<Preflight>(signal => fetchPreflight({ signal, fetchImpl }), [fetchImpl]);
  const pf = res.data;
  const e = res.error;
  let body;
  if (res.state === 'loading' && !pf) body = <Skeleton lines={2} label={t('admin.pf.loading')} />;
  else if (!pf && (res.state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)))) {
    body = (
      <div data-testid="adm-pf-forbidden">
        <Forbidden compact reason={e instanceof LoreHttpError ? (e.detail || e.message) : undefined} />
      </div>
    );
  } else if (!pf) body = <LoadError compact error={e} onRetry={res.reload} />;
  else {
    // PU-05: Главная — «только то, что сломано». Auth уже включён — чеклист
    // включения пройден: показываем статус и лишь проверки, которые сейчас не ок
    // (мост KC упал, scope не проверяется); «включать можно» — уже не вопрос.
    const checks = preflightChecks(pf).filter(c => !pf.auth_enabled || (c.id !== 'enable' && c.state !== 'ok'));
    body = (
      <>
        {checks.length > 0 && (
          <div className="adm-attn" role="list" aria-label={t('admin.pf.title')}>
            {checks.map(c => <CheckCard key={c.id} c={c} />)}
          </div>
        )}
        <p className="adm-sub" data-testid="adm-pf-auth">
          {pf.auth_enabled ? t('admin.pf.authOn') : t('admin.pf.authOff')}
        </p>
        {!pf.auth_enabled && <p className="adm-hint">{t('admin.pf.enableNote')}</p>}
        <p className="adm-hint">{t('admin.pf.activeProject')}</p>
      </>
    );
  }
  return (
    <section aria-labelledby="adm-pf-h" data-testid="adm-pf">
      <h3 id="adm-pf-h" className="adm-access__h">{t('admin.pf.title')}</h3>
      {body}
    </section>
  );
}

function CheckCard({ c }: { c: PreflightCheck }) {
  const t = useAppT();
  let title: string;
  let sub: string;
  switch (c.id) {
    case 'admins':
      title = t('admin.pf.admins');
      // PU-05: «Заведите себя» — только когда админов нет; при n ≥ 1 это противоречие.
      sub = c.state === 'unknown' ? t('admin.pf.adminsUnknown')
        : c.n > 0 ? t('admin.pf.adminsHave', { n: c.n }) : t('admin.pf.adminsN', { n: c.n });
      break;
    case 'kc':
      title = t('admin.pf.kc');
      sub = c.why === 'ok' ? t('admin.pf.kcOk') : c.why === 'off' ? t('admin.pf.kcOff') : t('admin.pf.kcDown', { err: c.error || '—' });
      break;
    case 'scope':
      title = t('admin.pf.scope');
      sub = c.state === 'ok' ? t('admin.pf.scopeOn') : t('admin.pf.scopeOff');
      break;
    case 'enable':
      title = c.state === 'ok' ? t('admin.pf.canEnable') : t('admin.pf.cantEnable');
      sub = c.hint;
      break;
  }
  return (
    <article className="adm-attn__card" role="listitem" data-testid={`adm-pf-${c.id}`} data-state={c.state} data-tone={TONE[c.state]}>
      <span className="adm-attn__t">{title}</span>
      <span className="adm-hint">{c.state === 'unknown' ? `${t('admin.pf.unknown')} · ${sub}` : sub}</span>
    </article>
  );
}
