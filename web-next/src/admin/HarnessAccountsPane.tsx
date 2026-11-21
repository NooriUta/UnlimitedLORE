// «Гирлянда» — вкладка «Учётки harness» экрана Агентов (SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH, 1.18.2).
//
// Дерево «главная роль → младшие» по порядку модели (agent_profiles): у каждого узла — учётка KC
// (имя, включена, когда сменён секрет, «перешёл?») и действия: выпустить / сменить секрет / выключить-включить.
// «Выпустить» для роли выше главной недоступна, причина — словами сервера (тот же текст, что 409 выпуска).
// KC не настроен / недоступен — сказано словами, узлы «не смогли проверить», а не «учётки нет».
// Harness и выбранная роль — в адресе (?adm-harness=, ?adm-acc=). Секрет — только в SecretOnce.
import { useState, type CSSProperties } from 'react';
import { EmptyState, Forbidden, LoadError, Pill, SecretOnce, Skeleton, useKitLang, useLoadState, useUrlParam } from '@seidr/kit';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { InfisicalNote, RotateDanger } from './KcDanger';
import {
  fetchHarnessAccounts, fetchHarnessList, issueHarnessAccount, setAccountEnabled,
  type AccountNode, type HarnessAccountsData, type HarnessRef, type Issued,
} from './harnessAccounts';
import './Admin.css';

export interface HarnessAccountsPaneProps {
  fetchImpl?: typeof fetch;
}

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

const isForbidden = (state: string, e: unknown) =>
  state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403));

export function HarnessAccountsPane({ fetchImpl }: HarnessAccountsPaneProps) {
  const t = useAppT();
  const list = useLoadState<HarnessRef[]>(s => fetchHarnessList(s, fetchImpl), [fetchImpl]);
  const [hParam, setH] = useUrlParam('adm-harness');
  const [, setSel] = useUrlParam('adm-acc');
  if (list.state === 'loading' && !list.data) return <Skeleton lines={4} label={t('admin.hacc.loading')} />;
  if (!list.data && isForbidden(list.state, list.error)) return <Forbidden reason={reasonOf(list.error)} />;
  if (!list.data) return <LoadError error={list.error} onRetry={list.reload} />;
  if (list.data.length === 0) return <EmptyState title={t('admin.hacc.noHarness')} />;
  const codes = list.data.map(h => h.code);
  const harness = hParam && codes.includes(hParam) ? hParam : codes[0];
  return (
    <div data-testid="adm-hacc">
      <p className="adm-lead">{t('admin.hacc.lead')}</p>
      <div className="adm-chips" role="group" aria-label={t('admin.hacc.pick')}>
        {list.data.map(h => (
          <button key={h.code} type="button" className="adm-chip" aria-pressed={h.code === harness}
            data-testid={`adm-hacc-h-${h.code}`}
            onClick={() => { setH(h.code, { replace: true }); setSel(null, { replace: true }); }}>
            {h.code} {h.main && <b>{h.main}</b>}
          </button>
        ))}
      </div>
      <HarnessTree key={harness} harness={harness} fetchImpl={fetchImpl} />
    </div>
  );
}

function HarnessTree({ harness, fetchImpl }: { harness: string; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState<HarnessAccountsData>(s => fetchHarnessAccounts(harness, s, fetchImpl), [harness, fetchImpl], { rows: d => d.nodes });
  const [sel, setSel] = useUrlParam('adm-acc');
  const data = res.data;
  if (res.state === 'loading' && !data) return <Skeleton lines={6} label={t('admin.hacc.loading')} />;
  if (!data && isForbidden(res.state, res.error)) return <Forbidden reason={reasonOf(res.error)} />;
  if (!data) return <LoadError error={res.error} onRetry={res.reload} />;
  if (data.nodes.length === 0) return <EmptyState title={t('admin.hacc.noRoles')} />;
  return (
    <>
      {data.kc.state !== 'checked' && (
        <p className="adm-note" data-tone={data.kc.state === 'unavailable' ? 'dng' : 'wrn'} role="status"
          data-testid="adm-hacc-kc" data-kc={data.kc.state}>
          {t(data.kc.state === 'unavailable' ? 'admin.hacc.kcUnavailable' : 'admin.hacc.kcNotConfigured', { reason: data.kc.reason ?? '—' })}
        </p>
      )}
      {data.infisical === 'not_configured' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-hacc-noinfisical">{t('admin.hacc.infisicalOff')}</p>
      )}
      <ul className="adm-hacc-tree" role="tree" aria-label={t('admin.hacc.tree', { harness })} data-testid="adm-hacc-tree">
        {data.nodes.map(n => (
          <li key={n.role} role="treeitem" aria-level={n.level + 1} aria-selected={sel === n.role}
            data-role={n.role} data-account={n.account.state} className="adm-hacc-node"
            style={{ '--hacc-lvl': n.level } as CSSProperties}>
            <div className="adm-hacc-row">
              <button type="button" className="adm-link adm-hacc-name" data-testid="adm-hacc-select"
                aria-expanded={sel === n.role} onClick={() => setSel(sel === n.role ? null : n.role, { replace: true })}>
                {n.role}
              </button>
              {n.isMain && <span data-testid="adm-hacc-main"><Pill tone="acc">{t('admin.hacc.main')}</Pill></span>}
              <Pill variant="id">{n.clientId}</Pill>
              <AccountChip node={n} />
            </div>
            {sel === n.role && <NodeActions node={n} harness={harness} fetchImpl={fetchImpl} onChanged={res.reload} />}
          </li>
        ))}
      </ul>
    </>
  );
}

function AccountChip({ node }: { node: AccountNode }) {
  const t = useAppT();
  const a = node.account;
  if (a.state === 'unknown') return <Pill tone="t3" title={a.reason ?? undefined}>{t('admin.hacc.acc.unknown')}</Pill>;
  if (a.state === 'absent') return <Pill tone="t2">{t('admin.hacc.acc.absent')}</Pill>;
  return a.enabled ? <Pill tone="suc">{t('admin.hacc.acc.on')}</Pill> : <Pill tone="wrn">{t('admin.hacc.acc.off')}</Pill>;
}

function NodeActions({ node, harness, fetchImpl, onChanged }: {
  node: AccountNode; harness: string; fetchImpl?: typeof fetch; onChanged: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [rotating, setRotating] = useState(false);
  const a = node.account;

  const issue = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    issueHarnessAccount(node.role, harness, fetchImpl).then(
      r => { setIssued(r); setBusy(false); },
      (e: unknown) => { setError(reasonOf(e)); setBusy(false); },
    );
  };
  const toggle = (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAccountEnabled(node.clientId, on, fetchImpl).then(
      () => { setBusy(false); onChanged(); },
      (e: unknown) => { setError(reasonOf(e)); setBusy(false); },
    );
  };

  return (
    <section className="adm-card" data-testid="adm-hacc-actions" aria-label={t('admin.hacc.actions', { role: node.role })}>
      {node.about && <p className="adm-dim">{node.about}</p>}
      <p className="adm-sub">{t('admin.hacc.secretKey')} <code>{node.secretKey}</code></p>
      {a.state === 'unknown' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-hacc-unknown">
          {t('admin.hacc.unknownWhy', { reason: a.reason ?? '—' })}
        </p>
      )}
      {a.state === 'issued' && (
        <dl className="adm-hacc-facts">
          <dt>{t('admin.hacc.secretChanged')}</dt>
          <dd data-testid="adm-hacc-rotated">{a.rotatedAt ?? a.secretCreatedAt ?? t('admin.hacc.kcSilent')}</dd>
          <dt>{t('admin.hacc.switched')}</dt>
          <dd data-testid="adm-hacc-switched" data-seen={a.switched.seen === null ? 'unknown' : String(a.switched.seen)}>
            {a.switched.seen === true ? t('admin.hacc.switchedYes', { at: a.switched.at ?? '—' })
              : a.switched.seen === false ? (a.switched.reason ?? t('admin.hacc.switchedNo'))
                : t('admin.hacc.switchedUnknown', { reason: a.switched.reason ?? '—' })}
          </dd>
        </dl>
      )}
      <div className="adm-field--btns">
        {a.state !== 'issued' && (
          <button type="button" className="adm-btn" data-testid="adm-hacc-issue"
            disabled={busy || !node.issuable || a.state === 'unknown'}
            title={node.refusal ?? undefined} onClick={issue}>
            {t('admin.hacc.issue')}
          </button>
        )}
        {a.state === 'issued' && !rotating && (
          <>
            <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-hacc-rotate" onClick={() => setRotating(true)}>
              {t('admin.hacc.rotate')}
            </button>
            <button type="button" className="adm-btn" data-testid="adm-hacc-toggle" disabled={busy} onClick={() => toggle(!a.enabled)}>
              {t(a.enabled ? 'admin.hacc.disable' : 'admin.hacc.enable')}
            </button>
          </>
        )}
      </div>
      {!node.issuable && node.refusal && (
        <p className="adm-note" data-tone="wrn" role="note" data-testid="adm-hacc-refusal">{node.refusal}</p>
      )}
      {error && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-hacc-error">{error}</p>}
      {issued && (
        <div data-testid="adm-hacc-issued">
          <SecretOnce value={issued.secret} label={t('admin.hacc.secretLabel', { client: issued.clientId })} lang={lang}
            onClose={() => { setIssued(null); onChanged(); }} />
          <p className="adm-note" role="status">{t('admin.hacc.keyHint', { key: issued.secretKey ?? node.secretKey })}</p>
          <InfisicalNote outcome={issued.infisical} />
        </div>
      )}
      {rotating && <RotateDanger clientId={node.clientId} fetchImpl={fetchImpl} onClose={() => { setRotating(false); onChanged(); }} />}
    </section>
  );
}
