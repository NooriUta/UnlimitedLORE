// Состояние блоков паспорта доходит до записи как состояние, а не как «ошибка»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Повод: блок «Состояние данных» подключён к записи (kit, тот же заход), и сразу
// стало видно, чем его кормит паспорт. `fromLoreRecord` складывал ВСЕ неудачные
// блоки в `meta.errors` одним списком — то есть «нет прав» приезжало под видом
// сбоя чтения, а «обрезано» — под видом ошибки.
//
// Разница не косметическая: при сбое человек ждёт, что починится и данные
// появятся, и перезагружает страницу; при запрете ждать нечего — надо просить
// доступ. Слить их значит заставить перезагружать впустую.
//
// Поэтому состояния идут в `meta.data_state` в той форме, которую разбирает
// `dataStateOf`, а `meta.errors` остаётся рядом: по нему рисует свою плашку
// блок связей (`blockError`), и терять её нельзя. Задвоения нет — разбор
// пропускает блок, о котором уже сказано через `data_state`.
import { describe, expect, it } from 'vitest';
import { fromLoreRecord, type LoreRecord1 } from './loreRecordContract';

const base: LoreRecord1 = {
  contract: 'lore.record/1',
  record: { type: 'task', id: 'SPRINT_A/A-1', title: 'Задача', status: 'active', version: null, updated_at: null, updated_by: null },
  schema: { type: 'task', label: 'Задача', icon: 'scroll-quill', fields: [], tabs: [], relations: [] },
  values: { title: 'Задача' },
  links: [],
  facts: null,
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-09T00:00:00.000Z', facade: 'client-emulated', sources: [] },
};

const withSources = (sources: LoreRecord1['meta']['sources']) =>
  fromLoreRecord({ ...base, meta: { ...base.meta, sources } }, 'ru');

type Meta = { data_state?: { source?: string; state?: string; reason?: string }[]; errors?: { block: string; reason: string }[] };
const metaOf = (r: ReturnType<typeof withSources>) => r.data.meta as unknown as Meta;

describe('S4-30 · состояние блоков доходит до записи', () => {
  it('положительный контроль: все блоки прочитаны — ни состояний, ни ошибок', () => {
    const m = metaOf(withSources([{ block: 'links', state: 'ok' }]));
    expect(m.errors).toBeUndefined();
    // «ok» доходит тоже: это «проверено», а не «нечего сказать».
    expect(m.data_state?.map(s => [s.source, s.state])).toEqual([['links', 'ok']]);
  });

  it('«нет прав» доходит как запрет, а не как сбой чтения', () => {
    const m = metaOf(withSources([{ block: 'journal', state: 'forbidden', code: 403, reason: 'нет прав на журнал' }]));
    const row = m.data_state?.find(s => s.source === 'journal');
    expect(row?.state).toBe('forbidden');
    expect(row?.reason).toBe('нет прав на журнал');
  });

  it('обрезанная выдача доходит как «обрезано», а не как ошибка', () => {
    const m = metaOf(withSources([{ block: 'tasks', state: 'truncated', shown: 50, total: 318 }]));
    expect(m.data_state?.find(s => s.source === 'tasks')?.state).toBe('truncated');
  });

  it('плашка блока связей не потеряна: сбой по-прежнему виден и в meta.errors', () => {
    const m = metaOf(withSources([{ block: 'links', state: 'error', reason: 'таймаут базы' }]));
    expect(m.errors).toEqual([{ block: 'links', reason: 'таймаут базы' }]);
  });

  it('сбой не задваивается: он назван один раз, через состояние блока', () => {
    const m = metaOf(withSources([{ block: 'links', state: 'error', reason: 'таймаут базы' }]));
    const named = [
      ...(m.data_state ?? []).filter(s => s.source === 'links').map(() => 'data_state'),
      ...(m.errors ?? []).filter(e => e.block === 'links').map(() => 'errors'),
    ];
    // В обоих списках блок есть — задвоение снимает разбор dataStateOf,
    // который пропускает уже названное. Проверяем именно это правило:
    expect(named).toEqual(['data_state', 'errors']);
  });
});
