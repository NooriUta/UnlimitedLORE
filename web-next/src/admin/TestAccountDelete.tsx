// «Удалить» тестовую учётку агента / человека (SPRINT_LORE_ADMIN_POLISH/AP-01).
// Кнопка есть ТОЛЬКО у тестовых учёток (глоб D-2026-ONLY-TEST-PREFIXED-ACCOUNTS);
// у реальных её нет — только выключить. Перед применением — план сервера
// (dry_run): что уйдёт в Keycloak и в LORE; подтверждение — вводом clientId / логина.
// Пользователя Keycloak LORE не удаляет — это строка плана «остаётся».
import { useState } from 'react';
import { DiffPreview, Skeleton, useKitLang, useLoadState, type DiffRow } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { fetchKcUsers } from './wizards';
import {
  agentPlanRows, isTestAgentClient, isTestPersonLogin, personPlanRows, planBlockers, postTestDelete,
  type PlanWords, type TestDeleteKind,
} from './testDelete';

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

type Plan = { rows: DiffRow[]; blockers: string[]; word: string } | { error: string };

export interface TestDeleteProps {
  kind: TestDeleteKind;
  /** clientId агента или kc_sub человека. */
  id: string;
  fetchImpl?: typeof fetch;
  onDeleted?: () => void;
}

/** Кнопка → план → подтверждение → итог. Глоб уже проверен вызывающим (и ещё раз сервером). */
export function TestDeleteBlock({ kind, id, fetchImpl, onDeleted }: TestDeleteProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);

  const words: PlanWords = {
    kcClient: c => t('admin.testDel.kcClient', { id: c }),
    kcAbsent: c => t('admin.testDel.kcAbsent', { id: c }),
    kcServiceUser: n => t('admin.testDel.kcServiceUser', { name: n }),
    kcRoles: t('admin.testDel.kcRoles'),
    rolesUnread: t('admin.testDel.rolesUnread'),
    loreActor: a => t('admin.testDel.loreActor', { id: a }),
    owners: n => t('admin.testDel.owners', { names: n }),
    kcUserKept: n => t('admin.testDel.kcUserKept', { name: n }),
    loreUser: n => t('admin.testDel.loreUser', { name: n }),
    loreRole: (r, p) => t('admin.testDel.loreRole', { role: r, project: p }),
  };

  const openPlan = () => {
    setOpen(true);
    setPlan(null);
    setApplyError(null);
    postTestDelete(kind, id, true, fetchImpl).then(
      body => {
        const p = body.plan;
        setPlan({
          rows: kind === 'agent' ? agentPlanRows(p, words) : personPlanRows(p, words),
          blockers: planBlockers(p),
          word: kind === 'agent' ? id : String(body.username ?? id),
        });
      },
      (e: unknown) => setPlan({ error: reasonOf(e) }),
    );
  };

  const apply = () => {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    postTestDelete(kind, id, false, fetchImpl).then(
      body => { setDone(body); setApplying(false); onDeleted?.(); },
      (e: unknown) => { setApplyError(reasonOf(e)); setApplying(false); },
    );
  };

  if (!open) {
    return (
      <div className="adm-filters">
        <button type="button" className="adm-btn adm-btn--dng" data-testid={`adm-testdel-open-${id}`} onClick={openPlan}>
          {t('admin.testDel.open')}
        </button>
      </div>
    );
  }
  return (
    <section className="adm-danger" aria-label={t('admin.testDel.title')} data-testid={`adm-testdel-${id}`}>
      <h3 className="adm-danger__h">{t('admin.testDel.title')}</h3>
      <p className="adm-dim">{t('admin.testDel.lead')}</p>
      {plan === null && <Skeleton lines={2} label={t('admin.testDel.loading')} />}
      {plan && 'error' in plan && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-testdel-error">{t('admin.testDel.planError', { reason: plan.error })}</p>
      )}
      {plan && 'rows' in plan && !done && (
        <>
          {plan.blockers.length > 0 && (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-testdel-blocked">
              {t('admin.testDel.blocked', { reason: plan.blockers.join('; ') })}
            </p>
          )}
          <DiffPreview rows={plan.rows} onApply={plan.blockers.length ? undefined : apply} busy={applying}
            label={t('admin.testDel.diff')} lang={lang}
            confirm={{ word: plan.word, label: t('admin.testDel.confirm', { word: plan.word }) }} />
          {applyError && (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-testdel-applyerror">
              {t('admin.testDel.applyError', { reason: applyError })}
            </p>
          )}
        </>
      )}
      {done && (
        <p className="adm-note" data-tone="suc" role="status" data-testid="adm-testdel-done">
          {t(kind === 'agent' ? 'admin.testDel.doneAgent' : 'admin.testDel.donePerson')}
          {done.service_account_user_removed === false ? ` ${t('admin.testDel.saKept')}` : ''}
        </p>
      )}
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-testdel-close" onClick={() => setOpen(false)}>
          {done ? t('admin.roles.danger.done') : t('admin.roles.danger.cancel')}
        </button>
      </div>
    </section>
  );
}

/** Агент: кнопка только у тестового clientId. */
export function AgentTestDelete({ clientId, fetchImpl, onDeleted }: { clientId: string | null; fetchImpl?: typeof fetch; onDeleted?: () => void }) {
  if (!clientId || !isTestAgentClient(clientId)) return null;
  return <TestDeleteBlock kind="agent" id={clientId} fetchImpl={fetchImpl} onDeleted={onDeleted} />;
}

/**
 * Человек: логин LORE не хранит — берём его из учёток Keycloak (только чтение).
 * Логин не тестовый — кнопки нет; не смогли прочитать — так и сказано, а не тишина.
 */
export function PersonTestDelete({ kcSub, fetchImpl, onDeleted }: { kcSub: string; fetchImpl?: typeof fetch; onDeleted?: () => void }) {
  const t = useAppT();
  const users = useLoadState(() => fetchKcUsers(fetchImpl), [fetchImpl]);
  if (users.state === 'loading' && !users.data) return null;
  if (!users.data) {
    return <p className="adm-dim" data-testid="adm-testdel-unchecked">{t('admin.testDel.loginUnchecked')}</p>;
  }
  const login = users.data.find(u => u.id === kcSub)?.username ?? null;
  if (!isTestPersonLogin(login)) return null;
  return <TestDeleteBlock kind="person" id={kcSub} fetchImpl={fetchImpl} onDeleted={onDeleted} />;
}
