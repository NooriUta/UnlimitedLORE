// Канон иконок разделов LORE «План» и «Знание» (S4-25, выбор владелицы 08.11) —
// переехал из kit (K-14, SPRINT_UXR_S7B_ADMIN/S7B-23_2): разделы — предметность
// приложения. Глиф lucide «milestone» вшит здесь же офлайн-набором (CSP запрещает
// сетевые иконки); регистрирует main.tsx вместе с game-icons.
//
// Lucide — ISC License, Copyright (c) Lucide Icons and Contributors.
import type { IconifyJSON } from '@iconify/react/offline';

export const LORE_ICON_CANON = {
  plan: 'lucide:milestone',
  knowledge: 'lucide:book-open',
} as const;

export const LORE_LUCIDE_ICONS: IconifyJSON = {
  prefix: 'lucide',
  width: 24,
  height: 24,
  icons: {
    milestone: {
      body: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 13v8\"/><path d=\"M12 3v3\"/><path d=\"M18.172 6a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z\"/></g>",
    },
  },
};
