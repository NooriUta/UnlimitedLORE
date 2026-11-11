// «Быстрые команды» — личная шпаргалка владелицы (SPRINT_UXR_S7B_ADMIN/S7B-31
// п.5, решение 5а: из старой вкладки v1 QuickCommandsTab — в раздел MCP).
// Список тот же, что в v1 (src/components/lore/admin/quickCommands.ts); v1
// заморожен и отсюда не импортируется (D-2026-UXR-V2-FOLDER-V1-FROZEN).
// Плоский массив, а не справочник в БД: список личный и правится в коде.
import type { AppKey } from '../i18n';

export interface QuickGroup { title: AppKey; items: { label: AppKey; cmd: string }[] }

export const QUICK_GROUPS: readonly QuickGroup[] = [
  {
    title: 'admin.quick.grpProject',
    items: [
      { label: 'admin.quick.unlimitedLore', cmd: 'cd C:\\AIDA\\UnlimitedLORE' },
      { label: 'admin.quick.aidaRoot', cmd: 'cd C:\\AIDA\\aida-root' },
      { label: 'admin.quick.mobilepoc', cmd: 'cd D:\\Mobilepoc' },
    ],
  },
  {
    // Канал mobilepoc-channel выключен 23.08.2026; единственный канал — minilore-link
    // (MCP-сервер user-скоупа, в .mcp.json проекта ничего добавлять не нужно).
    title: 'admin.quick.grpChannel',
    items: [
      {
        label: 'admin.quick.attach',
        cmd: '& "$env:USERPROFILE\\.local\\bin\\claude.exe" --dangerously-load-development-channels server:minilore-link --resume <sessionId>',
      },
    ],
  },
];

export type CopyResult = 'ok' | 'unavailable' | 'failed';

export interface Clip { writeText: (s: string) => Promise<void> }

/**
 * Честное копирование (v1 Q-03): вне secure context (стенд по http://IP) у
 * браузера нет navigator.clipboard — «скопировано» тогда было бы враньём.
 */
export async function tryCopy(text: string, clip: Clip | null | undefined): Promise<CopyResult> {
  if (!clip?.writeText) return 'unavailable';
  try { await clip.writeText(text); return 'ok'; } catch { return 'failed'; }
}
