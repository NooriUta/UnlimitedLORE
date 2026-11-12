// Детектор 403 на Главной админки (SPRINT_UXR_S7B_ADMIN/S7B-21, UC-3).
//
// «Почему не видит» — самый частый вопрос админки; карточка отвечает, есть ли
// он сейчас: сколько записей агентов сервер отклонил кодом 403 за последние
// сутки (срез mcp_failures с параметрами since и code — S7B-26), и ведёт в
// экран «Кто где» на вопрос «почему» по инструменту. Карточка отдельным
// файлом: Главная подключает её одной строкой. Срез не прочитан — «не смогли
// проверить», а не «0».
import { Skeleton, useLoadState } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { useAdminNav } from './adminNav';
import { fetch403Day } from './whyAccess';
import { WHY_MODE } from './WhyNotSee';

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

export function Home403Card({ fetchImpl, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number }) {
  const t = useAppT();
  const nav = useAdminNav();
  const res = useLoadState(s => fetch403Day(now(), s, fetchImpl), [fetchImpl]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = res.data;
  const e = res.error;
  const forbidden = !d && (res.state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)));
  const state = d ? 'ok' : forbidden ? 'forbidden' : e !== undefined && e !== null ? 'error' : 'loading';
  const tone = d ? (d.n > 0 ? 'dng' : 'suc') : state === 'loading' ? undefined : 'dng';
  return (
    <article className="adm-attn__card" role="listitem" data-testid="adm-home-403" data-state={state}
      data-n={d ? String(d.n) : undefined} data-tone={tone}>
      <span className="adm-attn__n" aria-hidden={d === undefined || undefined}>{d ? d.n : '—'}</span>
      <span className="adm-attn__t">{t('admin.why.home403')}</span>
      {state === 'loading' && <Skeleton lines={1} label={t('admin.home.loading')} />}
      {d && d.n > 0 && (
        <>
          <span className="adm-hint">{t('admin.why.home403Hint', { n: d.profiles })}</span>
          <button type="button" className="adm-btn" data-testid="adm-home-403-fix"
            onClick={() => nav.go('who', { [WHY_MODE]: 'tool' })}>{t('admin.why.home403Fix')}</button>
        </>
      )}
      {d && d.n === 0 && <span className="adm-hint">{t('admin.home.ok')}</span>}
      {state === 'forbidden' && (
        <span className="adm-note" data-tone="wrn" role="status">{t('admin.home.forbidden', { reason: reasonOf(e) })}</span>
      )}
      {state === 'error' && (
        <>
          <span className="adm-note" data-tone="dng" role="alert">{t('admin.home.error', { reason: reasonOf(e) })}</span>
          <button type="button" className="adm-btn" onClick={res.reload}>{t('admin.home.retry')}</button>
        </>
      )}
    </article>
  );
}
