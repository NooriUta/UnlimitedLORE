// Демо-данные палитры на витрине /kit (SPRINT_UXR_S10_SEIDR_KIT/K-07):
// маленький KitData по контракту ядра. Это данные (записи), а не подписи UI —
// подписи и команды витрина берёт из локали.
import type { KitConfig, KitData } from '@seidr/kit';

export const PALETTE_DEMO_DATA: KitData = {
  records: [
    { id: 'SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d', kind: 'task', title: 'Витрина /kit', status: 'done', fields: {} },
    { id: 'SPRINT_UXR_S10_SEIDR_KIT/K-07', kind: 'task', title: 'Палитра Ctrl+K и поиск «/»', status: 'active', fields: {} },
    { id: 'SPRINT_UXR_S10_SEIDR_KIT/K-06', kind: 'task', title: 'Горячие клавиши по e.code', status: 'planned', fields: {} },
    { id: 'D-2026-UXR-KIT-REACT', kind: 'decision', title: 'Seiðr-kit — React-пакет @seidr/kit', status: 'done', fields: {} },
    { id: 'D-2026-UXR-KIT-FOUNDATION', kind: 'decision', title: 'Фундамент kit: токены, состояния, устойчивость', status: 'done', fields: {} },
  ],
  edges: [],
  journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z', total: 5, returned: 5 },
};

export const PALETTE_DEMO_KINDS: KitConfig['kinds'] = {
  task: { title: 'Задача', icon: 'scroll-unfurled' },
  decision: { title: 'Решение', icon: 'scales' },
};
