// Чип статуса (SPRINT_UXR_S10_SEIDR_KIT/K-05) — один элемент для списка и для
// записи. Касание по чипу открывает StatusPopover («2 касания»); в записи
// (hotkey) то же делает клавиша S. Смена оптимистичная, save → Promise; отказ —
// откат и role=alert с причиной. Сохранение: проп save, иначе hooks.onSave
// конфига (API), иначе localStorage по умолчанию. Роль без canStatus — показ.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { kitT, useKitLang } from '../i18n';
import { matchHotkey } from '../resilience/hotkeys';
import type { KitConfig, KitRecord } from './contract';
import { StatusIcon } from './StatusIcon';
import { StatusPopover } from './StatusPopover';
import { canChangeStatus, findStatus, statusColor } from './statusModel';
import { resolveSave, type KitSaveFn } from './statusSave';
import { useStatusChange } from './useStatusChange';

export interface StatusChipProps {
  record: KitRecord;
  config: KitConfig;
  /** Своё сохранение; по умолчанию config.hooks.onSave или localStorage. */
  save?: KitSaveFn;
  role?: string;
  /** Клавиша S открывает меню (в записи; в списке — выключено). */
  hotkey?: boolean;
  /** Только иконка (плотный список); имя для чтения остаётся. */
  compact?: boolean;
  /** S4-07: завершающие статусы (done/cancelled) — третьим шагом, с подтверждением. */
  confirmFinal?: boolean;
  onChange?: (to: string) => void;
  className?: string;
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export function StatusChip({ record, config, save, role, hotkey, compact, confirmFinal, onChange, className }: StatusChipProps) {
  const lang = useKitLang();
  const saveFn = useMemo(() => save ?? resolveSave(config.hooks), [save, config.hooks]);
  const st = useStatusChange(record, saveFn, onChange);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popId = useId();
  const interactive = canChangeStatus(config, role);

  const item = findStatus(config.statuses, st.status);
  const title = item?.title ?? (st.status || '—');
  const label = kitT(lang, 'kit.status.label', { title });
  const style = { '--schip-c': item ? statusColor(item.color) : 'var(--t3)' } as CSSProperties;
  const common = {
    className: ['sk-schip', interactive ? 'sk-schip--btn' : '', compact ? 'sk-schip--compact' : ''].filter(Boolean).join(' '),
    style,
    'data-status': st.status,
    'data-category': item?.category ?? 'unknown',
  };
  const body = (
    <>
      <StatusIcon icon={item?.icon ?? 'help'} />
      {!compact && <span className="sk-schip__title" aria-hidden="true">{title}</span>}
    </>
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) chipRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!hotkey || !interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (open || st.pending || isTyping(e.target) || !matchHotkey(e, 'S')) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hotkey, interactive, open, st.pending]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (code: string) => {
    close(true);
    void st.change(code);
  };

  const lastFrom = st.last ? findStatus(config.statuses, st.last.from)?.title ?? (st.last.from || '—') : '';

  return (
    <span ref={wrapRef} className={['sk-schip-wrap', className].filter(Boolean).join(' ')}>
      {interactive ? (
        <button
          ref={chipRef}
          type="button"
          {...common}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          aria-busy={st.pending}
          aria-keyshortcuts={hotkey ? 'S' : undefined}
          disabled={st.pending}
          onClick={() => setOpen((o) => !o)}
        >
          {body}
        </button>
      ) : (
        <span {...common} role="img" aria-label={label} title={label}>{body}</span>
      )}
      {open && (
        <StatusPopover
          id={popId}
          statuses={config.statuses}
          current={st.status}
          confirmFinal={confirmFinal}
          onPick={pick}
          onCancel={() => close(true)}
        />
      )}
      {st.error && (
        <span role="alert" className="sk-schip__err">
          {kitT(lang, 'kit.status.saveFailed', { reason: st.error })}
        </span>
      )}
      {config.statuses.undo && st.last && !st.pending && interactive && (
        <button type="button" className="sk-schip__undo" onClick={() => void st.undo()}>
          {kitT(lang, 'kit.status.undo', { title: lastFrom })}
        </button>
      )}
    </span>
  );
}
