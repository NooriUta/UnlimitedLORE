// Строки слайсов LORE → записи kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Чистые функции: экран отдаёт сюда тело слайса и получает KitData, по meta
// которого kit честно пишет «Показано N из M» / «обрезано» / «всего неизвестно».
import type { KitData, KitLang, KitRecord } from '@seidr/kit';
import { appT } from '../i18n';
import type { SliceBody } from '../api/loreClient';
import { planStatusOf } from '../sprints/taskStatus';
import { agentLabel } from '../people/whoLabel';
import { projectFullTitle, projectShortTitle } from '../project/projectTitle';
import { DECISION_STATUSES, FEATURE_STATUSES, QG_STATUSES, QUESTION_STATUSES, SPEC_STATUSES, axisStatusOf } from './axisStatus';

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
  /** Язык экрана: подписи значений, которые маппер называет словом (роль репозитория). Нет — русский. */
  lang?: KitLang;
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
      // MDL-13 «треки б»: трек — ребро ON_TRACK (срез sprints: track_id и подпись track_label); чип открывает паспорт трека,
      // по нему же — дорожки списка (группировка «Трек»).
      track: row.track_id ? [{ id: str(row.track_id), label: str(row.track_label) || str(row.track_id) }] : [],
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
      // Проекты спринта задачи (срез open_tasks/closed_tasks, project_slugs) — многозначное поле.
      project: list(row.project_slugs),
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
 * Строка слайса docs → запись kit (S5-DOC-PASSPORT).
 *
 * Статуса у документа нет — запись идёт с пустым статусом, а не с выдуманным.
 * Тела срез не тянет (только хеши и длины, DS-3): текст читает паспорт.
 */
export function docRecord(row: Row): KitRecord {
  const id = str(row.doc_id);
  const component = str(row.component_id);
  return {
    id,
    kind: 'doc',
    title: str(row.title) || id,
    status: '',
    fields: {
      component,
      components: component ? [component] : [],
      docKind: str(row.kind),
      parent: str(row.parent_doc_id),
      project: list(row.projects),
    },
  };
}

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-04: строка среза runbooks → запись kit. Статуса у ранбука в
 * срезе нет — пустой, а не выдуманный; ADR, на которые ранбук ссылается (REFERENCES_ADR), и проекты.
 */
export function runbookRecord(row: Row): KitRecord {
  const id = str(row.runbook_id);
  return {
    id, kind: 'runbook', title: str(row.name) || id, status: '',
    fields: { area: str(row.area), adrs: list(row.adr_ids), project: list(row.projects) },
  };
}

/**
 * MD-04, второй заход по QG: строка среза quality_gates → запись kit. Состояние гейта (draft /
 * active / stale / retired, ADR-LORE-053 D7) — статус записи на оси гейта: значение вне оси
 * становится unknown, пустое остаётся пустым (гейт без состояния виден, а не подогнан).
 * Итог последнего прогона — отдельное поле.
 */
export function qualityGateRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.qg_id);
  return {
    id, kind: 'quality_gate', title: str(row.name) || id,
    status: str(row.status) ? axisStatusOf(row.status, axisFor(ctx, QG_STATUSES)) : '',
    fields: {
      lastRun: str(row.last_run_status),
      component: str(row.component_id), components: list(row.components),
      project: list(row.projects), sprint: str(row.sprint_id),
    },
  };
}

/** Адрес без схемы: «https://github.com/a/b» → «github.com/a/b» (так в прототипе и в полном пути). */
const noScheme = (u: string): string => u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '').map(String) : str(v) ? [str(v)] : []);

/**
 * ADR-LORE-066 фаза А: репозиторий релиза / PR (рёбра RELEASE_OF / PR_OF) — ссылка на паспорт репозитория,
 * подпись — путь. Нет ребра — «не определён» текстом без ссылки (id пуст), а не проект вместо репозитория.
 */
function repositoryRef(row: Row, lang: KitLang): { id: string; label: string }[] {
  const url = str(row.repository);
  if (!url) return [{ id: '', label: appT(lang, 'lists.repository.undetermined') }];
  return [{ id: url, label: str(row.repository_path) || noScheme(url) }];
}

/** Роль репозитория в разделе: основной у проекта, репозиторий компонента, зеркало или не привязан. */
export type RepoRole = 'primary' | 'component' | 'mirror' | 'none';

export function repoRoleOf(row: Row): RepoRole {
  if (strList(row.project_roles).includes('primary')) return 'primary';
  if (strList(row.components).length) return 'component';
  if (strList(row.mirror_of).length) return 'mirror';
  return 'none';
}

/**
 * D-2026-MIG-REPOSITORY-ORGANIZATION: строка среза repositories → запись kit. Ключ — адрес (url), подпись —
 * полный путь. Проект — для группировки: свой (HAS_REPOSITORY), проект компонента, проект оригинала зеркала;
 * репозиторий в нескольких проектах — в каждой группе. Статуса нет — роль идёт полем словом экрана.
 */
export function repositoryRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.url);
  const role = repoRoleOf(row);
  const project = [...new Set([...strList(row.projects), ...strList(row.component_projects), ...strList(row.mirror_projects)])];
  return {
    id, kind: 'repository', title: str(row.full_path) || noScheme(id) || id, status: '',
    fields: {
      role: appT(ctx?.lang ?? 'ru', `lists.repoRole.${role}`),
      project, component: strList(row.components), components: strList(row.components),
      mirrors: strList(row.mirrors).map(noScheme), mirrorOf: strList(row.mirror_of).map(noScheme),
      host: str(row.host), hostOwner: str(row.owner), default_branch: str(row.default_branch),
    },
  };
}

/** D-2026-MIG-REPOSITORY-ORGANIZATION: строка среза organizations → запись kit. Связей у организации пока нет. */
export function organizationRecord(row: Row): KitRecord {
  const id = str(row.org_id);
  return { id, kind: 'organization', title: str(row.name) || id, status: '', fields: { name: str(row.name) } };
}

/** S9-05 A: строка среза users → запись kit. Статуса у человека нет — пустой, а не выдуманный. */
export function userRecord(row: Row): KitRecord {
  const id = str(row.kc_sub);
  // Пакет 1.18: заголовок — имя (из профиля или «Имя Фамилия» из KC), логин — рядом полем и в поиске.
  const login = str(row.login);
  return {
    id, kind: 'user', title: str(row.display_name) || login || id, status: '',
    fields: { project: list(row.projects), ...(login ? { login } : {}) },
    ...(login ? { search: login } : {}),
  };
}

/** S9-05 A: строка среза agents → запись kit. */
export function agentRecord(row: Row): KitRecord {
  const id = str(row.actor_id);
  return {
    // AO-AGENT-HUMAN-NAME: заголовок — «имя · профиль» (машины у среза нет), учётка — полем и в поиске.
    id, kind: 'agent', title: agentLabel({ name: str(row.name), harness: str(row.harness), clientId: str(row.client_id) }) || id, status: '',
    // Владелец — ИМЯ человека, опознаватель Keycloak остаётся запасным. Находка владелицы 22.11.2026: в колонке
    // стояли одни uuid, и в списке нельзя было узнать даже себя. Данные были целы — срез отдавал только kc_sub
    // (сторож agentOwnerName.test.ts).
    fields: { clientId: str(row.client_id), agentRole: str(row.agent_role), harness: str(row.harness), owner: str(row.owner_name) || str(row.owner), project: list(row.projects) },
    ...(str(row.client_id) ? { search: str(row.client_id) } : {}),
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
    // PU-27: срез вех отдаёт changed_at (версия цели, иначе правка вершины), а маппер
    // его не читал — у записи не было времени, и фильтр «Изменены» был недоступен.
    ...freshness(row),
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
/**
 * 1.18 (владелица 21.11.2026: «в меню под релизы вход в PR сделай»): строка среза prs → запись kit. Ключ — pr_uid
 * «проект#номер»; заголовка нет (старые PR) — подпись ключом. Релизы — по ключу «проект#тег», подпись — тег.
 * Время записи — момент мержа: свежие сверху по нему.
 */
/** Проекты PR чипами {id: ключ, label: краткое название}; связи с проектом нет — ключ из поля git_project. */
function prProjects(row: Row): { id: string; label: string }[] {
  const slugs = Array.isArray(row.project_slugs) ? row.project_slugs.map(str) : [];
  const titles = Array.isArray(row.project_titles) ? row.project_titles.map(str) : [];
  const out = slugs.filter(Boolean).map((id, i) => ({ id, label: titles[i] || id }));
  if (out.length) return out;
  const own = Array.isArray(row.git_projects) ? row.git_projects.map(str) : [str(row.git_projects)];
  return [...new Set(own.filter(Boolean))].map(id => ({ id, label: id }));
}

export function prRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.pr_uid);
  // Признак — значком, а не словом: фильтр «Быстро» одинаков на любом языке; нет признака — пусто.
  const yesNo = (b: boolean) => (b ? '✓' : '');
  const uids = Array.isArray(row.release_uids) ? row.release_uids.filter((x): x is string => typeof x === 'string' && !!x) : [];
  const head = str(row.head_ref), base = str(row.base_ref);
  return {
    id,
    kind: 'pr',
    title: str(row.title) || id,
    status: '',
    fields: {
      // #1708: проект — краткое название (связь BELONGS_TO_PROJECT), ключ — в ссылке; связи нет — ключ из поля git_project
      project: prProjects(row),
      state: str(row.state),
      merged_at: str(row.merged_at),
      branches: head || base ? `${head || '?'} → ${base || '?'}` : '',
      releases: uids.map(u => ({ id: u, label: u.slice(u.lastIndexOf('#') + 1) })),
      repository: repositoryRef(row, ctx?.lang ?? 'ru'),
      no_title: yesNo(!str(row.title)),
      no_release: yesNo(uids.length === 0),
    },
    ...freshness(row, str(row.merged_at)),
  };
}

export function releaseRecord(row: Row, ctx?: RowMapCtx): KitRecord {
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
      repository: repositoryRef(row, ctx?.lang ?? 'ru'),
      // Дата выпуска — поле календаря (K2-VIEW-CALENDAR); updated_at — время правки, не дата события.
      released: str(row.release_date),
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
      // S4-PRODUCT-HILITE: продукты компонента (IN_PRODUCT) — по ним красится запись.
      products: list(row.products),
    },
  };
}

/**
 * Строка слайса git_projects → запись kit (S4-29, решение 53а). **Статуса нет** —
 * проект справочная вершина; ключ — slug «владелец/репозиторий», им же
 * открывается паспорт (/lore/record/project/<slug>).
 */
export function projectRecord(row: Row, ctx?: RowMapCtx): KitRecord {
  const id = str(row.slug);
  const lang = ctx?.lang ?? 'ru';
  return {
    id,
    kind: 'project',
    // 1.18 (владелица 21.11.2026): строка подписана кратким названием на языке интерфейса; полное — полем
    title: projectShortTitle(row, lang) || id,
    status: '',
    fields: {
      full_title: projectFullTitle(row, lang),
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

// ─────────────────────────────────────────────────────────────────────────────
// Нода «Продукт» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-PRODUCTS-NODE, владелица 11.11):
// продукты и профиль клиента — боли, выгоды, работы, роли. Срезы — из каталога
// LoreSlices (products, pains, gains, jobs, actors). Тела (body_md, metric_md) в
// строку не идут — как у остальных разделов. Статуса у этих записей нет.
// ─────────────────────────────────────────────────────────────────────────────

/** Строка среза products → запись kit. Ключ — код; цвет — не поле строки, а краска (productPaint). */
export function productRecord(row: Row): KitRecord {
  const id = str(row.code);
  return {
    id,
    kind: 'product',
    title: str(row.label_ru) || id,
    status: '',
    fields: {
      parent: list(row.parent_code),
      children: list(row.sub_products),
      components: list(row.components),
      project: list(row.git_projects),
      // WK-01: вид продукта — набор tech | service (ADR-LORE-044); прежняя строка — набор из одного.
      product_kind: kindSet(row.kind),
    },
  };
}

const kindSet = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? [v] : []);

/** Строка среза pains → запись kit: чья боль, сколько сценариев её заявляют и сколько снимают. */
export function painRecord(row: Row): KitRecord {
  const id = str(row.pain_id);
  const claimed = num(row.addressed_by);
  const relieved = num(row.relieved_by);
  return {
    id,
    kind: 'pain',
    title: str(row.title) || id,
    status: '',
    fields: {
      severity: str(row.severity),
      actors: list(row.actor_ids),
      ...(claimed !== null ? { claimed } : {}),
      ...(relieved !== null ? { relieved } : {}),
    },
  };
}

/** Строка среза gains → запись kit: чья выгода, сколько сценариев её обещают и сколько дают. */
export function gainRecord(row: Row): KitRecord {
  const id = str(row.gain_id);
  const claimed = num(row.promised_by);
  const delivered = num(row.delivered_by);
  return {
    id,
    kind: 'gain',
    title: str(row.title) || id,
    status: '',
    fields: {
      rank: str(row.rank),
      actors: list(row.actor_ids),
      ...(claimed !== null ? { claimed } : {}),
      ...(delivered !== null ? { delivered } : {}),
    },
  };
}

/** Строка среза jobs → запись kit. Вид работы — `job_kind`: имя `kind` занято видом записи kit. */
export function jobRecord(row: Row): KitRecord {
  const id = str(row.job_id);
  const claimed = num(row.helped_by);
  const performed = num(row.performed_by);
  return {
    id,
    kind: 'job',
    title: str(row.title) || id,
    status: '',
    fields: {
      job_kind: str(row.kind),
      importance: str(row.importance),
      actors: list(row.actor_ids),
      ...(claimed !== null ? { claimed } : {}),
      ...(performed !== null ? { performed } : {}),
    },
  };
}

/** Строка среза actors → запись kit (пользовательская роль / клиентский сегмент). Вид — `actor_kind`. */
export function actorRecord(row: Row): KitRecord {
  const id = str(row.actor_id);
  const ucs = num(row.uc_count);
  return {
    id,
    kind: 'actor',
    title: str(row.name) || id,
    status: '',
    fields: {
      actor_kind: str(row.kind),
      project: list(row.projects),
      ...(ucs !== null ? { ucs } : {}),
    },
  };
}
