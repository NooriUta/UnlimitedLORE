// Палитра статус-звезды (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-07, D-2026-UXR-STATUS-AXIS).
// Касание 1 — звезда открывает палитру; касание 2 — пункт (или клавиша 1…9 по
// e.code, работает в русской раскладке). Пункты сгруппированы по категориям в
// порядке жизненного цикла; текущий статус не предлагается. Завершающий статус
// (done/closed) — третий шаг: StatusConfirm, Esc там возвращает к меню.
// Esc и «Отмена» в меню закрывают без выбора.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { matchHotkey } from '../resilience/hotkeys';
import { GameIcon } from './GameIcon';
import { Kbd } from './Kbd';
import { StatusConfirm } from './StatusConfirm';
import { groupStatusesByLifecycle, isFinalStatus, statusMeta } from './statusMeta';

export interface StatusPaletteProps {
  /** Текущий статус — из пунктов исключается. */
  current: string;
  /** Коды, из которых выбирать (порядок не важен — палитра сортирует по циклу). */
  options: readonly string[];
  /** Подпись статуса для человека; по умолчанию — код. */
  titleOf?: (code: string) => string;
  onPick: (code: string) => void;
  onCancel: () => void;
  id?: string;
  className?: string;
}

function isEscape(e: ReactKeyboardEvent): boolean {
  return e.code === 'Escape' || e.key === 'Escape';
}

export function StatusPalette({ current, options, titleOf = (c) => c, onPick, onCancel, id, className }: StatusPaletteProps) {
  const lang = useKitLang();
  const cur = statusMeta(current).code;
  const groups = groupStatusesByLifecycle(options.filter((c) => statusMeta(c).code !== cur));
  const flat = groups.flatMap((g) => g.codes);
  const keyOf = (code: string) => {
    const i = flat.indexOf(code);
    return i >= 0 && i < 9 ? String(i + 1) : '';
  };
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Пункт, на который вернуть фокус после «Назад»; null — первый. */
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirming) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    (items.find((el) => el.dataset.status === focusCode) ?? items[0])?.focus();
  }, [confirming, focusCode]);

  const choose = (code: string) => {
    if (isFinalStatus(code)) setConfirming(code);
    else onPick(code);
  };

  const back = () => {
    setFocusCode(confirming);
    setConfirming(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isEscape(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (confirming) back();
      else onCancel();
      return;
    }
    if (confirming) return;
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.code === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
      return;
    }
    const hit = flat.find((c) => {
      const k = keyOf(c);
      return k !== '' && matchHotkey(e, k);
    });
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      choose(hit);
    }
  };

  const cls = ['sk-spop', 'sk-spal', className].filter(Boolean).join(' ');

  if (confirming) {
    const m = statusMeta(confirming);
    return (
      <div className={cls} id={id} onKeyDown={onKeyDown}>
        <StatusConfirm
          title={titleOf(confirming)}
          code={m.code}
          icon={m.icon}
          color={m.color}
          onConfirm={() => onPick(confirming)}
          onBack={back}
        />
      </div>
    );
  }

  return (
    <div className={cls} id={id} onKeyDown={onKeyDown}>
      {flat.length ? (
        <div ref={menuRef} role="menu" aria-label={kitT(lang, 'kit.status.menu')} className="sk-spop__menu">
          {groups.map((g) => {
            const catTitle = kitT(lang, `kit.status.cat.${g.category}` as KitKey);
            return (
              <div key={g.category} role="group" aria-label={catTitle} className="sk-spal__group" data-category={g.category}>
                <div className="sk-spal__cat" aria-hidden="true">{catTitle}</div>
                {g.codes.map((code) => {
                  const m = statusMeta(code);
                  const key = keyOf(code);
                  const final = isFinalStatus(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      role="menuitem"
                      className="sk-spop__item"
                      data-status={m.code}
                      data-category={m.category}
                      data-final={final ? 'true' : undefined}
                      title={final ? kitT(lang, 'kit.status.finalHint') : undefined}
                      style={{ '--schip-c': m.color } as CSSProperties}
                      aria-keyshortcuts={key || undefined}
                      onClick={() => choose(code)}
                    >
                      <GameIcon slug={m.icon} size={14} />
                      <span className="sk-spop__title">{titleOf(code)}</span>
                      {final && <span className="sk-spal__final" aria-hidden="true">…</span>}
                      {key && <Kbd keys={[key]} />}
                    </button>
                  );
                })}
              </div>
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
