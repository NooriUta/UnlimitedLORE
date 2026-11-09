// Раздел «Задачи» в v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Пункт «Задачи» в меню v2 был с самого начала, а экрана под ним не было:
// `SCREENS` в `V2Shell` его не знал, и раздел честно отвечал «экран не собран».
// Владелица 08.11: «про переходы и отображение всех объектов я молчу» — то
// есть это её главный пробел, и приоритет она поднимала.
//
// **Источник выбран не наугад.** `all_tasks` для списка не годится: он несёт
// `note_md`, и на живом замере весь корпус дал 4 млн символов на 57 730 строк
// (комментарий в `LoreSlices`, SE-01 — ровно поэтому и появился `open_tasks`).
// Поэтому раздел читает `open_tasks`: там только нужные колонки.
//
// **И у этого есть цена, которую нельзя замолчать.** `open_tasks` отдаёт ТОЛЬКО
// открытые задачи: закрытые и отменённые отсечены на сервере
// (`WHERE ... NOT LIKE done/cancelled`). Значит «Показано N из N» в этом
// разделе — правда про выдачу, но не про корпус, и человек, не зная этого,
// решит, что закрытых задач у него нет. Поэтому раздел говорит об этом словами
// предупреждением, а режим «закрытые внизу» ему не ставится: обещать
// сортировку закрытых, которых в выдаче не бывает, — обман.
import { describe, expect, it } from 'vitest';
import { valuesOf } from '@seidr/kit';
import { LIST_SCREENS } from './screens';
import { OPEN_ONLY_NOTE, taskListRecord } from './records';

const row = {
  task_uid: 'SPRINT_A/A-1', task_id: 'A-1', title: 'Сделать дело',
  status_raw: '🔄 IN PROGRESS', sprint_id: 'SPRINT_A',
  component_ids: ['LORE', 'FORSETI'], effort_days: 1.5, work_class: 'enb',
};

describe('S4-V2-SECTIONS · раздел «Задачи»', () => {
  it('положительный контроль: раздел описан и читает open_tasks, а не all_tasks', () => {
    expect(LIST_SCREENS.tasks.slice).toBe('open_tasks');
  });

  it('код задачи — «спринт/код»: по нему открывается паспорт и строится ссылка', () => {
    const r = taskListRecord(row);
    expect(r.id).toBe('SPRINT_A/A-1');
    expect(r.kind).toBe('task');
  });

  it('статус приведён к словарю, а не показан сырым', () => {
    expect(taskListRecord(row).status).toBe('active');
    // Пустой статус у задачи бывает, и канон оси (D-2026-UXR-STATUS-AXIS)
    // называет его «unknown» — отдельным значением, а не пустотой и уж точно
    // не «активна»: «статус неизвестен» ≠ «статуса нет».
    expect(taskListRecord({ ...row, status_raw: null }).status).toBe('unknown');
  });

  it('спринт и компоненты — поля записи; компоненты списком, а не склейкой', () => {
    const r = taskListRecord(row);
    expect(valuesOf(r, 'fields.sprint')).toEqual(['SPRINT_A']);
    expect(valuesOf(r, 'fields.components')).toEqual(['LORE', 'FORSETI']);
  });

  it('оценка — число, а не строка: по ней сортируют', () => {
    expect(taskListRecord(row).fields.effort).toBe(1.5);
    expect(taskListRecord({ ...row, effort_days: null }).fields.effort).toBeNull();
  });

  it('без заголовка заголовком становится код — пустая строка списка не нужна', () => {
    expect(taskListRecord({ ...row, title: null }).title).toBe('SPRINT_A/A-1');
  });

  it('у раздела есть фасеты и группировки — иначе список из тысяч строк неподъёмен', () => {
    const cfg = LIST_SCREENS.tasks.config('ru');
    expect(cfg.list?.filters?.length).toBeGreaterThan(1);
    expect(cfg.list?.groupings).toContain('status');
  });

  it('разрез по спринту назван свёрнутым: спринтов много (S9-02)', () => {
    const cfg = LIST_SCREENS.tasks.config('ru');
    expect(cfg.list?.collapsedGroupings).toContain('fields.sprint');
  });

  it('«закрытые внизу» разделу НЕ ставится: закрытых в этой выдаче не бывает', () => {
    const cfg = LIST_SCREENS.tasks.config('ru');
    expect(cfg.list?.showClosed).toBe('hide');
  });

  it('оговорка про открытые задачи названа словами и живёт в одном месте', () => {
    expect(OPEN_ONLY_NOTE).toMatch(/открыт/i);
    expect(OPEN_ONLY_NOTE).toMatch(/закрыт/i);
  });
});
