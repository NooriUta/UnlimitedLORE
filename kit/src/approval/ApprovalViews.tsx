// K-11 (SPRINT_UXR_S10_SEIDR_KIT): UI ролей и согласования двумя людьми.
//  - EditGate      — роль без правки не видит элементов правки (прячем, а не
//                    выключаем), вместо них — пилюля «Только чтение» с причиной;
//  - StatusActions — смена статуса с учётом allow и selfApprove:false;
//                    запрещённый переход виден выключенным с причиной словами;
//                    отказ сервера (onSave бросил) — role=alert, не тихий успех;
//  - ApprovalJournal — журнал записи «предложил / согласовал».
// Стиль — единый слой seidr.css (классы sk-appr*), цели ≥ --tap.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { Pill } from '../elements/Pill';
import { kitT, useKitLang } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { EmptyState } from '../states/StateViews';
import { checkTransition, journalRows, rolePerms } from './approval';
import type { ApprovalCtx, DenyReason } from './approval';
import { kitMinute } from '../core/fmtValue';

const DENY_KEY: Record<DenyReason, KitKey> = {
  readonly: 'kit.appr.deny.readonly',
  role: 'kit.appr.deny.role',
  self: 'kit.appr.deny.self',
  'no-user': 'kit.appr.deny.noUser',
  'unknown-status': 'kit.appr.deny.unknownStatus',
  same: 'kit.appr.deny.same',
};

export function denyText(lang: KitLang, reason: DenyReason, role?: string): string {
  return kitT(lang, DENY_KEY[reason], { role: role ?? '—' });
}

function ReadOnlyPill({ ctx }: { ctx: ApprovalCtx }) {
  const lang = useKitLang();
  const perms = rolePerms(ctx.config, ctx.role);
  const hint = perms.known ? kitT(lang, 'kit.appr.readonlyHint', { role: ctx.role ?? '—' }) : kitT(lang, 'kit.appr.unknownRole');
  return (
    <span className="sk-appr-ro" data-readonly={perms.known ? 'role' : 'unknown-role'}>
      <Pill tone="t3" title={hint}>{kitT(lang, 'kit.appr.readonly')}</Pill>
      {!perms.known && <span className="sk-appr-ro__hint">{hint}</span>}
    </span>
  );
}

export interface EditGateProps {
  ctx: ApprovalCtx;
  children: ReactNode;
  /** Что показать вместо правки; по умолчанию — пилюля «Только чтение». */
  fallback?: ReactNode;
}

/** Правка только для ролей с canEdit; остальным — «Только чтение». */
export function EditGate({ ctx, children, fallback }: EditGateProps) {
  if (rolePerms(ctx.config, ctx.role).canEdit) return <>{children}</>;
  return <>{fallback ?? <ReadOnlyPill ctx={ctx} />}</>;
}

export interface StatusActionsProps {
  ctx: ApprovalCtx;
  record: KitRecord;
  /** Сохранение перехода; по умолчанию — config.hooks.onSave({type:'status', …}). */
  onSet?: (to: string) => Promise<void>;
}

export function StatusActions({ ctx, record, onSet }: StatusActionsProps) {
  const lang = useKitLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const perms = rolePerms(ctx.config, ctx.role);
  if (!perms.canStatus) return <ReadOnlyPill ctx={ctx} />;

  const save = onSet ?? (async (to: string) => {
    await ctx.config.hooks?.onSave?.({ type: 'status', id: record.id, field: 'status', from: record.status, to });
  });
  const fourEyesOn = ctx.config.statuses.selfApprove === false;
  const items = ctx.config.statuses.items.filter(s => s.code !== record.status);

  async function run(to: string) {
    setBusy(to);
    setError(null);
    try {
      await save(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sk-appr" role="group" aria-label={kitT(lang, 'kit.appr.actions')}>
      <ul className="sk-appr__list">
        {items.map(s => {
          const check = checkTransition(ctx, record, s.code);
          const reasonId = `sk-appr-${record.id}-${s.code}`;
          const style = { '--appr-c': s.color } as CSSProperties;
          return (
            <li key={s.code} className="sk-appr__item">
              <button
                type="button"
                className="sk-btn sk-appr__btn"
                style={style}
                disabled={!check.ok || busy !== null}
                data-status={s.code}
                data-deny={check.ok ? undefined : check.reason}
                aria-describedby={check.ok ? undefined : reasonId}
                aria-busy={busy === s.code || undefined}
                onClick={() => { void run(s.code); }}
              >
                <GameIcon slug={s.icon} size={14} />
                <span>{s.title}</span>
              </button>
              {!check.ok && (
                <span id={reasonId} className="sk-appr__reason">{denyText(lang, check.reason, ctx.role)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {busy && <span className="sk-appr__note" role="status">{kitT(lang, 'kit.appr.saving')}</span>}
      {error && <p className="sk-appr__error" role="alert">{kitT(lang, 'kit.appr.saveFailed', { reason: error })}</p>}
      {fourEyesOn && <p className="sk-appr__note">{kitT(lang, 'kit.appr.fourEyes')}</p>}
    </div>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export interface ApprovalJournalProps {
  ctx: ApprovalCtx;
  recordId: string;
}

export function ApprovalJournal({ ctx, recordId }: ApprovalJournalProps) {
  const lang = useKitLang();
  const rows = journalRows(ctx.data.journal, recordId, ctx.config.statuses.selfApprove !== false);
  const title = kitT(lang, 'kit.appr.journal.title');
  if (rows.length === 0) {
    return (
      <EmptyState compact title={kitT(lang, 'kit.appr.journal.empty')} hint={kitT(lang, 'kit.appr.journal.emptyHint')} />
    );
  }
  return (
    <table className="sk-appr-log" aria-label={title}>
      <thead>
        <tr>
          <th scope="col">{kitT(lang, 'kit.appr.journal.when')}</th>
          <th scope="col">{kitT(lang, 'kit.appr.journal.field')}</th>
          <th scope="col">{kitT(lang, 'kit.appr.journal.change')}</th>
          <th scope="col">{kitT(lang, 'kit.appr.journal.proposed')}</th>
          <th scope="col">{kitT(lang, 'kit.appr.journal.approved')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.at}-${r.field}-${i}`} data-state={r.state}>
            <td className="sk-appr-log__mono" title={kitMinute(r.at)?.title}>{kitMinute(r.at)?.text ?? '—'}</td>
            <td className="sk-appr-log__mono">{r.field}</td>
            <td className="sk-appr-log__change">{show(r.from)} → {show(r.to)}</td>
            <td>
              {r.proposedBy}
              {r.proposedByAgent && <> <Pill tone="inf">{kitT(lang, 'kit.appr.journal.agent')}</Pill></>}
            </td>
            <td>
              {r.state === 'pending' && <span className="sk-appr-log__pending">{kitT(lang, 'kit.appr.journal.pending')}</span>}
              {r.state === 'approved' && r.approvedBy}
              {r.state === 'self-approved' && (
                <span className="sk-appr-log__bad">{r.approvedBy} — {kitT(lang, 'kit.appr.journal.selfApproved')}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
