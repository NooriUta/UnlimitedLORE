// Строки LORE v2. Локали v1 (src/i18n/locales/*) v2 не импортирует — v1 заморожен
// (D-2026-UXR-V2-FOLDER-V1-FROZEN). Обе локали обязательны: тест сверяет ключи.
export type Lang = 'ru' | 'en';

const ru = {
  'settings.title': 'Личные настройки',
  'settings.nav.label': 'Новая навигация',
  'settings.nav.hint': 'Выключите, чтобы вернуться к прежнему LORE. Выбор запоминается для обеих версий.',
  'settings.nav.unavailable': 'Переход недоступен: по этому адресу (localhost или IP) у LORE нет второй версии.',
} as const;

const en: Record<keyof typeof ru, string> = {
  'settings.title': 'Personal settings',
  'settings.nav.label': 'New navigation',
  'settings.nav.hint': 'Turn off to go back to the previous LORE. The choice is remembered for both versions.',
  'settings.nav.unavailable': 'Switch unavailable: this address (localhost or IP) has no second LORE version.',
};

export type MessageKey = keyof typeof ru;

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { ru, en };

export function t(lang: Lang, key: MessageKey): string {
  return MESSAGES[lang][key];
}

export function detectLang(): Lang {
  const l = typeof navigator === 'undefined' ? '' : navigator.language ?? '';
  return l.toLowerCase().startsWith('en') ? 'en' : 'ru';
}
