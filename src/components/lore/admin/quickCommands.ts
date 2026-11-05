// ── Быстрые команды — личная шпаргалка владельца (не продуктовая фича,
//    не читает LORE-данные) ──────────────────────────────────────────────────
// Формат нарочно плоский массив, а не таблица/справочник в БД: список личный,
// правится редко и вручную, заводить под него ещё один dict_type — лишний слой
// для того, что проще редактировать прямо в коде при следующем расширении.
// SH-16: подписи — дефолты для t() по titleKey/labelKey (наличие ключей держит тест).
export interface QuickGroup { title: string; titleKey: string; items: { label: string; labelKey: string; cmd: string }[] }

export const QUICK_GROUPS: QuickGroup[] = [
  {
    title: 'Перейти в проект', titleKey: 'lore.admin.quickGrpProject',
    items: [
      { label: 'UnlimitedLORE', labelKey: 'lore.admin.quickUnlimitedLore', cmd: 'cd C:\\AIDA\\UnlimitedLORE' },
      { label: 'aida-root', labelKey: 'lore.admin.quickAidaRoot', cmd: 'cd C:\\AIDA\\aida-root' },
      { label: 'Mobilepoc', labelKey: 'lore.admin.quickMobilepoc', cmd: 'cd D:\\Mobilepoc' },
    ],
  },
  {
    // Q-04: канал mobilepoc-channel выключен 23.08.2026; единственный канал — minilore-link
    // (MCP-сервер user-скоупа, в .mcp.json проекта ничего добавлять не нужно).
    title: 'Канал miniLORE', titleKey: 'lore.admin.quickGrpChannel',
    items: [
      {
        label: 'Подключить консоль к диалогу по sessionId (виден в приложении) через канал minilore-link — НЕ -c, он берёт не тот диалог. PowerShell.',
        labelKey: 'lore.admin.quickAttach',
        cmd: '& "$env:USERPROFILE\\.local\\bin\\claude.exe" --dangerously-load-development-channels server:minilore-link --resume <sessionId>',
      },
    ],
  },
];

export type CopyResult = 'ok' | 'unavailable' | 'failed';

/**
 * Q-03: честное копирование. Вне secure context (стенд по http://IP) у браузера
 * нет navigator.clipboard — раньше экран всё равно писал «скопировано».
 */
export async function tryCopy(text: string, clip: { writeText: (s: string) => Promise<void> } | undefined): Promise<CopyResult> {
  if (!clip?.writeText) return 'unavailable';
  try { await clip.writeText(text); return 'ok'; } catch { return 'failed'; }
}
