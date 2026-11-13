// Канон иконок LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-25, SPEC-LORE-UXR-ICONS).
// Правило владелицы 08.11: иконки — из старого UI (v1); у v1 два набора —
// game-icons (слаг без префикса) и lucide (слаг «lucide:имя», вшит в kit).
// Это выбор владелицы по каждому месту, где v2 расходился с v1 или где в v1
// иконки не было. Компоненты берут иконку ОТСЮДА — правка в одном месте.
// null — «без иконки» (решено так; подбор вне наборов — S4-32).
export const ICON_CANON = {
  /** Раздел «Задачи» в меню. */
  sectionTask: 'lucide:list-checks',
  /** Раздел «Новости» (в v1 town-crier — нет в наборе). */
  sectionNews: 'lucide:megaphone',
  /** Раздел «Настройки» (как было; поиск вне наборов — S4-32). */
  sectionSettings: 'cog',
  /** Сегменты полосы списка. */
  segFilter: 'lucide:filter',
  segGroup: 'lucide:group',
  segSort: 'lucide:list-ordered',
  /** Виды списка. */
  viewList: 'lucide:list',
  viewBoard: 'lucide:columns-3',
  /** Статусы без аналога в v1 (как было; S4-32). */
  statusDraft: 'quill-ink',
  statusDeprecated: 'broken-tablet',
  statusUnknown: 'help',
  /** Меню и оболочка. */
  myViews: 'lucide:star',
  saveView: 'lucide:save',
  recent: 'lucide:history',
  scopeAll: 'lucide:layers',
  commands: 'lucide:command',
  views: 'lucide:eye',
  team: null,
  // «План» и «Знание» — разделы LORE: канон приложения (web-next/src/shell/loreIcons.ts, K-14).
  /** Быстрые фильтры. */
  quickNoRelease: null,
  quickNoDecisions: 'lucide:file-question',
  /** События ленты новостей. */
  newsReady: 'wave-crest',
  newsCancelled: 'lucide:circle-x',
  newsVersion: 'upgrade',
  newsReactivated: 'lucide:undo-2',
  /** Приоритеты P0–P3. */
  prioP0: 'lucide:flame',
  prioP1: 'lucide:chevron-up',
  prioP2: 'lucide:equal',
  prioP3: 'lucide:chevron-down',
  /** Поле «Проект» в фильтрах. */
  fieldProject: 'castle',
  /** Служебные кнопки. */
  ctlMenu: 'lucide:menu',
  ctlDelete: 'lucide:trash-2',
  ctlTreeToggle: 'lucide:chevron-right',
  ctlEdit: 'lucide:pencil',
  ctlReading: 'lucide:book-open',
  /**
   * Мини-версия зоны «только иконками» (S4-30). Выбор владелицы 09.11.2026:
   * на предложение «Свойства — sliders-horizontal, Граф — share-2,
   * Аналитика — bar-chart-3» ответила «три». В lucide 1.70 третья называется
   * chart-column — то же изображение, переименовано вверх по течению.
   */
  recProps: 'lucide:sliders-horizontal',
  recGraph: 'lucide:share-2',
  recAnalytics: 'lucide:chart-column',
} as const satisfies Record<string, string | null>;

export type IconCanonKey = keyof typeof ICON_CANON;
