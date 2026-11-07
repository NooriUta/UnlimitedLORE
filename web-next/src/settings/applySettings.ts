// Личные настройки → интерфейс (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02).
// Каждая настройка контракта S2 (UserSettings) ложится атрибутом на корень
// документа — экраны и CSS читают атрибут, а не хранилище:
//   тема (palette/mode/density) — атрибуты kit (applyTheme);
//   text_size, stripes          — атрибуты kit (applyDisplay);
//   collapse_nav_on_read        — data-read-nav="collapse" (экран записи сворачивает меню);
//   right_column                — data-right-column="open|closed" (ушко записи; auto — снят);
//   single_key_shortcuts        — data-single-keys="off" (слой клавиш, singleKeysEnabled).
// Тема дублируется в общую cookie seer-prefs — её читают v1 и тема входа.
import { applyDisplay, applyTheme, normalizePalette, DEFAULT_PREFS, type AttrTarget } from '@seidr/kit';
import type { UserSettings } from '../api/contracts/s2';
import { readSharedPrefs, writeSharedPrefs, type CookieJar } from '../storage/storage';

function setAttr(el: AttrTarget, name: string, value: string | null) {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

export function applySettings(root: AttrTarget, s: UserSettings, jar?: CookieJar, hostname?: string): void {
  applyTheme(root, {
    palette: normalizePalette(s.palette) ?? DEFAULT_PREFS.palette,
    mode: s.mode,
    density: s.density,
  });
  applyDisplay(root, { textSize: s.text_size, stripes: s.stripes });
  setAttr(root, 'data-read-nav', s.collapse_nav_on_read ? 'collapse' : null);
  setAttr(root, 'data-right-column', s.right_column === 'auto' ? null : s.right_column);
  setAttr(root, 'data-single-keys', s.single_key_shortcuts ? null : 'off');

  const shared = readSharedPrefs(jar);
  if (shared.theme !== s.mode || shared.palette !== s.palette) {
    writeSharedPrefs({ theme: s.mode, palette: s.palette }, jar, hostname);
  }
}

/** Однобуквенные клавиши разрешены? Слой клавиш спрашивает корень, а не хранилище. */
export function singleKeysEnabled(root: { getAttribute(name: string): string | null } | null =
  typeof document === 'undefined' ? null : document.documentElement): boolean {
  return root?.getAttribute('data-single-keys') !== 'off';
}
