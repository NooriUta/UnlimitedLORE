// Валидатор конфига и данных Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-01).
// Ручной, без ajv: kit не тянет зависимость ради десятка правил, а функции
// конфига (verdict, render, hooks) JSON-схема всё равно не выражает.
// Структура совпадает с schema/*.schema.json — это сторожит core.test.ts.
//
// Два уровня: error — kit с этим не отрисует честно (нет обязательного поля,
// сырой цвет, битая ссылка в словаре); warning — отрисует, но что-то
// разошлось с контрактом или с конфигом (неизвестный ключ, висячее ребро,
// returned ≠ числу записей). Ничего не роняется: на любой вход — список.
import type { KitConfig, KitData } from './contract';
import { LORE_STATUS_AXIS } from './statusAxis';

export interface KitIssue {
  /** Путь в стиле JS: `statuses.items[0].color`. */
  path: string;
  level: 'error' | 'warning';
  /** Машинный код правила — по нему UI подбирает текст. */
  code: string;
  message: string;
}

export interface KitValidation {
  ok: boolean;
  errors: KitIssue[];
  warnings: KitIssue[];
}

/** Токены темы, допустимые как цвет в конфиге (`var(--acc)` и т. п.). */
export const KIT_COLOR_TOKENS = [
  'acc', 'suc', 'wrn', 'dng', 'inf', 't1', 't2', 't3', 'bd', 'bdh',
  'st-active', 'st-backlog', 'st-blocked', 'st-cancelled', 'st-deferred',
  'st-design', 'st-done', 'st-partial', 'st-planned', 'st-ready_for_deploy', 'st-todo',
] as const;

/**
 * Цвет в конфиге — ТОКЕН, и проверяется его ФОРМА, а не принадлежность к
 * перечню статусов LORE (SPRINT_UXR_S10_SEIDR_KIT/K-14).
 *
 * Было наоборот: разрешался только токен из `KIT_COLOR_TOKENS`, то есть kit
 * решал, какие статусы приложению позволено иметь. Это уже сработало против
 * самой LORE (`--st-ready_for_deploy` был в теме, но не в списке), а чужому
 * приложению со своими статусами оставляло только форк — ровно та угроза, о
 * которой K-10.
 *
 * Правило «цвета только токенами, никаких сырых hex» (владелица) остаётся:
 * сырое значение — ошибка. Незнакомый токен — предупреждение, чтобы опечатку
 * было видно, но своё имя приложению не запрещалось.
 */
const COLOR_RE = /^var\(--[A-Za-z][\w-]*\)$/;

/** Имя токена из `var(--имя)`; null — форма не та. */
function tokenName(v: string): string | null {
  const m = /^var\(--([A-Za-z][\w-]*)\)$/.exec(v);
  return m ? m[1] : null;
}
// Слаг game-icons или «lucide:имя» (второй набор v1, S4-25).
const ICON_RE = /^(lucide:)?[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS_CODE_RE = /^[A-Za-z0-9_-]+$/;
// ISO 8601 дата или дата-время (с зоной или без) — того достаточно для
// «дата, а не произвольная строка»; календарную корректность проверяет Date.
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const CONFIG_KEYS = ['modules', 'menu', 'kinds', 'edges', 'graph', 'statuses', 'roles', 'verdict', 'list', 'palette', 'hooks'];
const RECORD_KEYS = ['id', 'kind', 'title', 'status', 'fields', 'body_md', 'updated_at'];
const LIST_VIEWS = ['list', 'cards', 'board', 'tree', 'feed', 'timeline'];
/**
 * Категории статуса: ось владелицы (D-2026-UXR-STATUS-AXIS, шесть значений)
 * плюс прежние четыре — старые конфиги должны проходить проверку.
 *
 * До S4-STATUS-AXIS-CONFIG здесь были только старые четыре, и конфигурация
 * с осью из модели не прошла бы проверку вовсе.
 */
const STATUS_CATEGORIES = [...LORE_STATUS_AXIS, 'todo', 'active', 'done', 'cancelled'];
const FIELD_TYPES = ['text', 'md', 'enum', 'ref', 'date', 'number'];

export interface ValidateConfigOptions {
  /** Проверка существования слага в наборе иконок (registerGameIcons/hasGameIcon). */
  iconExists?: (slug: string) => boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

class Collector {
  readonly errors: KitIssue[] = [];
  readonly warnings: KitIssue[] = [];
  err(path: string, code: string, message: string) { this.errors.push({ path, level: 'error', code, message }); }
  warn(path: string, code: string, message: string) { this.warnings.push({ path, level: 'warning', code, message }); }
  result(): KitValidation { return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings }; }

  /** Обязательная непустая строка. */
  str(o: Obj, key: string, base: string, opts: { allowEmpty?: boolean } = {}): string | undefined {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { this.err(p, 'required', `нет обязательного поля ${p}`); return undefined; }
    if (!isStr(v)) { this.err(p, 'type', `${p} должно быть строкой`); return undefined; }
    if (!opts.allowEmpty && v.trim() === '') { this.err(p, 'empty', `${p} не может быть пустым`); return undefined; }
    return v;
  }
  optStr(o: Obj, key: string, base: string): void {
    if (o[key] !== undefined && !isStr(o[key])) this.err(join(base, key), 'type', `${join(base, key)} должно быть строкой`);
  }
  optBool(o: Obj, key: string, base: string): void {
    if (o[key] !== undefined && typeof o[key] !== 'boolean') this.err(join(base, key), 'type', `${join(base, key)} должно быть true/false`);
  }
  arr(o: Obj, key: string, base: string, required: boolean): unknown[] | undefined {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return undefined; }
    if (!Array.isArray(v)) { this.err(p, 'type', `${p} должно быть массивом`); return undefined; }
    return v;
  }
  obj(o: Obj, key: string, base: string, required: boolean): Obj | undefined {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return undefined; }
    if (!isObj(v)) { this.err(p, 'type', `${p} должно быть объектом`); return undefined; }
    return v;
  }
  enumOf(o: Obj, key: string, base: string, allowed: readonly unknown[], required: boolean): void {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return; }
    if (!allowed.includes(v)) this.err(p, 'enum', `${p}: «${String(v)}» не из перечня ${allowed.join('|')}`);
  }
  fn(o: Obj, key: string, base: string, required: boolean, allowString = false): void {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return; }
    if (typeof v === 'function' || (allowString && isStr(v))) return;
    this.err(p, 'function', `${p} должно быть функцией`);
  }
  color(o: Obj, key: string, base: string, required: boolean): void {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return; }
    if (!isStr(v) || !COLOR_RE.test(v)) {
      this.err(p, 'color-token', `${p}: цвет только токеном вида var(--имя); сырые значения запрещены, получено «${String(v)}»`);
      return;
    }
    // Токен не из темы kit — возможно, свой токен приложения (это законно), а
    // возможно, опечатка. Поэтому предупреждение, а не отказ.
    const name = tokenName(v);
    if (name && !(KIT_COLOR_TOKENS as readonly string[]).includes(name)) {
      this.warn(p, 'color-token-unknown',
        `${p}: токен «--${name}» не из темы kit — если это токен приложения, объявите его в своей теме; иначе проверьте опечатку`);
    }
  }
  icon(o: Obj, key: string, base: string, required: boolean, exists?: (s: string) => boolean): void {
    const p = join(base, key);
    const v = o[key];
    if (v === undefined) { if (required) this.err(p, 'required', `нет обязательного поля ${p}`); return; }
    if (!isStr(v) || !ICON_RE.test(v)) { this.err(p, 'icon-slug', `${p}: нужен слаг game-icons (compass, scroll-quill…) или lucide:имя, получено «${String(v)}»`); return; }
    if (exists && !exists(v)) this.err(p, 'icon-missing', `${p}: иконки «${v}» нет в наборе game-icons`);
  }
  unknownKeys(o: Obj, known: readonly string[], base: string, hint: string): void {
    for (const k of Object.keys(o)) if (!known.includes(k)) this.warn(join(base, k), 'unknown-key', `${join(base, k)}: ключа нет в контракте kit — ${hint}`);
  }
  /** Уникальность значения в пределах набора. */
  unique(seen: Set<string>, value: string | undefined, path: string, what: string): void {
    if (value === undefined) return;
    if (seen.has(value)) this.err(path, 'duplicate', `${path}: ${what} «${value}» повторяется`);
    seen.add(value);
  }
}

function join(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

/** Проверить конфиг kit против контракта (contract.ts / kit-config.schema.json). */
export function validateKitConfig(input: unknown, opts: ValidateConfigOptions = {}): KitValidation {
  const c = new Collector();
  if (!isObj(input)) { c.err('', 'type', 'конфиг kit должен быть объектом'); return c.result(); }
  const cfg = input;
  const icons = opts.iconExists;
  c.unknownKeys(cfg, CONFIG_KEYS, '', 'kit его не прочтёт');

  // modules
  const modules = c.arr(cfg, 'modules', '', true);
  if (modules) {
    if (modules.length === 0) c.err('modules', 'empty', 'нужен хотя бы один модуль');
    const seen = new Set<string>();
    modules.forEach((m, i) => {
      const p = `modules[${i}]`;
      if (!isObj(m)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
      c.unique(seen, c.str(m, 'id', p), `${p}.id`, 'id модуля');
      c.str(m, 'title', p);
      c.icon(m, 'icon', p, true, icons);
      c.enumOf(m, 'status', p, ['planned', 'active'], false);
      c.unknownKeys(m, ['id', 'title', 'icon', 'status'], p, 'kit его не прочтёт');
    });
  }

  // kinds (до меню: меню ссылается на виды)
  const kinds = c.obj(cfg, 'kinds', '', true);
  const kindKeys = new Set(kinds ? Object.keys(kinds) : []);
  if (kinds) {
    if (kindKeys.size === 0) c.err('kinds', 'empty', 'нужен хотя бы один вид записей');
    for (const [key, k] of Object.entries(kinds)) {
      const p = `kinds.${key}`;
      if (!isObj(k)) { c.err(p, 'type', `${p} должно быть объектом`); continue; }
      c.str(k, 'title', p);
      c.icon(k, 'icon', p, true, icons);
      c.fn(k, 'overview', p, false, true);
      const tabs = c.arr(k, 'tabs', p, false);
      const tabSeen = new Set<string>();
      tabs?.forEach((t, i) => {
        const tp = `${p}.tabs[${i}]`;
        if (!isObj(t)) { c.err(tp, 'type', `${tp} должно быть объектом`); return; }
        c.unique(tabSeen, c.str(t, 'key', tp), `${tp}.key`, 'ключ вкладки');
        c.str(t, 'title', tp);
        c.fn(t, 'render', tp, true);
      });
      const fields = c.arr(k, 'fields', p, false);
      const fieldSeen = new Set<string>();
      fields?.forEach((f, i) => {
        const fp = `${p}.fields[${i}]`;
        if (!isObj(f)) { c.err(fp, 'type', `${fp} должно быть объектом`); return; }
        c.unique(fieldSeen, c.str(f, 'key', fp), `${fp}.key`, 'ключ поля');
        c.str(f, 'title', fp);
        c.enumOf(f, 'type', fp, FIELD_TYPES, true);
      });
      c.unknownKeys(k, ['title', 'icon', 'overview', 'tabs', 'fields'], p, 'kit его не прочтёт');
    }
  }

  // menu
  const menu = c.obj(cfg, 'menu', '', true);
  if (menu) {
    const groups = c.arr(menu, 'groups', 'menu', true);
    const groupSeen = new Set<string>();
    const itemSeen = new Set<string>();
    groups?.forEach((g, gi) => {
      const gp = `menu.groups[${gi}]`;
      if (!isObj(g)) { c.err(gp, 'type', `${gp} должно быть объектом`); return; }
      c.unique(groupSeen, c.str(g, 'id', gp), `${gp}.id`, 'id группы меню');
      c.str(g, 'title', gp);
      c.color(g, 'tone', gp, false);
      const items = c.arr(g, 'items', gp, true);
      items?.forEach((it, ii) => {
        const ip = `${gp}.items[${ii}]`;
        if (!isObj(it)) { c.err(ip, 'type', `${ip} должно быть объектом`); return; }
        const id = c.str(it, 'id', ip);
        c.unique(itemSeen, id, `${ip}.id`, 'id пункта меню');
        c.str(it, 'title', ip);
        c.icon(it, 'icon', ip, false, icons);
        c.optStr(it, 'view', ip);
        if (id !== undefined && it.view === undefined && !kindKeys.has(id)) {
          c.warn(ip, 'menu-target', `${ip}: «${id}» — не вид записей из kinds и без view; пункт некуда вести`);
        }
      });
    });
    c.optBool(menu, 'myViews', 'menu');
    c.optBool(menu, 'recent', 'menu');
  }

  // edges
  const edges = c.obj(cfg, 'edges', '', false);
  if (edges) {
    for (const [type, e] of Object.entries(edges)) {
      const p = `edges.${type}`;
      if (!isObj(e)) { c.err(p, 'type', `${p} должно быть объектом`); continue; }
      c.str(e, 'label', p);
      c.color(e, 'color', p, true);
      // S5-10: структурный слой графа (принадлежность/иерархия) — скрыт по умолчанию.
      c.enumOf(e, 'layer', p, ['structural'], false);
    }
  }

  // graph
  const graph = c.obj(cfg, 'graph', '', false);
  if (graph) {
    c.enumOf(graph, 'depth', 'graph', [1, 2, 3], true);
    const lim = graph.limit;
    if (!Number.isInteger(lim) || (lim as number) < 1) c.err('graph.limit', 'type', 'graph.limit должно быть целым > 0');
    c.enumOf(graph, 'colorBy', 'graph', ['verdict', 'type'], false);
  }

  // statuses
  //
  // Пустой словарь — ЗАКОННЫЙ конфиг и означает «у этого списка нет статусной
  // оси» (K-14). Раньше здесь стояла ошибка «нужен хотя бы один статус», и это
  // было предметное допущение внутри kit: есть ли у типа статус — дело
  // приложения и его данных. У вех, компонентов, технологий и релизов LORE
  // статуса нет ни в одном поле среза, и фиктивный статус рисовал бы каждой
  // строке чип, которого у неё нет: «оси нет» ≠ «ось есть, значение неизвестно».
  let statusAxisEmpty = false;
  const statuses = c.obj(cfg, 'statuses', '', true);
  if (statuses) {
    const items = c.arr(statuses, 'items', 'statuses', true);
    if (items) {
      statusAxisEmpty = items.length === 0;
      const codeSeen = new Set<string>();
      const hotSeen = new Set<string>();
      const allCodes = new Set(items.filter(isObj).map((s) => s.code).filter(isStr));
      items.forEach((s, i) => {
        const p = `statuses.items[${i}]`;
        if (!isObj(s)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
        const code = c.str(s, 'code', p, { allowEmpty: true });
        if (code !== undefined && !STATUS_CODE_RE.test(code)) {
          c.err(`${p}.code`, 'status-code', `${p}.code: код статуса непуст и из [A-Za-z0-9_-] (он попадает в URL и фильтры), получено «${code}»`);
        }
        c.unique(codeSeen, code, `${p}.code`, 'код статуса');
        c.str(s, 'title', p);
        c.enumOf(s, 'category', p, STATUS_CATEGORIES, true);
        c.icon(s, 'icon', p, true, icons);
        c.color(s, 'color', p, true);
        if (s.hotkey !== undefined) {
          if (!isStr(s.hotkey) || s.hotkey === '') c.err(`${p}.hotkey`, 'type', `${p}.hotkey должно быть непустой строкой`);
          else if (hotSeen.has(s.hotkey)) c.err(`${p}.hotkey`, 'duplicate-hotkey', `${p}.hotkey «${s.hotkey}» уже занята`);
          else hotSeen.add(s.hotkey);
        }
        const allow = c.arr(s, 'allow', p, false);
        allow?.forEach((a, ai) => {
          if (!isStr(a) || !allCodes.has(a)) c.err(`${p}.allow[${ai}]`, 'unknown-ref', `${p}.allow[${ai}]: перехода в «${String(a)}» нет среди кодов статусов`);
        });
      });
    }
    c.optBool(statuses, 'selfApprove', 'statuses');
    c.optBool(statuses, 'undo', 'statuses');
    c.optBool(statuses, 'bulk', 'statuses');
  }

  // roles
  const roles = c.obj(cfg, 'roles', '', false);
  if (roles) {
    for (const [role, r] of Object.entries(roles)) {
      const p = `roles.${role}`;
      if (!isObj(r)) { c.err(p, 'type', `${p} должно быть объектом`); continue; }
      for (const k of ['canEdit', 'canStatus']) {
        if (typeof r[k] !== 'boolean') c.err(`${p}.${k}`, 'required', `${p}.${k} обязательно и true/false`);
      }
    }
  }

  c.fn(cfg, 'verdict', '', false);

  // list
  const list = c.obj(cfg, 'list', '', false);
  if (list) {
    const views = c.arr(list, 'views', 'list', true);
    views?.forEach((v, i) => {
      if (!LIST_VIEWS.includes(v as string)) c.err(`list.views[${i}]`, 'enum', `list.views[${i}]: «${String(v)}» не из ${LIST_VIEWS.join('|')}`);
    });
    if (views && views.length === 0) c.err('list.views', 'empty', 'нужен хотя бы один вид списка');
    const quick = c.arr(list, 'quick', 'list', false);
    const quickSeen = new Set<string>();
    quick?.forEach((q, i) => {
      const p = `list.quick[${i}]`;
      if (!isObj(q)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
      c.unique(quickSeen, c.str(q, 'id', p), `${p}.id`, 'id быстрого фильтра');
      c.str(q, 'title', p);
      const f = c.obj(q, 'filter', p, true);
      if (f) {
        for (const [fk, fv] of Object.entries(f)) {
          const ok = isStr(fv) || (Array.isArray(fv) && fv.every(isStr));
          if (!ok) c.err(`${p}.filter.${fk}`, 'type', `${p}.filter.${fk}: значение — строка или массив строк`);
        }
      }
    });
    const listArrays: Record<string, unknown[]> = {};
    for (const k of ['filters', 'groupings', 'columns']) {
      const a = c.arr(list, k, 'list', false);
      if (a) listArrays[k] = a;
      a?.forEach((v, i) => { if (!isStr(v)) c.err(`list.${k}[${i}]`, 'type', `list.${k}[${i}] должно быть строкой`); });
    }
    // Колонка и фасет «Статус» при пустой оси обещают то, чего нет. Это не
    // ошибка — kit их покажет, просто пустыми, — но молчать нельзя: иначе
    // пустая колонка читается как «статусы потерялись», а не «их не бывает».
    if (statusAxisEmpty) {
      if ((listArrays.columns ?? []).includes('status')) {
        c.warn('list.columns', 'status-column-without-axis', 'колонка «status» заказана, а statuses.items пуст: колонка обещает статусную ось, которой нет');
      }
      if ((listArrays.filters ?? []).includes('status')) {
        c.warn('list.filters', 'status-facet-without-axis', 'фасет «status» заказан, а statuses.items пуст: фильтр обещает статусную ось, которой нет');
      }
      if ((listArrays.groupings ?? []).includes('status')) {
        c.warn('list.groupings', 'status-grouping-without-axis', 'разрез «status» заказан, а statuses.items пуст: группировка обещает статусную ось, которой нет');
      }
    }
    const tree = c.obj(list, 'tree', 'list', false);
    if (tree) {
      c.str(tree, 'parent', 'list.tree');
      c.str(tree, 'order', 'list.tree');
      c.enumOf(tree, 'rollup', 'list.tree', ['verdict', 'status'], false);
    }
    c.enumOf(list, 'showClosed', 'list', ['below', 'all', 'days30', 'hide'], false);
    const timeline = c.obj(list, 'timeline', 'list', false);
    if (timeline) c.str(timeline, 'start', 'list.timeline');
    if (views?.includes('timeline') && !timeline) c.err('list.timeline', 'timeline-config', 'вид timeline требует list.timeline {start}');
    const hasTreeView = !!views?.includes('tree');
    if (hasTreeView && !tree) c.err('list.tree', 'tree-config', 'вид tree требует list.tree {parent, order}');
    if (!hasTreeView && tree) c.warn('list.tree', 'tree-unused', 'list.tree задан, но вида tree в list.views нет');
  }

  // palette
  const palette = c.obj(cfg, 'palette', '', false);
  if (palette) {
    const cmds = c.arr(palette, 'commands', 'palette', false);
    const seen = new Set<string>();
    cmds?.forEach((cmd, i) => {
      const p = `palette.commands[${i}]`;
      if (!isObj(cmd)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
      c.unique(seen, c.str(cmd, 'id', p), `${p}.id`, 'id команды');
      c.str(cmd, 'title', p);
      c.fn(cmd, 'run', p, true);
    });
  }

  // hooks
  const hooks = c.obj(cfg, 'hooks', '', false);
  if (hooks) for (const k of ['onSave', 'onActivate', 'onRollback']) c.fn(hooks, k, 'hooks', false);

  return c.result();
}

function isIsoDate(v: unknown): boolean {
  return isStr(v) && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Проверить данные kit (window.X_DATA). С конфигом — ещё и сверка записей
 * с его словарями (вид, статус, тип ребра): расхождение — предупреждение,
 * потому что kit такую запись покажет, но честно пометит.
 */
export function validateKitData(input: unknown, config?: KitConfig): KitValidation {
  const c = new Collector();
  if (!isObj(input)) { c.err('', 'type', 'данные kit должны быть объектом {records, edges, journal, meta}'); return c.result(); }
  const d = input;
  c.unknownKeys(d, ['records', 'edges', 'journal', 'meta'], '', 'kit его не прочтёт');

  const kindKeys = config && isObj(config.kinds) ? new Set(Object.keys(config.kinds)) : undefined;
  const statusCodes = config && isObj(config.statuses) && Array.isArray(config.statuses.items)
    ? new Set(config.statuses.items.map((s) => s.code)) : undefined;
  // Пустая ось (K-14): конфиг говорит «статуса у этого типа нет». Тогда жалоба
  // «нет в config.statuses» не по делу — она прозвучала бы на КАЖДОЙ строке и
  // утопила бы настоящие замечания. Расхождение всё равно называется, но один
  // раз и по-другому: данные статусы несут, а ось не объявлена (ниже).
  const noStatusAxis = statusCodes?.size === 0;
  const statusesWithoutAxis = new Set<string>();
  // Конфиг без словаря рёбер — любой тип ребра ему неизвестен (а не «всё можно»).
  const edgeTypes = config ? new Set(isObj(config.edges) ? Object.keys(config.edges) : []) : undefined;

  const records = c.arr(d, 'records', '', true);
  const ids = new Set<string>();
  records?.forEach((r, i) => {
    const p = `records[${i}]`;
    if (!isObj(r)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
    c.unique(ids, c.str(r, 'id', p), `${p}.id`, 'id записи');
    const kind = c.str(r, 'kind', p);
    c.str(r, 'title', p, { allowEmpty: true });
    const status = c.str(r, 'status', p, { allowEmpty: true });
    c.obj(r, 'fields', p, true);
    c.optStr(r, 'body_md', p);
    if (r.updated_at !== undefined && !isIsoDate(r.updated_at)) c.err(`${p}.updated_at`, 'date', `${p}.updated_at — дата ISO 8601`);
    c.unknownKeys(r, RECORD_KEYS, p, 'положи его в fields');
    if (kind !== undefined && kindKeys && !kindKeys.has(kind)) c.warn(`${p}.kind`, 'unknown-kind', `${p}.kind «${kind}» нет в config.kinds`);
    if (noStatusAxis) {
      if (status) statusesWithoutAxis.add(status);
    } else if (status !== undefined && statusCodes && !statusCodes.has(status)) {
      c.warn(`${p}.status`, 'unknown-status', `${p}.status «${status}» нет в config.statuses`);
    }
  });

  // Одно предупреждение на всю выдачу, со списком самих значений: по нему
  // видно, что чинить — объявить ось или убрать статус из данных.
  if (statusesWithoutAxis.size > 0) {
    c.warn('records', 'status-without-axis',
      `статусной оси в конфиге нет (statuses.items пуст), а записи несут статусы: ${[...statusesWithoutAxis].sort().join(' · ')}`);
  }

  const edges = c.arr(d, 'edges', '', true);
  edges?.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (!isObj(e)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
    const from = c.str(e, 'from', p);
    const to = c.str(e, 'to', p);
    const type = c.str(e, 'type', p);
    c.unknownKeys(e, ['from', 'to', 'type'], p, 'kit его не прочтёт');
    if (records) {
      for (const [end, v] of [['from', from], ['to', to]] as const) {
        if (v !== undefined && !ids.has(v)) c.warn(`${p}.${end}`, 'dangling-edge', `${p}.${end}: записи «${v}» нет в records`);
      }
    }
    if (type !== undefined && edgeTypes && !edgeTypes.has(type)) c.warn(`${p}.type`, 'unknown-edge-type', `${p}.type «${type}» нет в config.edges`);
  });

  const journal = c.arr(d, 'journal', '', true);
  journal?.forEach((j, i) => {
    const p = `journal[${i}]`;
    if (!isObj(j)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
    if (j.at === undefined) c.err(`${p}.at`, 'required', `нет обязательного поля ${p}.at`);
    else if (!isIsoDate(j.at)) c.err(`${p}.at`, 'date', `${p}.at — дата ISO 8601, получено «${String(j.at)}»`);
    c.str(j, 'who', p);
    c.str(j, 'record_id', p);
    c.str(j, 'field', p);
    c.optBool(j, 'is_agent', p);
    c.optStr(j, 'approved_by', p);
    c.unknownKeys(j, ['at', 'who', 'is_agent', 'record_id', 'field', 'from', 'to', 'approved_by'], p, 'kit его не прочтёт');
  });

  const meta = c.obj(d, 'meta', '', true);
  if (meta) {
    if (meta.generated_at === undefined) c.err('meta.generated_at', 'required', 'нет обязательного поля meta.generated_at');
    else if (!isIsoDate(meta.generated_at)) c.err('meta.generated_at', 'date', 'meta.generated_at — дата ISO 8601');
    c.optStr(meta, 'scope', 'meta');
    for (const k of ['total', 'returned']) {
      if (meta[k] !== undefined && (!Number.isInteger(meta[k]) || (meta[k] as number) < 0)) c.err(`meta.${k}`, 'type', `meta.${k} — целое ≥ 0`);
    }
    c.optBool(meta, 'truncated', 'meta');
    if (records && Number.isInteger(meta.returned) && meta.returned !== records.length) {
      c.warn('meta.returned', 'meta-returned', `meta.returned=${String(meta.returned)}, а записей ${records.length}`);
    }
    if (meta.truncated === true && meta.total === undefined) {
      c.warn('meta.total', 'meta-truncated-total', 'выдача урезана (truncated), но total не указан — «показано N из ?»');
    }
    const errs = c.arr(meta, 'errors', 'meta', false);
    errs?.forEach((e, i) => {
      const p = `meta.errors[${i}]`;
      if (!isObj(e)) { c.err(p, 'type', `${p} должно быть объектом`); return; }
      c.str(e, 'block', p);
      c.str(e, 'reason', p);
    });
    c.unknownKeys(meta, ['generated_at', 'scope', 'total', 'returned', 'truncated', 'errors'], 'meta', 'kit его не прочтёт');
  }

  return c.result();
}

export type KitDataRead =
  | { state: 'missing'; key: string }
  | { state: 'error'; key: string; issues: KitIssue[] }
  | { state: 'ok'; key: string; data: KitData; warnings: KitIssue[] };

/**
 * Прочитать данные single-file HTML из глобала (по умолчанию window.X_DATA).
 * Три честных исхода: переменной нет (missing) ≠ форма битая (error) ≠ данные
 * есть (ok, с предупреждениями) — «пусто» здесь не подделывается.
 */
export function readKitData(
  win: object = globalThis,
  opts: { key?: string; config?: KitConfig } = {},
): KitDataRead {
  const key = opts.key ?? 'X_DATA';
  const raw = (win as Record<string, unknown>)[key];
  if (raw === undefined || raw === null) return { state: 'missing', key };
  const v = validateKitData(raw, opts.config);
  if (!v.ok) return { state: 'error', key, issues: v.errors };
  return { state: 'ok', key, data: raw as KitData, warnings: v.warnings };
}
