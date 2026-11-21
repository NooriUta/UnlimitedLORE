// MC-09: экран-список из контракта модели (`surfaces.list`). Тип, о котором приложение не знает,
// получает экран из одной модели; свой экран берёт срез из модели, а умолчание — только когда её нет.
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS, listScreenFor, withListContract } from './screens';
import { listContractOf } from './listContract';

const model = {
  format: 'model/0', version: 'v1',
  surfaces: {
    list: {
      // Тип, которого нет ни в одном экране web-next: приходит только моделью.
      future_kind: {
        slice: 'future_rows', id_key: 'fk_id', title_key: 'fk_name',
        record_path: '/lore/record/future_kind/{id}', default_mode: 'cards', group_keys: ['area'],
        requires_role: 'admin', project_scoped: true,
      },
      sprint: { slice: 'sprints_v2', id_key: 'sprint_id', title_key: 'name', record_path: '/lore/record/sprint/{id}' },
      task: { slice: 'open_tasks', id_key: 'task_uid', title_key: 'title', record_path: '/lore/record/task/{id}' },
    },
  },
};

describe('контракт списка из модели (MC-09)', () => {
  it('тип только в модели — экран собран из контракта: срез, код, заголовок, разрезы', () => {
    const def = listScreenFor('future_kind', model);
    expect(def).not.toBeNull();
    expect(def!.slice).toBe('future_rows');
    const rec = def!.map({ fk_id: 'F-1', fk_name: 'Первая', area: 'core' });
    expect(rec).toMatchObject({ id: 'F-1', kind: 'future_kind', title: 'Первая', fields: { area: 'core' } });
    const cfg = def!.config('ru');
    expect(cfg.list?.views?.[0]).toBe('cards');
    expect(cfg.list?.columns).toEqual(['title', 'area']);
    expect(def!.note).toContain('admin');
  });

  it('заголовка нет в строке — заголовок = код (не пустая строка)', () => {
    expect(listScreenFor('future_kind', model)!.map({ fk_id: 'F-2' }).title).toBe('F-2');
  });

  it('свой экран: срез из модели, оформление своё', () => {
    const def = listScreenFor('sprint', model)!;
    expect(def.slice).toBe('sprints_v2');
    expect(def.icon).toBe(LIST_SCREENS.sprints.icon);
  });

  it('модель подтвердила умолчание — тот же объект (экран не перезагружает строки)', () => {
    expect(withListContract(LIST_SCREENS.tasks, listContractOf(model, 'task'))).toBe(LIST_SCREENS.tasks);
  });

  it('модели нет — умолчание приложения; типа нет нигде — null', () => {
    expect(listScreenFor('sprint', undefined)!.slice).toBe('sprints');
    expect(listScreenFor('nobody', model)).toBeNull();
  });

  it('неполный контракт не принимается (нет id_key) — действует умолчание', () => {
    const broken = { surfaces: { list: { sprint: { slice: 'x', title_key: 'name', record_path: '/lore/record/sprint/{id}' } } } };
    expect(listContractOf(broken, 'sprint')).toBeNull();
    expect(listScreenFor('sprint', broken)!.slice).toBe('sprints');
  });
});
