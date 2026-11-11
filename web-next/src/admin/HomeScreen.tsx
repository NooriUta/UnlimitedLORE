// Главная админки «что требует внимания» (SPRINT_UXR_S7B_ADMIN/S7B-26,
// прототип docs/prototypes/s7b-admin-v6.html, экран «Главная»).
//
// Первое, что видно при входе в модуль: не «вся информация», а сломанное и
// недоделанное. Каждая карточка — число и кнопка в экран, который это чинит,
// уже с фильтром. Каждая карточка читает СВОЙ источник и честна отдельно:
// «в порядке» — только когда источник ответил; 403 и сбой — своими словами,
// и падение одного источника не гасит остальные карточки.
import type { ReactNode } from 'react';
import { Skeleton, useKitLang, useLoadState } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { useAdminNav, type AdminTab } from './adminNav';
import { AGENTS_NO_MACHINE, fetchAgents, type AgentsData } from './agents';
import { fetchMcp, type McpData } from './mcp';
import { fetchRoleMatrix, type RolesData } from './roles';
import { agentsWithoutMachine, mcpFailureTotal, peopleWithoutProjects } from './home';
import './Admin.css';

export interface AdminHomeProps {
  fetchImpl?: typeof fetch;
}

type CardState =
  | { kind: 'loading' }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'error'; reason: string }
  | { kind: 'ok'; n: number; note?: string };

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

/** Состояние карточки по ответу хука: данные есть — счёт; нет — 403 / сбой / ждём. */
function cardOf<T>(res: { state: string; data: T | undefined; error: unknown }, count: (d: T) => CardState): CardState {
  if (res.data !== undefined) return count(res.data);
  const e = res.error;
  if (res.state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403))) {
    return { kind: 'forbidden', reason: reasonOf(e) };
  }
  if (e !== undefined && e !== null) return { kind: 'error', reason: reasonOf(e) };
  return { kind: 'loading' };
}

export function AdminHome({ fetchImpl }: AdminHomeProps) {
  const t = useAppT();
  const lang = useKitLang();
  const nav = useAdminNav();
  const agents = useLoadState<AgentsData>(s => fetchAgents(s, fetchImpl, lang), [fetchImpl, lang], { rows: d => d.rows });
  const roles = useLoadState<RolesData>(s => fetchRoleMatrix(s, fetchImpl), [fetchImpl], { rows: d => d.people });
  const mcp = useLoadState<McpData>(s => fetchMcp(Date.now(), s, fetchImpl), [fetchImpl], { rows: d => d.profiles });
  const partial = t('admin.home.partial');

  const noMachine = cardOf(agents, d => ({
    kind: 'ok', n: agentsWithoutMachine(d.rows).length, note: d.truncated ? partial : undefined,
  }));
  const noProjects = cardOf(roles, d => ({
    kind: 'ok', n: peopleWithoutProjects(d).length, note: d.truncated ? partial : undefined,
  }));
  const mcpFail = cardOf(mcp, d => {
    const f = mcpFailureTotal(d);
    if (f.n === null) return { kind: 'error', reason: d.failError ?? '' };
    return { kind: 'ok', n: f.n, note: f.n > 0 ? t('admin.home.mcpFailProfiles', { n: f.profiles }) : undefined };
  });

  const go = (tab: AdminTab, params?: Record<string, string | null>) => () => nav.go(tab, params);

  return (
    <section className="adm" aria-labelledby="adm-home-h">
      <h2 id="adm-home-h" className="adm-h">{t('admin.home.title')}</h2>
      <p className="adm-lead">{t('admin.home.lead')}</p>
      <div className="adm-attn" role="list" aria-label={t('admin.home.attn')}>
        <AttnCard id="nomachine" st={noMachine} title={t('admin.home.noMachine')} hint={t('admin.home.noMachineHint')}
          fix={t('admin.home.noMachineFix')} onFix={go('agents', { 'adm-agents-f': AGENTS_NO_MACHINE })} onRetry={agents.reload} />
        <AttnCard id="mcpfail" st={mcpFail} title={t('admin.home.mcpFail')} hint={t('admin.home.mcpFailHint')}
          fix={t('admin.home.mcpFailFix')} onFix={go('mcp')} onRetry={mcp.reload} tone="dng" />
        <AttnCard id="noprojects" st={noProjects} title={t('admin.home.noProjects')} hint={t('admin.home.noProjectsHint')}
          fix={t('admin.home.noProjectsFix')} onFix={go('roles')} onRetry={roles.reload} />
      </div>
      <h3 className="adm-access__h">{t('admin.home.start')}</h3>
      <div className="adm-chips" data-testid="adm-home-start">
        <StartBtn id="person" onClick={go('roles')}>{t('admin.home.goPerson')}</StartBtn>
        <StartBtn id="laptop" onClick={go('agents', { 'adm-agents-f': AGENTS_NO_MACHINE })}>{t('admin.home.goLaptop')}</StartBtn>
        <StartBtn id="who" onClick={go('who')}>{t('admin.home.goWho')}</StartBtn>
        <StartBtn id="log" onClick={go('log')}>{t('admin.home.goLog')}</StartBtn>
      </div>
    </section>
  );
}

function StartBtn({ id, onClick, children }: { id: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="adm-btn" data-testid={`adm-home-go-${id}`} onClick={onClick}>{children}</button>;
}

function AttnCard({ id, st, title, hint, fix, onFix, onRetry, tone = 'wrn' }: {
  id: string; st: CardState; title: string; hint: string; fix: string;
  onFix: () => void; onRetry: () => void; tone?: 'wrn' | 'dng';
}) {
  const t = useAppT();
  const n = st.kind === 'ok' ? st.n : undefined;
  const cardTone = st.kind === 'ok' ? (st.n > 0 ? tone : 'suc') : st.kind === 'loading' ? undefined : 'dng';
  return (
    <article className="adm-attn__card" role="listitem" data-testid={`adm-home-${id}`} data-state={st.kind}
      data-n={n === undefined ? undefined : String(n)} data-tone={cardTone}>
      <span className="adm-attn__n" aria-hidden={n === undefined || undefined}>{n ?? '—'}</span>
      <span className="adm-attn__t">{title}</span>
      {st.kind === 'loading' && <Skeleton lines={1} label={t('admin.home.loading')} />}
      {st.kind === 'ok' && st.n > 0 && (
        <>
          <span className="adm-hint">{hint}{st.note ? ` · ${st.note}` : ''}</span>
          <button type="button" className="adm-btn" onClick={onFix}>{fix}</button>
        </>
      )}
      {st.kind === 'ok' && st.n === 0 && (
        <span className="adm-hint">{t('admin.home.ok')}{st.note ? ` · ${st.note}` : ''}</span>
      )}
      {st.kind === 'forbidden' && (
        <span className="adm-note" data-tone="wrn" role="status">{t('admin.home.forbidden', { reason: st.reason })}</span>
      )}
      {st.kind === 'error' && (
        <>
          <span className="adm-note" data-tone="dng" role="alert">{t('admin.home.error', { reason: st.reason })}</span>
          <button type="button" className="adm-btn" onClick={onRetry}>{t('admin.home.retry')}</button>
        </>
      )}
    </article>
  );
}
