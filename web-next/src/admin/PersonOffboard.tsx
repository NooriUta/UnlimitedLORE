// UC-4 «Отключить человека» (SPRINT_UXR_S7B_ADMIN/S7B-20, прототип
// docs/prototypes/s7b-admin-v6.html, раздел UC-4): уход или компрометация.
//
// Вход — из раскрытой карточки человека в «Кто где» («Отключить…»), человек —
// в адресе (?adm-off=kc_sub), шаг — тоже (?adm-off-step=…).
//
//   1. Инвентаризация до действия: учётка KC, роли в проектах, агенты. У
//      каждого блока своё честное состояние: загрузка · не смогли проверить
//      (с причиной) · проверено и пусто · есть.
//   2. Снятие по блокам (kit Steps), каждый — дифф и ввод логина:
//        • роли — одной пачкой через DangerBatch (role/batch: dry_run → дифф →
//          применить → «Отменить»);
//        • учётки агентов — отключение в KC (agent-client/…/disable), дифф —
//          kit DiffPreview, итог — kit BatchUndo; отмены у сервера нет, и это
//          сказано ДО применения;
//        • realm-роли — существующий путь KcDanger (RealmRoleDanger).
//   3. «Последний админ» блокирует кнопку с объяснением словами сервера, а не
//      подтверждением: последний owner проекта (AL-100), последний носитель
//      admin в realm (AL-35), и «это вы».
//   4. Чего LORE сделать не может (выключить саму учётку KC) — блок «осталось
//      руками» у kit Steps.
import { useEffect, useMemo, useState } from 'react';
import {
  BatchUndo, DiffPreview, Pill, Skeleton, Steps, useKitLang,
  type BatchItemFail, type BatchResult, type DiffRow, type StepDef,
} from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { DangerBatch } from './DangerBatch';
import { RealmRoleDanger } from './KcDanger';
import { fetchAgents, type AgentRow } from './agents';
import { fetchRealmRoles, type RealmRoleOption } from './kc';
import { fetchRoleMatrix, type RoleChange, type RolesData } from './roles';
import { fetchKcClients, fetchKcUsers, reasonOf, type KcUser } from './wizards';
import {
  agentDiffRows, disableAgentClient, findKcAccount, offRoleItems, parseKcClients, realmItems, removeAllChanges,
  type KcClientState,
} from './offboard';
import './Admin.css';

/** Состояние одного источника: «не смогли» — со словами, почему. */
type Sec<T> =
  | { s: 'loading' }
  | { s: 'ok'; v: T }
  | { s: 'fail'; forbidden: boolean; reason: string };

function useSec<T>(load: () => Promise<T>, deps: readonly unknown[]): Sec<T> {
  const [sec, setSec] = useState<Sec<T>>({ s: 'loading' });
  useEffect(() => {
    let alive = true;
    setSec({ s: 'loading' });
    load().then(
      v => { if (alive) setSec({ s: 'ok', v }); },
      (e: unknown) => {
        if (!alive) return;
        const forbidden = e instanceof LoreHttpError && (e.status === 401 || e.status === 403);
        setSec({ s: 'fail', forbidden, reason: reasonOf(e) });
      },
    );
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return sec;
}

export interface PersonOffboardProps {
  person: { kc_sub: string; name: string };
  /** kc_sub смотрящего: себя отсюда не отключают. */
  meSub?: string | null;
  fetchImpl?: typeof fetch;
  onClose: () => void;
}

export function PersonOffboard({ person, meSub = null, fetchImpl, onClose }: PersonOffboardProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [reload, setReload] = useState(0);
  const again = () => setReload(n => n + 1);
  const self = meSub !== null && meSub === person.kc_sub;

  const roles = useSec<RolesData>(() => fetchRoleMatrix(undefined, fetchImpl), [fetchImpl, reload]);
  const agents = useSec<AgentRow[]>(() => fetchAgents(undefined, fetchImpl).then(d => d.rows), [fetchImpl, reload]);
  const users = useSec<KcUser[]>(() => fetchKcUsers(fetchImpl), [fetchImpl, reload]);
  const realm = useSec<RealmRoleOption[]>(() => fetchRealmRoles(fetchImpl), [fetchImpl]);
  const clients = useSec<KcClientState[]>(() => fetchKcClients(fetchImpl).then(parseKcClients), [fetchImpl, reload]);

  const roleItems = roles.s === 'ok' ? offRoleItems(roles.v, person.kc_sub) : [];
  const myAgents = agents.s === 'ok' ? agents.v.filter(a => a.owner_kc_subs.includes(person.kc_sub)) : [];
  const account = users.s === 'ok' ? findKcAccount(users.v, person.kc_sub, person.name) : null;

  const failNote = (sec: { forbidden: boolean; reason: string }, id: string) => (
    <p className="adm-note" data-tone="wrn" role="status" data-testid={id}>
      {t(sec.forbidden ? 'admin.off.forbidden' : 'admin.off.unchecked', { reason: sec.reason })}
    </p>
  );

  // ── 1. инвентаризация ───────────────────────────────────────────────────
  const invLine = (id: string, label: string, sec: Sec<unknown>, ok: () => { state: 'ok' | 'none'; text: string }) => {
    let state: string;
    let text: string;
    if (sec.s === 'loading') { state = 'loading'; text = t('admin.off.loading'); }
    else if (sec.s === 'fail') { state = 'fail'; text = t(sec.forbidden ? 'admin.off.forbidden' : 'admin.off.unchecked', { reason: sec.reason }); }
    else ({ state, text } = ok());
    return (
      <li data-testid={id} data-state={state}>
        <span className="adm-field__l">{label}</span>{' '}
        <span className={state === 'fail' ? 'adm-missing' : undefined}>{text}</span>
      </li>
    );
  };

  const inventory = (
    <div className="adm-card" role="group" aria-label={t('admin.off.inv')} data-testid="adm-off-inv">
      <span className="adm-field__l">{t('admin.off.inv', { name: person.name })}</span>
      <ul className="adm-list">
        {invLine('adm-off-inv-kc', t('admin.off.inv.kc'), users, () => account
          ? { state: 'ok', text: t(account.enabled ? 'admin.off.kc.on' : 'admin.off.kc.off', { login: account.username }) }
          : { state: 'none', text: t('admin.off.kc.none', { sub: person.kc_sub }) })}
        {invLine('adm-off-inv-roles', t('admin.off.inv.roles'), roles, () => roleItems.length
          ? { state: 'ok', text: t('admin.off.roles.n', { n: roleItems.length }) }
          : { state: 'none', text: t('admin.off.roles.none') })}
        {invLine('adm-off-inv-agents', t('admin.off.inv.agents'), agents, () => myAgents.length
          ? { state: 'ok', text: t('admin.off.agents.n', { n: myAgents.length }) }
          : { state: 'none', text: t('admin.off.agents.none') })}
      </ul>
    </div>
  );

  // ── 2. роли в проектах ─────────────────────────────────────────────────
  const [batch, setBatch] = useState<RoleChange[] | null>(null);
  const lastOwners = roleItems.filter(i => i.lastOwner);
  const rolesBlocked = self || lastOwners.length > 0;
  const rolesStep = () => {
    if (roles.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (roles.s === 'fail') return failNote(roles, 'adm-off-roles-fail');
    if (roleItems.length === 0) return <p className="adm-sub" data-testid="adm-off-roles-none">{t('admin.off.roles.none')}</p>;
    return (
      <>
        <table className="adm-table">
          <tbody>
            {roleItems.map(i => (
              <tr key={i.project}>
                <th scope="row"><span className="adm-mono">{i.project}</span></th>
                <td><Pill>{i.role || '—'}</Pill></td>
                <td>{i.lastOwner && <span className="adm-missing">{t('admin.off.lastOwnerShort')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lastOwners.length > 0 && (
          <div className="adm-note" data-tone="dng" role="status" data-testid="adm-off-roles-blocked">
            {lastOwners.map(i => <p key={i.project} className="adm-note__line">{t('admin.off.lastOwner', { project: i.project })}</p>)}
          </div>
        )}
        {!batch && (
          <div className="adm-filters">
            <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-off-roles-remove" disabled={rolesBlocked}
              onClick={() => { if (!rolesBlocked) setBatch(removeAllChanges(roleItems)); }}>
              {t('admin.off.roles.remove', { n: roleItems.length })}
            </button>
          </div>
        )}
        {/* Пачка заморожена на нажатии: перечитанные роли не сбивают дифф и окно отмены. */}
        {batch && <DangerBatch person={person} changes={batch} fetchImpl={fetchImpl} onClose={() => setBatch(null)} onChanged={again} />}
      </>
    );
  };

  // ── 3. агенты ──────────────────────────────────────────────────────────
  const clientsOrError: KcClientState[] | { error: string } = clients.s === 'ok'
    ? clients.v : { error: clients.s === 'fail' ? clients.reason : t('admin.off.loading') };
  const agentRows: DiffRow[] = useMemo(() => agentDiffRows(myAgents, clientsOrError, {
    noClient: t('admin.off.agents.noClient'),
    absent: t('admin.off.agents.absent'),
    failed: reason => t('admin.off.unchecked', { reason }),
  }), [agents, clients, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [agentsBusy, setAgentsBusy] = useState(false);
  const [agentsDone, setAgentsDone] = useState<BatchResult | null>(null);
  const disableAgents = async (rows: readonly DiffRow[]) => {
    if (agentsBusy || self) return;
    setAgentsBusy(true);
    const failed: BatchItemFail[] = [];
    for (const r of rows) {
      try { await disableAgentClient(r.id, fetchImpl); } catch (e) { failed.push({ id: r.id, text: r.text, reason: reasonOf(e) }); }
    }
    // Отмены у сервера нет — окна отмены нет: undoUntil null.
    setAgentsDone({ id: '', applied: rows.length - failed.length, total: rows.length, failed, undoUntil: null });
    setAgentsBusy(false);
    again();
  };
  const agentsStep = () => {
    if (agents.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (agents.s === 'fail') return failNote(agents, 'adm-off-agents-fail');
    if (myAgents.length === 0) return <p className="adm-sub" data-testid="adm-off-agents-none">{t('admin.off.agents.none')}</p>;
    return (
      <div data-testid="adm-off-agents">
        {agentsDone ? <BatchUndo batch={agentsDone} lang={lang} /> : (
          <>
            <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-off-agents-noundo">{t('admin.off.agents.noUndo')}</p>
            {clients.s === 'loading' ? <Skeleton lines={2} label={t('admin.off.loading')} /> : self
              ? <p className="adm-note" data-tone="dng" role="status">{t('admin.off.self')}</p>
              : (
                <DiffPreview rows={agentRows} onApply={rows => { void disableAgents(rows); }} busy={agentsBusy}
                  label={t('admin.off.agents.diff')} lang={lang}
                  confirm={{ word: person.name, label: t('admin.roles.danger.confirm', { name: person.name }) }} />
              )}
          </>
        )}
      </div>
    );
  };

  // ── 4. учётка KC ───────────────────────────────────────────────────────
  const [realmPending, setRealmPending] = useState<string | null>(null);
  const kcStep = () => {
    if (users.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (users.s === 'fail') return failNote(users, 'adm-off-kc-fail');
    if (!account) {
      return (
        <p className="adm-sub" data-testid="adm-off-kc-none">
          {t('admin.off.kc.none', { sub: person.kc_sub })}
          {/* GET /lore/kc/users отдаёт не больше 100 учёток: «не нашли» в полном списке — не то же, что в первой сотне. */}
          {users.v.length >= 100 && <span className="adm-missing"> {t('admin.off.kc.capped')}</span>}
        </p>
      );
    }
    if (realm.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (realm.s === 'fail') return failNote(realm, 'adm-off-realm-fail');
    const items = realmItems(account, realm.v, users.v);
    return (
      <>
        <p className="adm-sub">
          <span className="adm-mono">{account.username}</span>{' '}
          {account.roles.map(r => <Pill key={r}>{r}</Pill>)}
        </p>
        {items.length === 0 && <p className="adm-sub" data-testid="adm-off-realm-none">{t('admin.off.realm.none')}</p>}
        <ul className="adm-list">
          {items.map(i => {
            const blocked = self || i.lastAdmin || i.outOfBridge;
            return (
              <li key={i.role}>
                <button type="button" className="adm-btn adm-btn--dng" data-testid={`adm-off-realm-remove-${i.role}`} disabled={blocked}
                  onClick={() => { if (!blocked) setRealmPending(i.role); }}>
                  {t('admin.off.realm.remove', { role: i.role })}
                </button>
                {i.lastAdmin && <p className="adm-note" data-tone="dng" role="status" data-testid={`adm-off-realm-blocked-${i.role}`}>{t('admin.off.lastAdmin')}</p>}
                {i.outOfBridge && <p className="adm-note" data-tone="wrn" role="status" data-testid={`adm-off-realm-manual-${i.role}`}>{t('admin.off.realm.d11')}</p>}
                {realmPending === i.role && (
                  <RealmRoleDanger person={{ kc_sub: account.id, name: person.name }} role={i.role} action="remove" fetchImpl={fetchImpl}
                    onClose={() => setRealmPending(null)} onChanged={again} />
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  const steps: StepDef[] = [
    { key: 'roles', title: t('admin.off.step.roles'), render: rolesStep },
    { key: 'agents', title: t('admin.off.step.agents'), render: agentsStep },
    { key: 'kc', title: t('admin.off.step.kc'), render: kcStep },
  ];

  return (
    <section className="adm-danger" aria-labelledby="adm-off-h" data-testid="adm-off">
      <h3 id="adm-off-h" className="adm-danger__h">{t('admin.off.title', { name: person.name })}</h3>
      <p className="adm-sub">{t('admin.off.lead')}</p>
      {self && <p className="adm-note" data-tone="dng" role="status" data-testid="adm-off-self">{t('admin.off.self')}</p>}
      {inventory}
      <Steps steps={steps} urlKey="adm-off-step" lang={lang} flow="adm-off" onDone={onClose}
        manual={{ title: t('admin.off.manual.title'), items: [{ text: t('admin.off.manual.kc'), hint: t('admin.off.manual.kcHint') }] }} />
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-off-close" onClick={onClose}>{t('admin.off.close')}</button>
      </div>
    </section>
  );
}
