// Официальные логотипы harness (SPRINT_UXR_S7B_ADMIN/S7B-22).
//
// Владелица 11.11.2026: «иконки harness официальные маленькие, чтобы не было
// отсебятины». Какой знак у какого harness — решает СПРАВОЧНИК harness (поле
// icon, слаг «simple-icons:имя»), а не этот файл: здесь только сами рисунки,
// вшитые офлайн (CSP запрещает сетевые иконки). Рисуется только то, что есть
// в этом наборе; глиф game-icons/lucide в поле icon (засев V75 — robot-golem)
// логотипом не считается и не рисуется — это был бы самодельный знак.
//
// СГЕНЕРИРОВАНО из @iconify-json/simple-icons 1.2.102 (= simple-icons 16.37.0).
// Simple Icons — CC0 1.0 (https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md);
// товарные знаки принадлежат владельцам, источник каждого — в HARNESS_LOGO_SOURCES
// (поле source из data/simple-icons.json того же выпуска).
import { registerGameIcons } from '@seidr/kit';

export const HARNESS_LOGO_PREFIX = 'simple-icons:';

export const HARNESS_LOGOS = {
  prefix: 'simple-icons',
  width: 24,
  height: 24,
  icons: {
    claudecode: {
      body: '<path fill="currentColor" d="M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z"/>',
    },
    kimi: {
      body: '<path fill="currentColor" d="M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441"/>',
    },
    opencode: {
      body: '<path fill="currentColor" d="M22 24H2V0h20zM17 4.8H7v14.4h10z"/>',
    },
  },
};

/** Откуда рисунок: страница производителя, указанная Simple Icons (16.37.0). */
export const HARNESS_LOGO_SOURCES: Record<string, { title: string; source: string }> = {
  claudecode: { title: 'Claude Code', source: 'https://code.claude.com' },
  kimi: { title: 'Kimi', source: 'https://moonshotai.github.io/Branding-Guide' },
  opencode: { title: 'OpenCode', source: 'https://github.com/anomalyco/opencode/blob/1251a870cb384543c150c4a72fb101b55eec971b/packages/identity/mark.svg' },
};

registerGameIcons(HARNESS_LOGOS);

/**
 * Слаг поля icon справочника → слаг логотипа, если это логотип из вшитого
 * набора; иначе null (глиф, опечатка, логотипа нет) — тогда знак не рисуем.
 */
export function harnessLogo(icon: string | null | undefined): string | null {
  if (!icon || !icon.startsWith(HARNESS_LOGO_PREFIX)) return null;
  const name = icon.slice(HARNESS_LOGO_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(HARNESS_LOGOS.icons, name) ? icon : null;
}
