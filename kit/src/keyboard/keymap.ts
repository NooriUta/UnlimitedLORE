// Клавиатура как слой (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11,
// D-2026-UXR-KEYBOARD-LAYER): клавиша — дополнительный путь к действию, у
// которого всегда есть кнопка. Здесь — чистая модель: подписи для Kbd и
// aria-keyshortcuts из одной строки-сочетания («Mod+Shift+E»), поиск действия
// по событию (по e.code — работает в русской раскладке, S4-00f) и проверка
// раскладки на конфликты: одна комбинация = одно действие.
import { matchHotkey, parseHotkey } from '../resilience/hotkeys';
import type { KeyLike } from '../resilience/hotkeys';

/** Действие с необязательной клавишей. ids — над чем выполнить (строка или выделение). */
export interface KitKeyAction {
  id: string;
  title: string;
  /** Сочетание: «E», «Shift+D», «Mod+Enter». Нет — только кнопка. */
  hotkey?: string;
  run: (ids: string[]) => void;
}

/** Клавиши, которые слой списка уже занял (курсор, открыть, выделить, палитра, поиск). */
export const LIST_RESERVED_KEYS: readonly string[] = [
  'ArrowDown', 'ArrowUp', 'J', 'K', 'Home', 'End', 'Enter', 'X', 'Escape', 'Space', 'Tab', 'Mod+K', '/', '?',
];

function split(spec: string): { mods: Set<string>; key: string } {
  const parts = spec.split('+').map(p => p.trim()).filter(Boolean);
  const key = parts.pop() ?? '';
  return { mods: new Set(parts.map(p => p.toLowerCase())), key };
}

const SHIFTED = new Set(['?']);

function keyName(key: string): string {
  return /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
}

/** «shift+mod+e» → «Control+Shift+E» (формат атрибута aria-keyshortcuts). */
export function ariaKeyshortcuts(spec: string): string {
  const { mods, key } = split(spec);
  const out: string[] = [];
  if (mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta')) out.push('Control');
  if (mods.has('alt') || mods.has('option')) out.push('Alt');
  if (mods.has('shift') || SHIFTED.has(key)) out.push('Shift');
  out.push(keyName(key));
  return out.join('+');
}

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc', Esc: 'Esc', ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Space: '␣',
};

/** «Mod+K» → ['Ctrl','K'] (на Mac — ['⌘','K']): подпись для Kbd. */
export function kbdKeys(spec: string, opts: { mac?: boolean } = {}): string[] {
  const { mods, key } = split(spec);
  const out: string[] = [];
  if (mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta')) out.push(opts.mac ? '⌘' : 'Ctrl');
  if (mods.has('alt') || mods.has('option')) out.push(opts.mac ? '⌥' : 'Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(KEY_LABELS[key] ?? keyName(key));
  return out;
}

/** Mac/iOS — подпись Mod как ⌘ (само сочетание по-прежнему Ctrl или ⌘). */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

/** Действие, чья клавиша — ровно это событие (модификаторы точно). */
export function findAction<A extends { hotkey?: string }>(actions: readonly A[], e: KeyLike): A | undefined {
  return actions.find(a => a.hotkey !== undefined && a.hotkey !== '' && matchHotkey(e, a.hotkey));
}

function norm(spec: string): string {
  const s = parseHotkey(spec);
  return `${s.mod ? 'M' : ''}${s.shift ? 'S' : ''}${s.alt ? 'A' : ''}:${s.code}`;
}

export interface KeymapConflict {
  hotkey: string;
  /** Кто делит клавишу; «list» — занята слоем списка. */
  ids: string[];
}

/** Конфликты раскладки: повторы между действиями и с занятыми клавишами. */
export function keymapConflicts(
  actions: readonly { id: string; hotkey?: string }[],
  reserved: readonly string[] = [],
): KeymapConflict[] {
  const taken = new Map<string, { hotkey: string; ids: string[] }>();
  for (const r of reserved) taken.set(norm(r), { hotkey: ariaKeyshortcuts(r), ids: ['list'] });
  for (const a of actions) {
    if (!a.hotkey) continue;
    const k = norm(a.hotkey);
    const slot = taken.get(k);
    if (slot) slot.ids.push(a.id);
    else taken.set(k, { hotkey: ariaKeyshortcuts(a.hotkey), ids: [a.id] });
  }
  return [...taken.entries()]
    .filter(([, v]) => v.ids.length > 1)
    .map(([, v]) => ({ hotkey: v.hotkey, ids: v.ids }));
}

/** Громкая ошибка конфигурации: клавиша, которую не нажать однозначно, — баг, а не тишина. */
export function assertKeymap(actions: readonly { id: string; hotkey?: string }[], reserved: readonly string[] = []): void {
  const c = keymapConflicts(actions, reserved);
  if (c.length) {
    throw new Error(`Клавиши действий конфликтуют: ${c.map(x => `${x.hotkey} — ${x.ids.join(', ')}`).join('; ')}`);
  }
}
