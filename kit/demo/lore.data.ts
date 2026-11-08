// Фикстура данных LORE для демо и тестов kit (K-01) — форма window.X_DATA.
import type { KitData } from '../src/core/contract';

export const loreData: KitData = {
  records: [
    {
      id: 'SPRINT_UXR_S10_SEIDR_KIT', kind: 'sprint', title: 'Seiðr-kit: React-пакет kit/', status: 'in_progress',
      fields: { starts: '2026-11-07', ends: '2026-11-21', goal_md: 'Kit — общий React-пакет для LORE и «Дата-странников».' },
      updated_at: '2026-11-07T10:00:00Z',
    },
    {
      id: 'SPRINT_UXR_S10_SEIDR_KIT/K-01', kind: 'task', title: 'Схема конфига и формат данных kit', status: 'in_progress',
      fields: { sprint_id: 'SPRINT_UXR_S10_SEIDR_KIT', component_id: 'LORE-UI', effort_days: 1, priority: 'high' },
      body_md: 'JSON-схема + валидатор + два примера конфига.',
      updated_at: '2026-11-07T11:00:00Z',
    },
    {
      id: 'SPRINT_UXR_S10_SEIDR_KIT/K-02', kind: 'task', title: 'Оболочка: модули и меню', status: 'todo',
      fields: { sprint_id: 'SPRINT_UXR_S10_SEIDR_KIT', effort_days: 2, priority: 'normal' },
    },
    {
      id: 'ADR-LORE-039', kind: 'adr', title: 'Вердикт качества записи', status: 'done',
      fields: { context_md: 'Сервер считает вердикт, клиент рисует.', decision_ids: ['D-2026-UXR-KIT-REACT'] },
      body_md: '## Решение\nВердикт считает сервер.',
    },
    {
      id: 'D-2026-UXR-KIT-REACT', kind: 'decision', title: 'Kit — React-пакет @seidr/kit', status: 'done',
      fields: { rule: 'web-next и другие приложения импортируют kit; single-file HTML — ESM-бандл.' },
    },
    {
      id: 'SPEC-SEIDR-KIT-CONFIG', kind: 'spec', title: 'Схема конфига и данных Seiðr-kit', status: 'todo',
      fields: { version: '1.0.0' },
    },
  ],
  edges: [
    { from: 'SPRINT_UXR_S10_SEIDR_KIT/K-01', to: 'SPRINT_UXR_S10_SEIDR_KIT', type: 'IN_SPRINT' },
    { from: 'SPRINT_UXR_S10_SEIDR_KIT/K-02', to: 'SPRINT_UXR_S10_SEIDR_KIT', type: 'IN_SPRINT' },
    { from: 'SPRINT_UXR_S10_SEIDR_KIT/K-02', to: 'SPRINT_UXR_S10_SEIDR_KIT/K-01', type: 'DEPENDS_ON' },
    { from: 'D-2026-UXR-KIT-REACT', to: 'ADR-LORE-039', type: 'DECIDED_IN' },
    { from: 'SPRINT_UXR_S10_SEIDR_KIT/K-01', to: 'SPEC-SEIDR-KIT-CONFIG', type: 'DOCUMENTED_IN' },
  ],
  journal: [
    {
      at: '2026-11-07T11:00:00Z', who: 'claude', is_agent: true, record_id: 'SPRINT_UXR_S10_SEIDR_KIT/K-01',
      field: 'status', from: 'todo', to: 'in_progress',
    },
  ],
  meta: { generated_at: '2026-11-07T12:00:00Z', scope: 'SPRINT_UXR_S10_SEIDR_KIT', total: 6, returned: 6, truncated: false },
};
