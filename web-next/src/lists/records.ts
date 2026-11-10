// Строки слайсов LORE → записи kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Чистые функции: экран отдаёт сюда тело слайса и получает KitData, по meta
// которого kit честно пишет «Показано N из M» / «обрезано» / «всего неизвестно».
import type { KitData, KitRecord } from '@seidr/kit';
import type { SliceBody } from '../api/loreClient';
import { planStatusOf } from '../sprints/taskStatus';
import { decisionStatusOf, featureStatusOf, questionStatusOf, specStatusOf } from './axisStatus';

type Row = Record<string, unknown>;

/** «📋 PLANNED» → «planned», «READY FOR DEPLOY» → «ready_for_deploy». */
export function normStatus(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z_ ]+/g, ' ').trim().replace(/\s+/g, '_');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/**
 * Список (рёбра графа) → список значений. Пустой — `[]`.
 *
 * **Раньше здесь была склейка в одну строку «A, B», и она теряла данные.**
 * Фасет «Компоненты» показывал одно значение «LORE, FORSETI» вместо двух,
 * выбрать один компонент было нельзя, а фильтр «релиз = lore-v1.18.0» не
 * находил спринт с двумя релизами: склеенная строка не равна ни одному из них.
 * «Без релиза» при этом работало (склейка пустого списка — ''), поэтому беда и
 * не бросалась в глаза: половина кнопок работала.
 *
 * Для показа склейка тоже не нужна: `ListView.valueCell` сам рисует каждое
 * значение своим чипом через `valuesOf`. То есть склейка только теряла данные
 * — ради вида, который без неё получается лучше.
 *
 * Одно значение (не массив) остаётся строкой: у него нет многозначности, и
 * заворачивать его в список незачем.
 */
const list = (v: unknown): string[] | string =>
  Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '').map(String) : str(v);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Строка слайса sprints → запись kit. */
export function sprintRecord(row: Row): KitRecord {
  const id = str(row.sprint_id);
  const updated = str(row.valid_from) || str(row.created_date);
  return {
    id,
    kind: 'sprint',
    title: str(row.name) || id,
    // Только словарём (planStatusOf): наивная склейка давала «вне словаря: in_progress» (08.11).
    status: planStatusOf(typeof row.status_raw === 'string' ? row.status_raw : null),
    fields: {
      project: list(row.git_projects),
      components: list(row.components),
      release: list(row.release_ids),
      milestone: list(row.milestone_ids),
      priority: num(row.priority),
      planned_start: str(row.planned_start_date),
      planned_end: str(row.planned_end_date),
      done_date: str(row.done_date),
    },
    ...(updated ? { updated_at: updated } : {}),
  };
}

/** Строка слайса adrs → запись kit. */
export function adrRecord(row: Row): KitRecord {
  const id = str(row.adr_id);
  const created = str(row.date_created);
  return {
    id,
    kind: 'adr',
    title: str(row.name) || id,
    status: normStatus(row.status),
    fields: {
      component: str(row.component),
      components: list(row.components),
      project: list(row.git_projects),
      tags: list(row.tags),
      decisions: num(row.decision_count),
    },
    ...(created ? { updated_at: created } : {}),
  };
}

/**
 * Тело слайса → KitData. Полнота (S1):
 *  - truncated:true — потолок сервера: итог неизвестен (page.total — число уже
 *    обрезанных строк, «из N» по нему соврало бы);
 *  - page.has_more — страница: итог = page.total;
 *  - truncated:"unknown" — проверить нечем: обрезано без итога;
 *  - иначе — полная выдача, итог = число строк.
 */
export function sliceToKitData<R>(body: SliceBody<R>, map: (row: R) => KitRecord, generatedAt: string): KitData {
  const records = body.rows.map(map);
  const meta: KitData['meta'] = { generated_at: generatedAt, returned: records.length };
  if (body.truncated === true || body.truncated === 'unknown') {
    meta.truncated = true;
  } else if (body.page?.has_more) {
    meta.truncated = true;
    meta.total = body.page.total;
  } else {
    meta.truncated = false;
    meta.total = records.length;
  }
  if (body.scope?.applied) meta.scope = body.scope.note ?? 'project';
  return { records, edges: [], journal: [], meta };
}

/** Предупреждения сервера для показа над списком — без дублей, в порядке появления. */
export function sliceWarnings(body: SliceBody<unknown>): string[] {
  const out: string[] = [];
  const add = (w: string | undefined) => { if (w && !out.includes(w)) out.push(w); };
  (body.warnings ?? []).forEach(add);
  if (body.truncated !== undefined && body.truncated !== false) add(body.hint);
  add(body.page?.warning);
  add(body.scope?.note);
  add(body.outside_scope?.reason);
  // Сужение по выбранным проектам (S4-03): три разных утверждения, и ни одно
  // не должно выглядеть как «данных нет».
  const sp = body.scope_projects;
  if (sp) {
    // Объяснение сервер шлёт то в `note` (проекты вне прав), то в `reason`
    // (срез без проектной привязки) — смысл тот же, берём что есть (B11).
    // Оба ключа сразу — показываем один раз, информативнее note.
    const why = sp.note ?? sp.reason;
    if (!sp.applied) {
      add(why
        ? `выбор проектов не применён: ${why}`
        : 'выбор проектов не применён: этот срез не привязан к проектам');
    } else {
      // Отброшенные правами называем: иначе человек видит меньше записей и не
      // знает, что часть выбранных проектов ему просто недоступна. Синтезируем
      // свою строку, только если сервер не прислал объяснение — оно уже
      // называет отброшенные, повтор был бы дублем.
      if (sp.dropped && sp.dropped.length && !why) {
        add(`недоступны и не вошли в сужение: ${sp.dropped.join(', ')}`);
      }
      if (why) add(why);
    }
  }
  return out;
}

/**
 * Оговорка раздела «Задачи» (S4-V2-SECTIONS).
 *
 * `open_tasks` отдаёт только открытые задачи: закрытые и отменённые отсечены на
 * сервере. Значит «Показано N из N» — правда про выдачу, но не про корпус, и
 * человек, не зная этого, решит, что закрытых задач у него нет.
 *
 * Строка живёт здесь, рядом с маппером, чтобы её нельзя было потерять при
 * смене среза: поменяется источник — поменяется и она.
 */
export const OPEN_ONLY_NOTE = 'показаны открытые задачи: закрытые и отменённые этот срез не отдаёт';

/**
 * Строка слайса `open_tasks` → запись kit (S4-V2-SECTIONS).
 *
 * Код записи — `task_uid` («спринт/код»): по нему открывается паспорт и
 * строится ссылка. Отдельного `task_id` в коде мало — он повторяется в разных
 * спринтах.
 */
export function taskListRecord(row: Row): KitRecord {
  const id = str(row.task_uid);
  return {
    id,
    kind: 'task',
    title: str(row.title) || id,
    // Канон словаря, а не сырой статус: наивная склейка давала «вне словаря».
    status: planStatusOf(typeof row.status_raw === 'string' ? row.status_raw : null),
    fields: {
      code: str(row.task_id),
      sprint: str(row.sprint_id),
      components: list(row.component_ids),
      effort: num(row.effort_days),
      work_class: str(row.work_class),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Остальные восемь разделов v2 (S4-V2-SECTIONS): решения, спеки, вопросы, вехи,
// релизы, компоненты, технологии, фичи.
//
// Колонки и словари статусов — не из головы: каждый срез замерен живым
// запросом, числа и распределения записаны в задаче. Из замера следуют три
// правила, которые видны ниже в коде:
//
//  1. **У четырёх типов статуса нет вовсе** (вехи, релизы, компоненты,
//     технологии). Им не ставится ни фасет, ни колонка статуса, а словарь
//     статусов раздела пуст — kit это теперь умеет (K-14). Фиктивный статус
//     рисовал бы чип, которого у записи нет.
//  2. **Тела в колонку не идут.** Срез вопросов несёт body_md (576 КБ на 262
//     строки), спеки — summary, фичи — body_md и context_md, реестр технологий
//     — content_md. Для списка они не нужны, и маппер их НЕ переносит: иначе
//     каждая строка таскает статью.
//  3. **Многозначное остаётся списком** (list), а не склеивается: склейка уже
//     однажды сломала фасеты (см. комментарий к list выше).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Строка слайса decisions → запись kit.
 *
 * Статус берётся каноном normStatus: в корпусе 778 решений и девять видов
 * значения, включая 46 пустых и ОДНУ строку «🚫 CANCELLED» — статус задачи,
 * попавший в поле статуса решения. Канон опознает её как cancelled, но это
 * грязь в данных, а не вид статуса решения (передано серверной сессии).
 */
export function decisionRecord(row: Row): KitRecord {
  const id = str(row.decision_id);
  const created = str(row.date_created);
  return {
    id,
    kind: 'decision',
    title: str(row.title) || id,
    status: decisionStatusOf(row.status_raw),
    fields: {
      component: str(row.component_id),
      components: list(row.components),
      project: list(row.projects),
      tags: list(row.tags),
      adr: str(row.parent_adr),
    },
    ...(created ? { updated_at: created } : {}),
  };
}

/**
 * Строка слайса specs → запись kit.
 *
 * Статус приходит с открытой ревизии и ПУСТ У 90%: замер — 353 из 390 строк
 * без статуса, 31 proposed, 6 accepted. Поэтому разрез по умолчанию у раздела
 * — компонент, а не статус: группировка по статусу сложила бы 353 строки в
 * «неизвестно» и ничего не разделила.
 *
 * Аннотация ревизии (summary) в запись не переносится — это тело, а не поле
 * строки. Путь к файлу переносится, но колонкой не ставится: он длинный.
 */
export function specRecord(row: Row): KitRecord {
  const id = str(row.spec_id);
  return {
    id,
    kind: 'spec',
    title: str(row.title) || id,
    status: specStatusOf(row.status),
    fields: {
      component: str(row.component_id),
      version: str(row.version),
      path: str(row.file_path),
      project: list(row.projects),
    },
  };
}

/**
 * Строка слайса questions → запись kit.
 *
 * **Срез именно questions, а не open_questions.** Второй — синоним на переход,
 * оставшийся от прежней версии, и он отдаёт ВСЕ вопросы, несмотря на имя:
 * замер — 262 строки, из них 182 закрытых. В решении
 * D-2026-LORE-QUESTIONS-SLICE-RENAME названа ровно эта беда: «потребители
 * читали закрытые как открытые». Имя обещало фильтр, которого нет.
 *
 * Тело вопроса (body_md) не переносится: 576 КБ на 262 строки.
 */
export function questionRecord(row: Row): KitRecord {
  const id = str(row.question_id);
  const opened = str(row.opened_date);
  return {
    id,
    kind: 'question',
    title: str(row.title) || id,
    status: questionStatusOf(row.status),
    fields: {
      component: str(row.component_id),
      components: list(row.components),
      project: list(row.projects),
      priority: str(row.priority),
      owner: str(row.owner),
      due: str(row.due_date),
      gates: list(row.gating_tasks),
      adr: list(row.raised_adr),
    },
    ...(opened ? { updated_at: opened } : {}),
  };
}

/**
 * Строка слайса milestones → запись kit. **Статуса у вехи нет** — ни в одном
 * поле среза; есть priority (critical/high/medium/low/P0 и пусто) и week.
 *
 * Название вехи живёт в label, а не в title. Цель и решения (goal_md,
 * decisions_md) — тела, в строку не идут.
 *
 * Список спринтов приходит с дырами: у вехи без спринтов это массив из одного
 * null. Функция list их отбрасывает, поэтому «спринтов 0» получается честно, а
 * не «спринт: null».
 */
export function milestoneRecord(row: Row): KitRecord {
  const id = str(row.milestone_id);
  return {
    id,
    kind: 'milestone',
    title: str(row.label) || id,
    status: '',
    fields: {
      week: num(row.week),
      when: str(row.date_display),
      priority: str(row.priority),
      products: list(row.products),
      sprints: list(row.direct_sprint_ids),
    },
  };
}

/**
 * Строка слайса releases → запись kit. **Статуса у релиза нет**; есть type
 * (релиз/хотфикс) и признак текущего.
 *
 * Код записи — release_uid (деловой ключ «проект-версия»), а не release_id и не
 * тег: тег у разных проектов повторяется.
 */
export function releaseRecord(row: Row): KitRecord {
  const id = str(row.release_uid) || str(row.release_id);
  const date = str(row.release_date);
  return {
    id,
    kind: 'release',
    title: str(row.git_tag) || str(row.version) || id,
    status: '',
    fields: {
      version: str(row.version),
      type: str(row.type),
      week: num(row.week),
      current: row.is_current === true,
      project: list(row.projects),
      sprints: num(row.sprint_count),
      prs: num(row.pr_count),
    },
    ...(date ? { updated_at: date } : {}),
  };
}

/**
 * Строка слайса components → запись kit. **Статуса нет** — это справочник.
 *
 * У компонента в данных есть своя иконка (game_icon), но KitRecord поля иконки
 * не имеет: иконку записи kit берёт от ВИДА, а не от строки. Поэтому иконка
 * компонента здесь не теряется молча — она переносится полем icon и ждёт
 * поддержки иконки на строке в kit (записано в задаче).
 */
export function componentRecord(row: Row): KitRecord {
  const id = str(row.component_id);
  return {
    id,
    kind: 'component',
    title: str(row.full_name) || id,
    status: '',
    fields: {
      area: str(row.area),
      parent: str(row.parent_id),
      owner: str(row.owner),
      team: str(row.team),
      icon: str(row.game_icon),
      children: list(row.children),
      tech: list(row.tech),
      project: list(row.git_projects),
      adrs: num(row.adr_count),
      specs: num(row.spec_count),
    },
  };
}

/**
 * Строка слайса tech_registry → запись kit. **Статуса нет** — это реестр
 * версий. Тело спеки технологии (content_md) не переносится.
 *
 * Код записи — spec_id: реестр живёт спеками SPEC-TECH-*, то есть это тот же
 * объект, что в разделе «Спеки». Два раздела на один тип — намеренно: реестр
 * отвечает на «какая версия и когда проверяли», спеки — на «что описано».
 */
export function techRecord(row: Row): KitRecord {
  const id = str(row.spec_id);
  const checked = str(row.checked_at);
  return {
    id,
    kind: 'tech',
    title: str(row.tech_name) || id,
    status: '',
    fields: {
      version: str(row.version),
      component: str(row.component_id),
      checked,
    },
    ...(checked ? { updated_at: checked } : {}),
  };
}

/**
 * Оговорка раздела «Фичи» (S4-V2-SECTIONS).
 *
 * Срез режет выдачу условием `goal_level IN ['cloud','kite']` — это КОРНИ шкалы
 * целей. Сценарии нижних уровней (sea, fish), то есть US, в него не попадают
 * вовсе, а беспараметрического среза «все уровни» на сервере нет:
 * `use_cases_of_component` требует компонент. Поэтому раздел показывает фичи, а
 * не «фичи и US», и говорит об этом словами: без оговорки «Показано 8 из 8»
 * прочтётся как «сценариев у нас восемь».
 */
export const FEATURE_ROOTS_NOTE = 'показаны фичи верхних уровней (cloud, kite): сценарии нижних уровней этот срез не отдаёт — они видны на компоненте';

/**
 * Строка слайса features → запись kit.
 *
 * Статусы фич свои (shipped, active, in_rework и пусто) — это НЕ ось задач: у
 * фичи нет ни «заблокирована», ни «к выкатке». Поэтому у раздела свой словарь,
 * а не общий список статусов LORE.
 *
 * Прогресс «сценариев x/y» считать не нужно: срез уже отдаёт uc_total и
 * uc_shipped, поэтому поле ucs сразу кладётся в форму колонки прогресса kit
 * ({done, total}) — без догрузки и без второго запроса.
 *
 * Ценность и контекст фичи (body_md, context_md) не переносятся — тела.
 */
export function featureRecord(row: Row): KitRecord {
  const id = str(row.uc_id);
  const created = str(row.date_created);
  const total = num(row.uc_total);
  const done = num(row.uc_shipped);
  return {
    id,
    kind: 'feature',
    title: str(row.title) || id,
    status: featureStatusOf(row.status),
    fields: {
      components: list(row.component_ids),
      project: list(row.projects),
      level: str(row.goal_level),
      milestone: str(row.milestone_id),
      parent: str(row.parent_uc_id),
      shipped: str(row.shipped_at),
      // «Значений нет» не равно «ноль из ноля»: без обоих чисел поле не
      // кладётся вовсе, и kit рисует «—», а не «0/0».
      ...(total !== null && done !== null ? { ucs: { done, total } } : {}),
    },
    ...(created ? { updated_at: created } : {}),
  };
}
