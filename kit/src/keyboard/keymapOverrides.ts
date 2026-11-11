// Личная раскладка горячих клавиш (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11).
//
// Решение владелицы 11.11.2026: «горячие клавиши должна быть настраиваемая
// тема: приложение задаёт умолчание, kit отрисовывает и реагирует, но можно
// переопределить и сохранить». Умолчание — клавиши действий от приложения
// (`hotkey` у KitKeyAction, K-14). Здесь — переназначения поверх него:
//   • сочетание из нажатия — по физической клавише (e.code), как и реакция:
//     иначе в русской раскладке назначенное «у» не совпало бы с «E»;
//   • `null` — клавиша СНЯТА (действие остаётся кнопкой), это не «вернуть
//     умолчание»: вернуть — значит удалить переназначение;
//   • раскладка личная и хранится в этом браузере (как ширины колонок):
//     хранилище подменяемо, недоступное хранилище не роняет экран.
import { useSyncExternalStore } from 'react';

/** Переназначения: id действия → сочетание; null — без клавиши. */
export type KeymapOverrides = Readonly<Record<string, string | null>>;

export interface KeymapStore {
  read(): KeymapOverrides;
  write(o: KeymapOverrides): void;
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;
const SYMBOLS: Record<string, string> = {
  Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
};

/** Сочетание из нажатия: «Mod+Alt+Shift+K». Одиночный модификатор — ещё не сочетание (null). */
export function hotkeyFromEvent(e: { code: string; key?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  const key = letter ? letter[1] : digit ? digit[1] : SYMBOLS[e.code] ?? e.code;
  const mods = [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

/** Действия с личной раскладкой поверх умолчания. Исходный массив не меняется. */
export function applyKeymapOverrides<A extends { id: string; hotkey?: string }>(actions: readonly A[], o: KeymapOverrides): A[] {
  return actions.map(a => {
    if (!Object.prototype.hasOwnProperty.call(o, a.id)) return a;
    const v = o[a.id];
    const next = { ...a };
    if (v === null) delete next.hotkey;
    else next.hotkey = v;
    return next;
  });
}

export function memoryKeymapStore(initial: KeymapOverrides = {}): KeymapStore {
  let v: KeymapOverrides = { ...initial };
  return { read: () => v, write: o => { v = { ...o }; } };
}

/** Хранилище браузера. Недоступно (приватный режим, запрет) — живём в памяти. */
export function localKeymapStore(key = 'seidr-kit:keymap'): KeymapStore {
  const mem = memoryKeymapStore();
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return mem.read();
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return mem.read();
        const out: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v === null || typeof v === 'string') out[k] = v;
        }
        return out;
      } catch { return mem.read(); }
    },
    write(o) {
      mem.write(o);
      try { localStorage.setItem(key, JSON.stringify(o)); } catch { /* приватный режим — в памяти */ }
    },
  };
}

// ---------- общее состояние: раскладка, открытие панели, группы экрана ----------

let store: KeymapStore = typeof window === 'undefined' ? memoryKeymapStore() : localKeymapStore();
let current: KeymapOverrides = store.read();
let open = false;
/** Группы клавиш, которые показывает панель: регистрирует экран (список, запись). */
let registered: readonly KeymapRegistration[] = [];
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export interface KeymapRegistration {
  /** Кто зарегистрировал — чтобы снять свою регистрацию, не чужую. */
  owner: symbol;
  groups: readonly import('./KeymapPanel').KeymapGroup[];
}

/** Подменить хранилище (тесты, приложение со своим хранением). */
export function setKeymapStore(s: KeymapStore): void {
  store = s;
  current = s.read();
  emit();
}

export function setKeymapOverrides(o: KeymapOverrides): void {
  current = { ...o };
  store.write(current);
  emit();
}

export function useKeymapOverrides(): KeymapOverrides {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function openKeymapPanel(): void { open = true; emit(); }
export function closeKeymapPanel(): void { open = false; emit(); }
export function useKeymapPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => open);
}

export function registerKeymap(reg: KeymapRegistration): () => void {
  registered = [...registered.filter(r => r.owner !== reg.owner), reg];
  emit();
  return () => { registered = registered.filter(r => r.owner !== reg.owner); emit(); };
}

export function useRegisteredKeymap(): readonly KeymapRegistration[] {
  return useSyncExternalStore(subscribe, () => registered, () => registered);
}
