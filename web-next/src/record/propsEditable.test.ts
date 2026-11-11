// Правка характеристик в паспорте (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
//
// Владелица 11.11.2026: «S4-FIELD-EDITORS нужны, а то как редактировать
// характеристики». kit умеет ✎ → FieldEditor, но решать, какое поле правимо,
// ему нечем — это знает сервер (`schema.fields[].editable` и путь `write`).
// Правимым поле становится только при ОБОИХ: без пути записи ✎ обещал бы
// сохранение, которого некуда отправить. Варианты списка — из справочника
// `dict`, а не своей таблицей в клиенте.
import { describe, expect, it } from 'vitest';
import { recordFromServer } from '../api/liveRecord';
import { fromLoreRecord, withFieldOptions } from './loreRecordContract';

const LOADED = '2026-11-11T06:00:00.000Z';

const body = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SP-1', title: 'Спринт', status: 'active', version: 'V1' },
  values: { priority: 'P1', track: 'ui', created: '2026-11-01' },
  parts: [], links: [],
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'k', icon: 'i', layout: {}, relations: [],
    fields: [
      { key: 'priority', label: 'Приоритет', label_key: 'k', kind: 'enum', group: 'props', required: false, editable: true, dict: 'priority', write: { endpoint: '/lore/sprint/plan', field: 'priority' } },
      { key: 'track', label: 'Трек', label_key: 'k', kind: 'text', group: 'props', required: false, editable: true, write: { endpoint: '/lore/sprint/plan', field: 'track_id' } },
      { key: 'created', label: 'Создан', label_key: 'k', kind: 'date', group: 'props', required: false, editable: false, write: null },
    ],
  },
  meta: { facade: 'server', sources: { block: [] }, data_state: [] },
};

const fieldsOf = () => {
  const view = fromLoreRecord(recordFromServer(body, LOADED), 'ru');
  return view.config.kinds.sprint.fields ?? [];
};

describe('S4-24 · правимость характеристик — из схемы сервера', () => {
  it('editable + путь записи → поле правимо; без пути — только чтение', () => {
    const f = fieldsOf();
    expect(f.find(x => x.key === 'track')?.editable).toBe(true);
    expect(f.find(x => x.key === 'priority')?.editable).toBe(true);
    expect(f.find(x => x.key === 'created')?.editable).toBeFalsy();
  });

  it('варианты enum — из справочника dict, подписью статьи', () => {
    const view = fromLoreRecord(recordFromServer(body, LOADED), 'ru');
    const cfg = withFieldOptions(view.config, 'sprint', { priority: [{ code: 'P1', title: 'Высокий' }, { code: 'P2', title: 'Средний' }] });
    expect(cfg.kinds.sprint.fields?.find(x => x.key === 'priority')?.options).toEqual([
      { value: 'P1', label: 'Высокий' }, { value: 'P2', label: 'Средний' },
    ]);
  });

  it('справочник не пришёл — вариантов нет (kit тогда не даст править enum), остальное не тронуто', () => {
    const view = fromLoreRecord(recordFromServer(body, LOADED), 'ru');
    const cfg = withFieldOptions(view.config, 'sprint', {});
    expect(cfg.kinds.sprint.fields?.find(x => x.key === 'priority')?.options).toBeUndefined();
    expect(cfg.kinds.sprint.fields?.find(x => x.key === 'track')?.editable).toBe(true);
  });
});
