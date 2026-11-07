// Статус-поповер «2 касания» (SPRINT_UXR_S10_SEIDR_KIT/K-05, D-2026-UXR-STATUS-AXIS).
// Касание 1 — чип (или S в записи) открывает меню; касание 2 — пункт или его
// клавиша 1…9 (свой hotkey статуса важнее номера). Esc и «Отмена» закрывают
// без выбора. Клавиши — по e.code (работают в русской раскладке, S4-00f).
// Пункты — только допустимые переходы (allow); если их нет — честный текст.
// S4-07: пункты — в порядке жизненного цикла (statusTargets); с confirmFinal
// завершающий статус (категория done/cancelled) — третий шаг, StatusConfirm;
// Esc в подтверждении — назад к меню.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Kbd } from '../elements/Kbd';
import { StatusConfirm } from '../elements/StatusConfirm';
import { isFinalCategory } from '../elements/statusMeta';
import { kitT, useKitLang } from '../i18n';
import { matchHotkey } from '../resilience/hotkeys';
import { StatusIcon } from './StatusIcon';
import { findStatus, statusColor, statusTargets, type KitStatuses } from './statusModel';

export interface StatusPopoverProps {
  statuses: KitStatuses;
  current: string;
  onPick: (code: string) => void;
  onCancel: () => void;
  /** S4-07: завершающие статусы (done/cancelled) — только после подтверждения. */
  confirmFinal?: boolean;
  id?: string;
  className?: string;
}

function keyMatches(e: ReactKeyboardEvent, key: string): boolean {
  if (!key) return false;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (/^[1-9]$/.test(key)) return plain && (e.code === `Digit${key}` || e.code === `Numpad${key}`);
  return matchHotkey(e, key);
}

export function StatusPopover({ statuses, current, onPick, onCancel, confirmFinal, id, className }: StatusPopoverProps) {
  const lang = useKitLang();
  const targets = statusTargets(statuses, current);
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [focusCode, setFocusCode] = useState<string | null>(null);

  useEffect(() => {
    if (confirming !== null) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    (items.find((el) => el.dataset.status === focusCode) ?? items[0])?.focus();
  }, [confirming, focusCode]);

  const choose = (code: string) => {
    const item = findStatus(statuses, code);
    if (confirmFinal && item && isFinalCategory(item.category)) setConfirming(code);
    else onPick(code);
  };

  const back = () => {
    setFocusCode(confirming);
    setConfirming(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (confirming !== null) back();
      else onCancel();
      return;
    }
    if (confirming !== null) return;
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.code === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
      return;
    }
    const hit = targets.find((t) => keyMatches(e, t.key));
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      choose(hit.item.code);
    }
  };

  const cls = ['sk-spop', className].filter(Boolean).join(' ');
  const pending = confirming !== null ? findStatus(statuses, confirming) : undefined;

  if (pending) {
    return (
      <div className={cls} id={id} onKeyDown={onKeyDown}>
        <StatusConfirm
          title={pending.title}
          code={pending.code}
          icon={pending.icon}
          color={statusColor(pending.color)}
          onConfirm={() => onPick(pending.code)}
          onBack={back}
        />
      </div>
    );
  }

  return (
    <div className={cls} id={id} onKeyDown={onKeyDown}>
      {targets.length ? (
        <div ref={menuRef} role="menu" aria-label={kitT(lang, 'kit.status.menu')} className="sk-spop__menu">
          {targets.map(({ item, key }) => {
            const final = Boolean(confirmFinal) && isFinalCategory(item.category);
            return (
              <button
                key={item.code}
                type="button"
                role="menuitem"
                className="sk-spop__item"
                data-status={item.code}
                data-category={item.category}
                data-final={final ? 'true' : undefined}
                title={final ? kitT(lang, 'kit.status.finalHint') : undefined}
                style={{ '--schip-c': statusColor(item.color) } as CSSProperties}
                aria-keyshortcuts={key || undefined}
                onClick={() => choose(item.code)}
              >
                <StatusIcon icon={item.icon} />
                <span className="sk-spop__title">{item.title}</span>
                {final && <span className="sk-spal__final" aria-hidden="true">…</span>}
                {key && <Kbd keys={[key]} />}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="sk-spop__none">{kitT(lang, 'kit.status.none')}</p>
      )}
      <button type="button" className="sk-spop__cancel" onClick={onCancel} aria-keyshortcuts="Escape">
        {kitT(lang, 'kit.status.cancel')}
      </button>
    </div>
  );
}
