// Строки слайсов LORE → записи kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Чистые функции: экран отдаёт сюда тело слайса и получает KitData, по meta
// которого kit честно пишет «Показано N из M» / «обрезано» / «всего неизвестно».
import type { KitData, KitRecord } from '@seidr/kit';
import type { SliceBody } from '../api/loreClient';
import { planStatusOf } from '../sprints/taskStatus';
import { DECISION_STATUSES, FEATURE_STATUSES, QUESTION_STATUSES, SPEC_STATUSES, axisStatusOf } from './axisStatus';

type Row = Record<string, unknown>;

/**
 * Что маппер знает, кроме строки (S4-STATUS-AXIS-CONFIG, 11.11).
 *
 * `statusCodes` — коды цикла ТИПА из `/lore/model` (`statuses.<type>.entries`).
 * Пришли — статус строки сверяется с НИМИ: иначе статус, объявленный сервером,
 * но не известный перечню в коде, читался «вне словаря». Пусто или нет —
 * перечень в коде остаётся умолчанием (экран говорит об этом словами).
 */
export interface RowMapCtx {
  statusCodes?: readonly string[];
}

/** Ось для сверки: модель главнее, перечень в коде — умолчание. */
const axisFor = (ctx: RowMapCtx | undefined, fallback: readonly string[]): readonly string[] =>
  ctx?.statusCodes?.length ? ctx.statusCodes : fallback;

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

/**
 * Свежесть записи (updated_at kit) — время ПОСЛЕДНЕГО ИЗМЕНЕНИЯ, а не заведения
 * (вопрос №49 владелицы 10.11: «по последней дате изменения — это свежесть»).
 *
 * Сервер отдаёт его колонкой `changed_at` (valid_from открытой версии SCD2,
 * иначе дата заведения). `fallback` — прежний источник на случай среза без
 * колонки; у задач и спек его нет — времени тогда нет, и оно не выдумывается.
 */
function freshness(row: Row, fallback = ''): { updated_at?: string } {
  const at = str(row.changed_at) || fallback;
  return at ? { updated_at: at } : {};
}

/** Строка слайса sprints → запись kit. */
export function sprintRecord(row: Row): KitRecord {
  const id = str(row.sprint_id);
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
    ...freshness(row, str(row.valid_from) || str(row.created_date)),
  };
}

/** Строка слайса adrs → запись kit. */
export function adrRecord(row: Row): KitRecord {
  const id = str(row.adr_id);
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
    ...freshness(row, str(row.date_created)),
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
export function sliceToKitData<R>(
  body: SliceBody<R>,
  map: (row: R, ctx?: RowMapCtx) => KitRecord,
  generatedAt: string,
  ctx?: RowMapCtx,
): KitData {
  const records = body.rows.map(row => map(row, ctx));
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
 * Оговорка раздела «Задачи», пока закрытые скрыты (S4-V2-SECTIONS → фильтр 11.11).
 *
 * Закрытые и отменённые задачи — не «нет в выдаче», а скрыты фильтром по
 * умолчанию: `open_tasks` грузится сразу, `closed_tasks` — когда режим
 * «Показывать закрытые» их показывает (слово владелицы 11.11.2026: «ставь
 * фильтр по умолчанию, а не жёсткий хардкод»). Строка говорит, где фильтр
 * снять: иначе «Показано N из N» читается как «закрытых нет».
 */
export const CLOSED_HIDDEN_NOTE = 'закрытые и отменённые скрыты фильтром «Показывать закрытые: скрыть» — переключите его, чтобы загрузить и их';

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
      // S9-02: релизы спринта задачи (PART_OF → IMPLEMENTED_IN_RELEASE) —
      // то же имя поля, что у спринта, иначе фасеты разошлись бы.
      release: list(row.release_ids),
      effort: num(row.effort_days),
      work_class: str(row.work_class),
    },
    // Своего времени у задачи в срезе не было — только changed_at (вопрос №49).
    ...freshness(row),
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
export function decisionRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.decision_id);
  return {
    id,
    kind: 'decision',
    title: str(row.title) || id,
    status: axisStatusOf(row.status_raw, axisFor(ctx, DECISION_STATUSES)),
    fields: {
      component: str(row.component_id),
      components: list(row.components),
      project: list(row.projects),
      tags: list(row.tags),
      adr: str(row.parent_adr),
    },
    ...freshness(row, str(row.date_created)),
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
export function specRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.spec_id);
  return {
    id,
    kind: 'spec',
    title: str(row.title) || id,
    status: axisStatusOf(row.status, axisFor(ctx, SPEC_STATUSES)),
    fields: {
      component: str(row.component_id),
      version: str(row.version),
      path: str(row.file_path),
      project: list(row.projects),
    },
    // Своего времени у спеки в срезе не было — только changed_at (вопрос №49).
    ...freshness(row),
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
export function questionRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.question_id);
  return {
    id,
    kind: 'question',
    title: str(row.title) || id,
    status: axisStatusOf(row.status, axisFor(ctx, QUESTION_STATUSES)),
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
    ...freshness(row, str(row.opened_date)),
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
    ...freshness(row, str(row.release_date)),
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
 * Строка слайса git_projects → запись kit (S4-29, решение 53а). **Статуса нет** —
 * проект справочная вершина; ключ — slug «владелец/репозиторий», им же
 * открывается паспорт (/lore/record/project/<slug>).
 */
export function projectRecord(row: Row): KitRecord {
  const id = str(row.slug);
  return {
    id,
    kind: 'project',
    title: str(row.name) || id,
    status: '',
    fields: {
      default_branch: str(row.default_branch),
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
 * Оговорка раздела «Фичи и US» (S4-V2-SECTIONS, срез `use_cases`).
 *
 * ПРЕЖНЯЯ оговорка говорила про обрезку до корней шкалы целей: срез `features`
 * отбирал `goal_level IN ['cloud','kite']`, и раздел показывал 8 строк при 31
 * вложенном сценарии у них же. Срез `use_cases` отдаёт ВСЕ уровни, так что
 * обрезки больше нет — и оговорка про неё ушла вместе с причиной: «показаны
 * только верхние» при полной выдаче хуже молчания.
 *
 * Но срез и правда отдаёт не всё, другое: компонент и проект — только СВОИМ
 * ребром. Замер 10.11 по FEAT-LORE-HONEST: у 5 из 5 детей `component_ids` и
 * `projects` пусты, а `inherited_projects` заполнен — привязка наследуется от
 * фичи (S1-08), и `use_cases` наследованного не отдаёт. Без слов пустая
 * «Компонент»/«Проект» у вложенных сценариев читается как «не привязано»,
 * тогда как привязка есть у родителя.
 */
export const UC_OWN_LINKS_NOTE = 'компонент и проект показаны только свои: у вложенных сценариев их нет — они наследуются от фичи, а наследованных этот срез не отдаёт';

/**
 * Строка слайса `use_cases` → запись kit (фича ИЛИ сценарий — один тип
 * KnowUseCase на все уровни шкалы Коберна, PL-28).
 *
 * Статусы свои (shipped, active, in_rework и пусто) — это НЕ ось задач: у фичи
 * нет ни «заблокирована», ни «к выкатке». Поэтому у раздела свой словарь, а не
 * общий список статусов LORE.
 *
 * Числа сценариев и задач берутся готовыми (`uc_total`, `task_count`) — без
 * догрузки и без второго запроса. Прогресса «x/y» здесь НЕТ: второго числа
 * (`uc_shipped` — сколько детей поставлено) срез не отдаёт, а прогресс с одним
 * числом — либо прочерк в каждой строке, либо выдуманный ноль.
 *
 * Тел (body_md, context_md, scenario_md) срез не отдаёт вовсе — они в паспорте.
 */
export function featureRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.uc_id);
  const ucs = num(row.uc_total);
  const tasks = num(row.task_count);
  // Родитель — РЕБРОМ `DECOMPOSES_INTO` (так же читает его паспорт типа
  // feature); плоское `parent_uc_id` рядом с ним денормализация для индекса, а
  // не вторая правда, поэтому оно подставляется, только если ребра в строке нет.
  const byEdge = list(row.parent_uc_ids);
  const parent = Array.isArray(byEdge) && byEdge.length === 0 ? str(row.parent_uc_id) : byEdge;
  return {
    id,
    kind: 'feature',
    title: str(row.title) || id,
    status: axisStatusOf(row.status, axisFor(ctx, FEATURE_STATUSES)),
    fields: {
      components: list(row.component_ids),
      project: list(row.projects),
      level: str(row.goal_level),
      parent,
      shipped: str(row.shipped_at),
      // «Не прислали» не равно «ноль»: без числа поля нет вовсе, и kit рисует
      // «—», а не «0». Ноль, который ПРИШЁЛ, — честный ноль и остаётся.
      ...(ucs !== null ? { ucs } : {}),
      ...(tasks !== null ? { tasks } : {}),
      // Веха: столбца `milestone_id` в срезе `use_cases` НЕТ. Пустая строка
      // вместо него утверждала бы «вехи нет» про каждую запись, а быстрый
      // фильтр «Без вехи» на таком поле совпадает со ВСЕЙ выдачей ('' в kit
      // совпадает с отсутствующим значением). Поэтому поле кладётся только
      // тогда, когда столбец пришёл — хоть бы и пустым.
      ...('milestone_id' in row ? { milestone: str(row.milestone_id) } : {}),
    },
    ...freshness(row, str(row.date_created)),
  };
}
