// Строки LORE v2. Локали v1 (src/i18n/locales/*) v2 не импортирует — v1 заморожен
// (D-2026-UXR-V2-FOLDER-V1-FROZEN). Обе локали обязательны: тест сверяет ключи.
export type Lang = 'ru' | 'en';

const ru = {
  'settings.title': 'Личные настройки',
  'settings.nav.label': 'Новая навигация',
  'settings.nav.hint': 'Выключите, чтобы вернуться к прежнему LORE. Выбор запоминается для обеих версий.',
  'settings.nav.unavailable': 'Переход недоступен: по этому адресу (localhost или IP) у LORE нет второй версии.',
  'settings.loading': 'Загружаем настройки…',
  'settings.loadFailed': 'Настройки не прочитались — умолчания за сохранённое не выдаём.',
  'settings.saveFailed': 'Не сохранилось — вернули прежнее значение.',
  'settings.saving': 'Сохраняем…',
  // Надпись про ИСТОЧНИК показанных значений, а не про историю экрана
  // (повторный CJM 09.11.2026: панель читала с сервера и писала «в этом
  // браузере» — текст остался от времён заглушки).
  'settings.serverNote': 'Хранится на сервере LORE: эти настройки одинаковы на всех ваших устройствах.',
  'settings.on': 'вкл',
  'settings.off': 'выкл',
  'settings.readNav.label': 'Меню при чтении записи',
  'settings.readNav.collapse': 'сворачивать',
  'settings.readNav.keep': 'не сворачивать',
  'settings.rightColumn.label': 'Правая колонка записи («ушко»)',
  'settings.rightColumn.auto': 'авто',
  'settings.rightColumn.open': 'открыта',
  'settings.rightColumn.closed': 'свёрнута',
  'settings.textSize.label': 'Размер текста во всём интерфейсе',
  'settings.textSize.sm': 'мельче',
  'settings.textSize.md': 'обычный',
  'settings.textSize.lg': 'крупнее',
  'settings.textSize.xl': 'очень крупно (4K)',
  'settings.mode.label': 'Тема',
  'settings.mode.dark': 'тёмная',
  'settings.mode.light': 'светлая',
  'settings.palette.label': 'Палитра',
  'settings.density.label': 'Плотность',
  'settings.density.roomy': 'свободно',
  'settings.density.compact': 'компактно',
  'settings.density.comfortable': 'средне',
  'settings.keys.label': 'Однобуквенные клавиши',
  'settings.keys.hint': 'J K X S E Z F / ?, Space — у каждой есть кнопка',
  'settings.stripes.label': 'Цветные полоски',
  'settings.stripes.hint': 'Цветная кромка статуса на досках и в списках',
  'settings.memory.open': 'Что LORE помнит обо мне',
  'settings.memory.title': 'Что LORE помнит обо мне',
  'settings.memory.back': 'К настройкам',
  'settings.memory.remembering': 'Запоминать частые разделы и недавние записи',
  'settings.memory.on': 'запоминать',
  'settings.memory.off': 'не запоминать',
  'settings.memory.notRemembering': 'LORE сейчас не запоминает: пустые «Недавние» значат «выключено», а не «ничего не открывали». Накопленное ниже — стирается кнопками.',
  'settings.memory.note': 'Только то, что ниже. Видите это вы и ваши агенты, другим пользователям не передаётся. Срок хранения, дней:',
  'settings.memory.kind.frequent_views': 'Частые виды',
  'settings.memory.kind.frequent_slices': 'Частые выборки',
  'settings.memory.kind.recent_records': 'Недавние записи',
  'settings.memory.forget': 'Забыть',
  'settings.memory.forgetKind': 'Стереть раздел',
  'settings.memory.forgetAll': 'Стереть всё',
  'settings.memory.empty': 'Пусто (проверено)',
  'settings.memory.hits': 'раз',
} as const;

const en: Record<keyof typeof ru, string> = {
  'settings.title': 'Personal settings',
  'settings.nav.label': 'New navigation',
  'settings.nav.hint': 'Turn off to go back to the previous LORE. The choice is remembered for both versions.',
  'settings.nav.unavailable': 'Switch unavailable: this address (localhost or IP) has no second LORE version.',
  'settings.loading': 'Loading settings…',
  'settings.loadFailed': 'Settings could not be read — defaults are not shown as if they were saved.',
  'settings.saveFailed': 'Not saved — the previous value is back.',
  'settings.saving': 'Saving…',
  'settings.serverNote': 'Stored on the LORE server: these settings are the same on all your devices.',
  'settings.on': 'on',
  'settings.off': 'off',
  'settings.readNav.label': 'Menu while reading a record',
  'settings.readNav.collapse': 'collapse',
  'settings.readNav.keep': 'keep open',
  'settings.rightColumn.label': 'Record right column ("ear")',
  'settings.rightColumn.auto': 'auto',
  'settings.rightColumn.open': 'open',
  'settings.rightColumn.closed': 'collapsed',
  'settings.textSize.label': 'Text size everywhere',
  'settings.textSize.sm': 'smaller',
  'settings.textSize.md': 'normal',
  'settings.textSize.lg': 'larger',
  'settings.textSize.xl': 'largest (4K)',
  'settings.mode.label': 'Theme',
  'settings.mode.dark': 'dark',
  'settings.mode.light': 'light',
  'settings.palette.label': 'Palette',
  'settings.density.label': 'Density',
  'settings.density.roomy': 'roomy',
  'settings.density.compact': 'compact',
  'settings.density.comfortable': 'medium',
  'settings.keys.label': 'Single-key shortcuts',
  'settings.keys.hint': 'J K X S E Z F / ?, Space — each has a button',
  'settings.stripes.label': 'Colour stripes',
  'settings.stripes.hint': 'Status colour edge on boards and lists',
  'settings.memory.open': 'What LORE remembers about me',
  'settings.memory.title': 'What LORE remembers about me',
  'settings.memory.back': 'Back to settings',
  'settings.memory.remembering': 'Remember frequent sections and recent records',
  'settings.memory.on': 'remember',
  'settings.memory.off': 'do not remember',
  'settings.memory.notRemembering': 'LORE is not remembering now: an empty "Recent" means "switched off", not "nothing opened". What was collected below can be erased with the buttons.',
  'settings.memory.note': 'Only what is below. Visible to you and your agents, never shared with other users. Retention, days:',
  'settings.memory.kind.frequent_views': 'Frequent views',
  'settings.memory.kind.frequent_slices': 'Frequent queries',
  'settings.memory.kind.recent_records': 'Recent records',
  'settings.memory.forget': 'Forget',
  'settings.memory.forgetKind': 'Erase section',
  'settings.memory.forgetAll': 'Erase all',
  'settings.memory.empty': 'Empty (checked)',
  'settings.memory.hits': 'times',
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
