// Статус-поповер «2 касания» (SPRINT_UXR_S10_SEIDR_KIT/K-05, D-2026-UXR-STATUS-AXIS).
// Касание 1 — чип (или S в записи) открывает меню; касание 2 — пункт или его
// клавиша 1…9 (свой hotkey статуса важнее номера). Esc и «Отмена» закрывают
// без выбора. Клавиши — по e.code (работают в русской раскладке, S4-00f).
// Пункты — только допустимые переходы (allow); если их нет — честный текст.
import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Kbd } from '../elements/Kbd';
import { kitT, useKitLang } from '../i18n';
import { matchHotkey } from '../resilience/hotkeys';
import { StatusIcon } from './StatusIcon';
import { statusColor, statusTargets, type KitStatuses } from './statusModel';

export interface StatusPopoverProps {
  statuses: KitStatuses;
  current: string;
  onPick: (code: string) => void;
  onCancel: () => void;
  id?: string;
  className?: string;
}

function keyMatches(e: ReactKeyboardEvent, key: string): boolean {
  if (!key) return false;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (/^[1-9]$/.test(key)) return plain && (e.code === `Digit${key}` || e.code === `Numpad${key}`);
  return matchHotkey(e, key);
}

export function StatusPopover({ statuses, current, onPick, onCancel, id, className }: StatusPopoverProps) {
  const lang = useKitLang();
  const targets = statusTargets(statuses, current);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
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
      onPick(hit.item.code);
    }
  };

  return (
    <div className={['sk-spop', className].filter(Boolean).join(' ')} id={id} onKeyDown={onKeyDown}>
      {targets.length ? (
        <div ref={menuRef} role="menu" aria-label={kitT(lang, 'kit.status.menu')} className="sk-spop__menu">
          {targets.map(({ item, key }) => (
            <button
              key={item.code}
              type="button"
              role="menuitem"
              className="sk-spop__item"
              data-status={item.code}
              data-category={item.category}
              style={{ '--schip-c': statusColor(item.color) } as CSSProperties}
              aria-keyshortcuts={key || undefined}
              onClick={() => onPick(item.code)}
            >
              <StatusIcon icon={item.icon} />
              <span className="sk-spop__title">{item.title}</span>
              {key && <Kbd keys={[key]} />}
            </button>
          ))}
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
