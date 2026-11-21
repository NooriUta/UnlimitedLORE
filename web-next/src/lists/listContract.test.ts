// MC-09: экран-список из контракта модели (`surfaces.list`). Тип, о котором приложение не знает,
// получает экран из одной модели; свой экран берёт срез из модели, а умолчание — только когда её нет.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS, listScreenFor, withListContract } from './screens';
import { listContractOf, statusFilterOf } from './listContract';

// Настоящая модель (shared/model/lore-model.json — её отдаёт /lore/model): контракт своих экранов сверяется с ней,
// а не с рукописным ответом сервера (CT-KIT-FIXTURES, api/handShapeGuard.test.ts).
const realModel = JSON.parse(readFileSync(resolve(__dirname, '..', '..', '..', 'shared', 'model', 'lore-model.json'), 'utf8')) as unknown;

// Фрагмент раздела surfaces.list, а не ответ сервера: тип, которого в модели нет, и подменённые срезы своих экранов —
// вход разбора контракта.
const model = {
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

  it('настоящая модель: контракт каждого типа разбирается; PR (раздел 1.18) — срезом prs', () => {
    const list = (realModel as { surfaces: { list: Record<string, unknown> } }).surfaces.list;
    const broken = Object.keys(list).filter(t => listContractOf(realModel, t) === null);
    expect(broken, 'неполный контракт в модели').toEqual([]);
    const pr = listContractOf(realModel, 'pr');
    expect(pr, 'нет surfaces.list.pr — раздел «PR» есть, а списку его не перечислить').not.toBeNull();
    expect(pr!.slice).toBe('prs');
    expect(statusFilterOf(pr!)).toBe('client');
    expect(listScreenFor('pr', realModel)!.slice).toBe('prs');
    expect(listScreenFor('task', realModel)!.slice).toBe('open_tasks');
  });

  it('модели нет — умолчание приложения; типа нет нигде — null', () => {
    expect(listScreenFor('sprint', undefined)!.slice).toBe('sprints');
    expect(listScreenFor('nobody', model)).toBeNull();
  });

  it('сегменты и колонка статуса: фильтр статуса серверный, срез умолчания совпадает с slice', () => {
    const doc = { surfaces: { list: { task: {
      slice: 'open_tasks', id_key: 'task_uid', title_key: 'title', status_key: 'status_raw',
      record_path: '/lore/record/task/{id}', requires_role: null, since: '<=1.17',
      segments: [
        { key: 'open', slice: 'open_tasks', label_key: 'lists.status.open', default: true },
        { key: 'closed', slice: 'closed_tasks', label_key: 'lists.status.closed' },
        { key: 'all', slice: 'all_tasks' },
      ],
    } } } };
    const c = listContractOf(doc, 'task')!;
    expect(c.statusKey).toBe('status_raw');
    expect(c.since).toBe('<=1.17');
    expect(c.requiresRole).toBeUndefined();
    expect(c.segments.map(s => [s.key, s.slice, s.default])).toEqual([
      ['open', 'open_tasks', true], ['closed', 'closed_tasks', false], ['all', 'all_tasks', false],
    ]);
    expect(c.segments[2].labelKey).toBeUndefined();
    expect(statusFilterOf(c)).toBe('server');
    expect(statusFilterOf({ ...c, segments: [] })).toBe('client');
    expect(statusFilterOf({ ...c, segments: [], statusKey: undefined })).toBe('none');
  });

  it('неполный контракт не принимается (нет id_key) — действует умолчание', () => {
    const broken = { surfaces: { list: { sprint: { slice: 'x', title_key: 'name', record_path: '/lore/record/sprint/{id}' } } } };
    expect(listContractOf(broken, 'sprint')).toBeNull();
    expect(listScreenFor('sprint', broken)!.slice).toBe('sprints');
  });
});
