// Личные настройки → интерфейс (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02).
// Каждая настройка контракта S2 (UserSettings) ложится атрибутом на корень
// документа — экраны и CSS читают атрибут, а не хранилище:
//   тема (palette/mode/density) — атрибуты kit (applyTheme);
//   text_size, stripes          — атрибуты kit (applyDisplay);
//   collapse_nav_on_read        — data-read-nav="collapse" (экран записи сворачивает меню);
//   right_column                — data-right-column="open|closed" (ушко записи; auto — снят);
//   single_key_shortcuts        — data-single-keys="off" (слой клавиш, singleKeysEnabled);
//   show_tech                   — data-show-tech="on" (общий выключатель tech, ShowTech.tsx).
// Тема дублируется в общую cookie seer-prefs — её читают v1 и тема входа.
import { applyDisplay, applyTheme, normalizePalette, DEFAULT_PREFS, type AttrTarget } from '@seidr/kit';
import { applyTextScale } from '@seidr/kit/core';
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
  // Ползунок шрифта (S4-16/S4-21): --fs-k на корне; 1 — свойство снято. Корень
  // без style (сервер, тесты без DOM) — пропускаем, а не падаем.
  const styled = root as unknown as Parameters<typeof applyTextScale>[0];
  if (styled && (root as { style?: unknown }).style) applyTextScale(styled, s.text_scale);
  setAttr(root, 'data-read-nav', s.collapse_nav_on_read ? 'collapse' : null);
  setAttr(root, 'data-right-column', s.right_column === 'auto' ? null : s.right_column);
  setAttr(root, 'data-single-keys', s.single_key_shortcuts ? null : 'off');
  // Peek по наведению (S9-10): выключено — атрибут; молчание — включено.
  setAttr(root, 'data-peek-hover', s.peek_hover ? null : 'off');
  setAttr(root, 'data-show-tech', s.show_tech ? 'on' : null);
  // S4-18: подтверждение смены статуса — только включённое; молчание — не спрашивать.
  setAttr(root, 'data-status-confirm', s.status_confirm ? 'on' : null);
  // Вид вкладки «Граф» (GC-03): auto — атрибута нет, экран решает сам.
  setAttr(root, 'data-graph-view', s.graph_view === 'auto' ? null : s.graph_view);
  // Где открывать запись (S4-24): auto — атрибута нет, экран решает сам.
  setAttr(root, 'data-passport-place', s.passport_place === 'auto' ? null : s.passport_place);

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
