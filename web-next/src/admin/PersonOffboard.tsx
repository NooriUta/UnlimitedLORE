// UC-4 «Отключить человека» (SPRINT_UXR_S7B_ADMIN/S7B-20, прототип
// docs/prototypes/s7b-admin-v6.html, раздел UC-4): уход или компрометация.
//
// Вход — из паспорта человека в «Люди и их проекты» (S7B-28, «Отключить…»),
// человек — в адресе (?adm-off=kc_sub), шаг — тоже (?adm-off-step=…).
//
//   1. Инвентаризация до действия: учётка KC, роли в проектах, агенты,
//      машины (владеет / допущен — срез machine_acl по kc_sub). У
//      каждого блока своё честное состояние: загрузка · не смогли проверить
//      (с причиной) · проверено и пусто · есть.
//   2. Снятие по блокам (kit Steps), каждый — дифф и ввод логина:
//        • роли — одной пачкой через DangerBatch (role/batch: dry_run → дифф →
//          применить → «Отменить»);
//        • учётки агентов — отключение в KC (agent-client/…/disable), дифф —
//          kit DiffPreview, итог — kit BatchUndo; «Отменить» включает их
//          обратно (agent-client/…/enable, S7B-20);
//        • допуски к машинам — путь «Доступа к машинам» (AccessChange: план
//          сервера → дифф → revoke → отмена обратными запросами); владение
//          машиной запросом не снимается — оно в «осталось руками»;
//        • realm-роли — существующий путь KcDanger (RealmRoleDanger);
//        • сама учётка KC — выключить / включить обратно (POST
//          /lore/kc/user/{id}/enabled, S7B-20): дифф сервера → логин → «Отменить».
//   3. «Последний админ» — словами сервера, а не подтверждением: последний
//      owner проекта (AL-100) и последний включённый admin (AL-35) приходят
//      строкой «нельзя» в диффе сервера; «это вы» блокирует кнопки.
//   4. Чего LORE сделать не может (владение машиной) — блок «осталось
//      руками» у kit Steps.
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { AccessChange } from './MachinesScreen';
import type { AccessRequest, Machine } from './machines';
import {
  AGENTS_UNDO_MS, agentDiffRows, disableAgentClient, enableAgentClient, enabledPlanRows, fetchPersonMachineAcl, findKcAccount,
  offMachineItems, offRoleItems, parseEnabledAnswer, parseKcClients, postUserEnabled, realmItems, removeAllChanges,
  revokeMachineRequests,
  type EnabledAnswer, type KcClientState,
} from './offboard';
import './Admin.css';

/** Подписи harness в диффе допусков не нужны: снимается допуск целиком. */
const NO_LABELS: Record<string, string> = {};

/** Состояние одного источника: «не смогли» — со словами, почему. */
type Sec<T> =
  | { s: 'loading' }
  | { s: 'ok'; v: T }
  | { s: 'fail'; forbidden: boolean; reason: string };

function useSec<T>(load: () => Promise<T>, deps: readonly unknown[]): Sec<T> {
  const [sec, setSec] = useState<Sec<T>>({ s: 'loading' });
  useEffect(() => {
    let alive = true;
    // Перечитывание не прячет показанное: уже полученный ответ стоит до нового.
    // Сброс в «загрузку» пересоздавал блок (агенты: итог пачки с «Отменить»
    // мигал скелетоном, клик мог уйти в снятый узел) — offboard.test.tsx.
    setSec(prev => (prev.s === 'ok' ? prev : { s: 'loading' }));
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

/**
 * S7B-20: выключить / включить учётку человека в KC. Путь тот же, что у
 * остальных опасных действий: дифф сервера (dry_run) → ввод логина → применение
 * → «Отменить» в окне (обратный вызов с undo_of). «Последний админ» и «это вы» —
 * строкой «нельзя» в диффе словами сервера.
 */
function KcAccountEnabled({ userId, name, enable, fetchImpl, onChanged, onClose }: {
  userId: string; name: string; enable: boolean; fetchImpl?: typeof fetch; onChanged: () => void; onClose: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<EnabledAnswer | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const words = { disable: t('admin.off.kc.willDisable'), enable: t('admin.off.kc.willEnable') };

  useEffect(() => {
    let alive = true;
    postUserEnabled(userId, { enabled: enable, dry_run: true }, fetchImpl).then(
      body => { if (alive) setRows(enabledPlanRows(body, words)); },
      (e: unknown) => { if (alive) setPlanError(reasonOf(e)); },
    );
    return () => { alive = false; };
  }, [userId, enable]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (busy) return;
    setBusy(true);
    setApplyError(null);
    postUserEnabled(userId, { enabled: enable }, fetchImpl).then(
      body => { setAnswer(parseEnabledAnswer(body)); setBusy(false); onChanged(); },
      (e: unknown) => { setApplyError(reasonOf(e)); setBusy(false); },
    );
  };
  const undo = (id: string) => {
    if (!answer?.undo || undoing) return;
    setUndoing(true);
    setUndoError(null);
    postUserEnabled(userId, { ...answer.undo, undo_of: id }, fetchImpl).then(
      () => { setUndone(true); setUndoing(false); onChanged(); },
      (e: unknown) => { setUndoError(t('admin.roles.undoFailed', { reason: reasonOf(e) })); setUndoing(false); },
    );
  };

  return (
    <div className="adm-card" data-testid="adm-off-kc-enabled">
      {planError && <p className="adm-note" data-tone="wrn" role="status">{t('admin.off.unchecked', { reason: planError })}</p>}
      {!planError && !rows && <Skeleton lines={1} label={t('admin.off.loading')} />}
      {rows && !answer && (
        <DiffPreview rows={rows} onApply={apply} busy={busy} lang={lang}
          label={t(enable ? 'admin.off.kc.enableDiff' : 'admin.off.kc.disableDiff')}
          confirm={{ word: name, label: t('admin.roles.danger.confirm', { name }) }} />
      )}
      {applyError && <p className="adm-note" data-tone="dng" role="alert">{applyError}</p>}
      {answer && (
        <BatchUndo lang={lang} onUndo={answer.undo ? undo : undefined} undoing={undoing} undone={undone} undoError={undoError}
          batch={{ id: answer.opId, applied: 1, total: 1, failed: [], undoUntil: answer.undo ? answer.undoUntil : null }} />
      )}
      <div className="adm-filters">
        <button type="button" className="adm-btn" onClick={onClose}>{t('admin.off.close')}</button>
      </div>
    </div>
  );
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
  const machines = useSec<Machine[]>(() => fetchPersonMachineAcl(person.kc_sub, fetchImpl), [fetchImpl, person.kc_sub, reload]);

  const roleItems = roles.s === 'ok' ? offRoleItems(roles.v, person.kc_sub) : [];
  const machineItems = machines.s === 'ok' ? offMachineItems(machines.v, person.kc_sub) : { owned: [], granted: [] };
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
        {invLine('adm-off-inv-machines', t('admin.off.inv.machines'), machines, () => (machineItems.owned.length + machineItems.granted.length)
          ? { state: 'ok', text: t('admin.off.machines.n', { owned: machineItems.owned.length, granted: machineItems.granted.length }) }
          : { state: 'none', text: t('admin.off.machines.none') })}
      </ul>
    </div>
  );

  // ── 2. роли в проектах ─────────────────────────────────────────────────
  const [batch, setBatch] = useState<RoleChange[] | null>(null);
  const lastOwners = roleItems.filter(i => i.lastOwner);
  // S7B-20: отказ AL-100 сервер присылает строкой плана (dry_run) — пачка открывается,
  // запрещённые строки DiffPreview не применит. Подсказка из среза остаётся видна до диффа.
  const rolesBlocked = self;
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
    const failedIds = new Set(failed.map(x => x.id));
    setAgentsOff(rows.filter(r => !failedIds.has(r.id)).map(r => r.id));
    // S7B-20: обратное есть (agent-client/…/enable) — «Отменить» включает отключённые обратно.
    setAgentsDone({ id: 'agents-off', applied: rows.length - failed.length, total: rows.length, failed,
      undoUntil: rows.length > failed.length ? Date.now() + AGENTS_UNDO_MS : null });
    setAgentsBusy(false);
    again();
  };
  const [agentsOff, setAgentsOff] = useState<string[]>([]);
  const [agentsUndoing, setAgentsUndoing] = useState(false);
  const [agentsUndone, setAgentsUndone] = useState(false);
  const [agentsUndoError, setAgentsUndoError] = useState<string | null>(null);
  const enableAgentsBack = async () => {
    if (agentsUndoing) return;
    setAgentsUndoing(true);
    setAgentsUndoError(null);
    const fails: string[] = [];
    for (const id of agentsOff) {
      try { await enableAgentClient(id, fetchImpl); } catch (e) { fails.push(`${id}: ${reasonOf(e)}`); }
    }
    if (fails.length) setAgentsUndoError(t('admin.roles.undoFailed', { reason: fails.join('; ') }));
    else setAgentsUndone(true);
    setAgentsUndoing(false);
    again();
  };
  const agentsStep = () => {
    if (agents.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (agents.s === 'fail') return failNote(agents, 'adm-off-agents-fail');
    if (myAgents.length === 0) return <p className="adm-sub" data-testid="adm-off-agents-none">{t('admin.off.agents.none')}</p>;
    return (
      <div data-testid="adm-off-agents">
        {agentsDone ? (
          <BatchUndo batch={agentsDone} lang={lang} onUndo={() => { void enableAgentsBack(); }}
            undoing={agentsUndoing} undone={agentsUndone} undoError={agentsUndoError} />
        ) : (
          <>
            <p className="adm-note" role="status" data-testid="adm-off-agents-reversible">{t('admin.off.agents.reversible')}</p>
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
  /** null — панель закрыта; false — выключаем; true — включаем обратно. */
  const [kcToggle, setKcToggle] = useState<boolean | null>(null);
  const kcStep = () => {
    if (users.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (users.s === 'fail') return failNote(users, 'adm-off-kc-fail');
    if (!account) {
      return (
        <p className="adm-sub" data-testid="adm-off-kc-none">
          {/* S7B-20: сервер читает учётки постранично — «не нашли» значит по всему realm'у. */}
          {t('admin.off.kc.none', { sub: person.kc_sub })}
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
        {/* S7B-20: сама учётка — выключить (или включить обратно уже выключенную). */}
        {kcToggle === null && (
          <div className="adm-filters">
            {account.enabled ? (
              <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-off-kc-disable" disabled={self}
                onClick={() => { if (!self) setKcToggle(false); }}>
                {t('admin.off.kc.disable')}
              </button>
            ) : (
              <button type="button" className="adm-btn" data-testid="adm-off-kc-enable" onClick={() => setKcToggle(true)}>
                {t('admin.off.kc.enable')}
              </button>
            )}
          </div>
        )}
        {kcToggle !== null && (
          <KcAccountEnabled userId={account.id} name={person.name} enable={kcToggle} fetchImpl={fetchImpl}
            onChanged={again} onClose={() => setKcToggle(null)} />
        )}
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

  // ── 5. допуски к машинам (S7B-ACL-1) ───────────────────────────────────
  // Снятие — тем же путём, что в «Доступе к машинам» (AccessChange: план
  // сервера dry_run → дифф → пачка → отмена обратными запросами). Владение
  // запросом не снимается — оно в «осталось руками».
  const [machineReqs, setMachineReqs] = useState<AccessRequest[] | null>(null);
  const nameOfPerson = useCallback(() => person.name, [person.name]);
  const machineLabel = useCallback((req: AccessRequest) => req.machine_id, []);
  const machinesStep = () => {
    if (machines.s === 'loading') return <Skeleton lines={2} label={t('admin.off.loading')} />;
    if (machines.s === 'fail') return failNote(machines, 'adm-off-machines-fail');
    const { owned, granted } = machineItems;
    if (owned.length + granted.length === 0) return <p className="adm-sub" data-testid="adm-off-machines-none">{t('admin.off.machines.none')}</p>;
    return (
      <div data-testid="adm-off-machines">
        {owned.length > 0 && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-off-machines-owned">
            {t('admin.off.machines.owned', { list: owned.map(m => m.machine_id).join(', ') })}
          </p>
        )}
        {granted.length === 0
          ? <p className="adm-sub">{t('admin.off.machines.noGrants')}</p>
          : (
            <>
              <table className="adm-table">
                <tbody>
                  {granted.map(g => (
                    <tr key={g.machine.machine_id}>
                      <th scope="row"><span className="adm-mono">{g.machine.machine_id}</span></th>
                      <td><Pill>{g.role || '—'}</Pill></td>
                      <td>{g.projects.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!machineReqs && (
                <div className="adm-filters">
                  <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-off-machines-revoke" disabled={self}
                    onClick={() => { if (!self) setMachineReqs(revokeMachineRequests(machineItems, person.kc_sub)); }}>
                    {t('admin.off.machines.revoke', { n: granted.length })}
                  </button>
                </div>
              )}
              {/* Запросы заморожены на нажатии: перечитанный срез не сбивает план и окно отмены. */}
              {machineReqs && (
                <AccessChange requests={machineReqs} nameOf={nameOfPerson} labelOf={machineLabel} harnessLabels={NO_LABELS}
                  fetchImpl={fetchImpl} onChanged={again} onClose={() => setMachineReqs(null)} />
              )}
            </>
          )}
      </div>
    );
  };

  const steps: StepDef[] = [
    { key: 'roles', title: t('admin.off.step.roles'), render: rolesStep },
    { key: 'agents', title: t('admin.off.step.agents'), render: agentsStep },
    { key: 'machines', title: t('admin.off.step.machines'), render: machinesStep },
    { key: 'kc', title: t('admin.off.step.kc'), render: kcStep },
  ];
  // S7B-20: выключение учётки KC теперь делает LORE (шаг «Учётка Keycloak») — из «осталось руками» ушло.
  const manual = [
    ...machineItems.owned.map(m => ({ text: t('admin.off.manual.machine', { machine: m.machine_id }), hint: t('admin.off.manual.machineHint') })),
  ];

  return (
    <section className="adm-danger" aria-labelledby="adm-off-h" data-testid="adm-off">
      <h3 id="adm-off-h" className="adm-danger__h">{t('admin.off.title', { name: person.name })}</h3>
      <p className="adm-sub">{t('admin.off.lead')}</p>
      {self && <p className="adm-note" data-tone="dng" role="status" data-testid="adm-off-self">{t('admin.off.self')}</p>}
      {inventory}
      <Steps steps={steps} urlKey="adm-off-step" lang={lang} flow="adm-off" onDone={onClose}
        manual={{ title: t('admin.off.manual.title'), items: manual }} />
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-off-close" onClick={onClose}>{t('admin.off.close')}</button>
      </div>
    </section>
  );
}
