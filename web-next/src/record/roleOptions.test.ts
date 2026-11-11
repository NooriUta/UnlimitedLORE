// Автор / исполнитель / принимающий задачи — выбором из списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24).
// Владелица 11.11.2026: «у тебя же элемент с выпадающим списком … учтён? … для задач
// исполнитель, ревьюер, автор». Сервер (#1241) объявил поля enum с
// options = {slice: "task_identities", param: "id", value: "code", label: "title", group: "kind"}.
// Клиент: варианты из среза, группа kind → подпись приложения («Люди» / «Агенты»);
// срез не прочитался — поле говорит причину и даёт «Повторить», свободного ввода нет.
import { describe, expect, it, vi } from 'vitest';
import type { KitConfig } from '@seidr/kit';
import { optionsFromSlice, withFieldOptions } from './loreRecordContract';
import { optionsSpecOf } from '../api/liveRecord';

const SPEC = { slice: 'task_identities', param: 'id', value: 'code', label: 'title', group: 'kind' };
const cfg = (): KitConfig => ({
  modules: [], menu: { groups: [] }, statuses: { items: [] },
  kinds: { task: { title: 'Задача', icon: 'x', fields: [{ key: 'executor', title: 'Исполнитель', type: 'enum', editable: true }] } },
});

describe('варианты из среза', () => {
  it('строки → варианты: value/label по названию полей спеки, группа — подписью приложения', () => {
    const rows = [{ code: 'olga', title: 'olga', kind: 'person' }, { code: 'AG-1', title: 'Claude Code', kind: 'agent' }];
    expect(optionsFromSlice(rows, SPEC, k => (k === 'person' ? 'Люди' : 'Агенты'))).toEqual([
      { code: 'olga', title: 'olga', group: 'Люди' }, { code: 'AG-1', title: 'Claude Code', group: 'Агенты' },
    ]);
  });

  it('без group в спеке — плоский список', () => {
    expect(optionsFromSlice([{ code: 'a', title: 'A' }], { ...SPEC, group: undefined }, () => 'x')).toEqual([{ code: 'a', title: 'A' }]);
  });
});

describe('withFieldOptions: варианты из среза и ошибка', () => {
  it('нет справочника, есть варианты из среза — поле получает варианты с группами', () => {
    const out = withFieldOptions(cfg(), 'task', {}, () => undefined, { executor: { items: [{ code: 'olga', title: 'olga', group: 'Люди' }] } });
    expect(out.kinds.task.fields![0].options).toEqual([{ value: 'olga', label: 'olga', group: 'Люди' }]);
  });

  it('срез не прочитался — причина и «Повторить», вариантов нет', () => {
    const retry = vi.fn();
    const out = withFieldOptions(cfg(), 'task', {}, () => undefined, { executor: { error: 'HTTP 502', retry } });
    const f = out.kinds.task.fields![0];
    expect(f.options).toBeUndefined();
    expect(f.optionsError).toBe('HTTP 502');
    f.onOptionsRetry!();
    expect(retry).toHaveBeenCalled();
  });
});

describe('разбор options из схемы сервера', () => {
  it('полная спека — как пришла; group необязателен', () => {
    expect(optionsSpecOf(SPEC)).toEqual(SPEC);
    expect(optionsSpecOf({ ...SPEC, group: undefined })).toEqual({ slice: 'task_identities', param: 'id', value: 'code', label: 'title' });
  });
  it('неполная или чужая — нет вариантов из среза (а не догадка)', () => {
    expect(optionsSpecOf({ slice: 'task_identities' })).toBeNull();
    expect(optionsSpecOf(null)).toBeNull();
    expect(optionsSpecOf('task_identities')).toBeNull();
  });
});
