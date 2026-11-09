// K-11 (SPRINT_UXR_S10_SEIDR_KIT): роли и согласование двумя людьми — чистая логика.
//
//  - roles[role] = {canEdit, canStatus}; без roles в конфиге ролевой модели нет
//    и всё разрешено. Если roles заданы, а роль не передана или не опознана —
//    только чтение и known:false: «не опознан» не равно «можно».
//  - statuses.items[].allow — роли, которым разрешено СТАВИТЬ этот статус
//    (нет allow — любой роли с canStatus).
//  - selfApprove:false (4-eyes): переход в статус категории done — это
//    согласование; автор последней несогласованной правки записи согласовать её
//    не может. Неизвестный пользователь — проверить нечем, отказ no-user.
//
// Это подсказка интерфейса, а не защита: окончательную проверку делает сервер
// потребителя («Дата-странники»), не kit и не бэкенд LORE.
import type { KitConfig, KitCtx, KitJournalEntry, KitRecord } from '../core/contract';
import { normalizeAxisCategory } from '../core/statusAxis';

export interface RolePerms {
  canEdit: boolean;
  canStatus: boolean;
  /** Роль найдена в config.roles (или ролевой модели нет вовсе). */
  known: boolean;
  /** Ни правки, ни смены статуса. */
  readOnly: boolean;
}

export function rolePerms(config: Pick<KitConfig, 'roles'>, role: string | undefined): RolePerms {
  const roles = config.roles;
  if (!roles) return { canEdit: true, canStatus: true, known: true, readOnly: false };
  const r = role !== undefined && Object.prototype.hasOwnProperty.call(roles, role) ? roles[role] : undefined;
  if (!r) return { canEdit: false, canStatus: false, known: false, readOnly: true };
  return { canEdit: r.canEdit, canStatus: r.canStatus, known: true, readOnly: !r.canEdit && !r.canStatus };
}

export type DenyReason = 'readonly' | 'role' | 'self' | 'no-user' | 'unknown-status' | 'same';

export type TransitionCheck =
  | { ok: true; fourEyes: false }
  | { ok: true; fourEyes: true; proposer?: string }
  | { ok: false; reason: DenyReason };

export type ApprovalCtx = Pick<KitCtx, 'config' | 'data' | 'role' | 'user'>;

/** Последняя несогласованная правка записи (кто предложил). */
export function pendingProposal(journal: readonly KitJournalEntry[], recordId: string): KitJournalEntry | undefined {
  let best: KitJournalEntry | undefined;
  for (const e of journal) {
    if (e.record_id !== recordId || e.approved_by) continue;
    if (!best || e.at > best.at) best = e;
  }
  return best;
}

/** Можно ли этому пользователю в этой роли перевести запись в статус `to`. */
export function checkTransition(ctx: ApprovalCtx, record: KitRecord, to: string): TransitionCheck {
  const perms = rolePerms(ctx.config, ctx.role);
  if (!perms.canStatus) return { ok: false, reason: 'readonly' };
  const item = ctx.config.statuses.items.find(s => s.code === to);
  if (!item) return { ok: false, reason: 'unknown-status' };
  if (to === record.status) return { ok: false, reason: 'same' };
  if (item.allow && (ctx.role === undefined || !item.allow.includes(ctx.role))) return { ok: false, reason: 'role' };
  // Закрытие определяем по оси, а не по слову 'done': модель присылает
  // 'finished', и сравнение со старым словом бесшумно отключило бы двойное
  // подтверждение — ничего бы не упало, просто правило перестало бы работать.
  const fourEyes = ctx.config.statuses.selfApprove === false
    && normalizeAxisCategory(item.category) === 'finished';
  if (!fourEyes) return { ok: true, fourEyes: false };
  const pending = pendingProposal(ctx.data.journal, record.id);
  if (!pending) return { ok: true, fourEyes: true };
  if (!ctx.user) return { ok: false, reason: 'no-user' };
  if (pending.who === ctx.user) return { ok: false, reason: 'self' };
  return { ok: true, fourEyes: true, proposer: pending.who };
}

export type JournalState = 'approved' | 'pending' | 'self-approved';

export interface JournalRow {
  at: string;
  field: string;
  from: unknown;
  to: unknown;
  proposedBy: string;
  proposedByAgent: boolean;
  approvedBy?: string;
  /** self-approved — согласовал сам при selfApprove:false: нарушение 4-eyes видно, а не прячется. */
  state: JournalState;
}

/** Журнал записи «предложил / согласовал», свежие сверху. */
export function journalRows(journal: readonly KitJournalEntry[], recordId: string, selfApprove: boolean): JournalRow[] {
  return journal
    .filter(e => e.record_id === recordId)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(e => ({
      at: e.at,
      field: e.field,
      from: e.from,
      to: e.to,
      proposedBy: e.who,
      proposedByAgent: !!e.is_agent,
      approvedBy: e.approved_by,
      state: !e.approved_by ? 'pending' : e.approved_by === e.who && !selfApprove ? 'self-approved' : 'approved',
    }));
}
