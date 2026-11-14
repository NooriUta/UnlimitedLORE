// Отметка машины вызова (D-2026-LORE-AGENT-MACHINE-EVERYWHERE). Сервер отдаёт одно из:
// имя машины (канон, нижний регистр) | "(unknown)" — агент без машины | "(n/a)" — человек.
// Поля нет вовсе — сервер старше правила. Четыре исхода не выдаются друг за друга:
// «неизвестно» ≠ «не применимо» ≠ «сервер не прислал».
import { useAppT } from '../i18n';

export type MachineMarkKind = 'name' | 'unknown' | 'na' | 'absent';

export function machineMark(v: unknown): { kind: MachineMarkKind; text: string } {
  if (typeof v !== 'string' || v.trim() === '') return { kind: 'absent', text: '' };
  if (v === '(unknown)') return { kind: 'unknown', text: v };
  if (v === '(n/a)') return { kind: 'na', text: v };
  return { kind: 'name', text: v };
}

/**
 * Клетка «Машина»: имя — моноширинным, отметки — словами. `unidentified` —
 * вызывающий не опознан (401, ось unauth): сервер шлёт «(n/a)» как для человека,
 * но назвать анонима человеком нечем (PU-29).
 */
export function MachineCell({ value, testId, unidentified }: { value: unknown; testId?: string; unidentified?: boolean }) {
  const t = useAppT();
  const m = machineMark(value);
  if (m.kind === 'name') return <span className="adm-mono" data-testid={testId} data-kind="name">{m.text}</span>;
  const text = m.kind === 'unknown' ? t('admin.machine.mark.unknown')
    : m.kind === 'na' ? (unidentified ? t('admin.machine.mark.naUnauth') : t('admin.machine.mark.na'))
    : t('admin.machine.mark.absent');
  return <span className="adm-missing" data-testid={testId} data-kind={m.kind}>{text}</span>;
}
