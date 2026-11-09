// Декларативная часть конфига — из модели, а не из рук
// (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER, K-14).
//
// Повод — слова владелицы 09.11.2026, три подряд: «зачем тебе словарь статусов
// на своей стороне, если это задача уже конкретного приложения»; «я думала, для
// этого отдельный элемент модели будет, типа справочники статусов и workflow по
// объектам, присылать в kit»; «так заводите — завтра кто-нибудь будет на kit
// собирать своё приложение и?». И отдельно: «конкретика на её стороне, а не на
// стороне kit».
//
// ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: здесь нет ни одного предметного имени. Ни типа,
// ни словаря, ни статуса. Всё предметное называет ДОКУМЕНТ, а код только
// переводит его в части конфига. Правило держится тестом, который грепает этот
// исходник: появится «sprint» или имя словаря LORE — тест красный, потому что
// тогда чужое приложение на kit получит словари LORE, а это и есть угроза
// форка из K-10.
//
// ЧТО ОСТАЁТСЯ ЗА ПРИЛОЖЕНИЕМ И ПОЧЕМУ. Значки и цвета — выбор вида, а не
// данные: у LORE они берутся из старого UI (решение владелицы, S4-25), и
// документ в это не вмешивается. Поэтому значок из модели — УМОЛЧАНИЕ, которое
// приложение вправе перебить.
//
// ЧЕСТНЫЕ СОСТОЯНИЯ ВАЖНЕЕ ПОЛНОТЫ. Каждый пропуск называется строкой: нет
// раздела · нет словаря · статья без кода · цвет не токен · поле без вида.
// Молчаливое умолчание — худший исход: приложение выглядит настроенным по
// модели, а показывает своё.
import type { KindConfig, KitConfig, KitRelation, KitRelationDef } from '../core/contract';
import type { LoreModelDoc } from './loadModel';

type StatusItem = KitConfig['statuses']['items'][number];
type Category = StatusItem['category'];
type FieldDef = NonNullable<KindConfig['fields']>[number];
type FieldType = FieldDef['type'];

/** Как раздел показывается в колонке: приходит данными, читают колонки. */
export interface FieldDisplay {
  priority: number;
  width: string;
  overflow: string;
}

export interface ConfigFromModel {
  /** Статьи словаря статусов — в том виде, в котором их ждёт контракт kit. */
  statuses: StatusItem[];
  /** Виды записей: название, значок-умолчание, поля, связи-вкладки. */
  kinds: Record<string, KindConfig>;
  /** Показ поля по типам: `display[тип][поле]`. Нужен колонкам, не виду. */
  display: Record<string, Record<string, FieldDisplay>>;
  /**
   * Что в документе пропущено или не той формы — словами, ПО ЧАСТЯМ.
   *
   * Почему не одной кучей: потребитель, которому нужен только словарь
   * статусов, получал бы заодно жалобу «нет раздела types» и печатал её
   * человеку — про то, чем сам не пользуется. Поймано тестом: словарь пришёл
   * целым, а на экране висело замечание не по делу.
   */
  notes: { statuses: string[]; kinds: string[] };
}

export interface ConfigFromModelOptions {
  /** Имя словаря статусов в документе. Предметное имя даёт ПРИЛОЖЕНИЕ. */
  statusDict: string;
  /**
   * Перевод категории документа в категорию контракта — если у приложения она
   * своя.
   *
   * Зачем это нужно, хотя ниже есть таблица по умолчанию: та таблица знает
   * РАСПРОСТРАНЁННЫЕ слова (todo, in_progress, finished…), и уже этим она —
   * знание, пусть и общее. У приложения со своей осью слова будут другие, и
   * без этой точки расширения ему пришлось бы править kit. Вернёт undefined —
   * сработает таблица по умолчанию, а незнакомое будет НАЗВАНО, а не спрятано.
   */
  categoryOf?: (raw: string) => Category | undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;

/** Цвет годен, если это токен темы: форма, а не принадлежность к списку (K-14). */
const TOKEN_RE = /^var\(--[A-Za-z][\w-]*\)$/;
const NEUTRAL = 'var(--t3)';
const UNKNOWN_ICON = 'help';

/**
 * Ось документа → четыре категории контракта.
 *
 * Документ может говорить шестью значениями (ось владелицы), а контракт kit
 * знает четыре. Перевод объявлен здесь, а не угадывается: незнакомое значение
 * становится «в работе» и НАЗЫВАЕТСЯ — спрятать его в «готово» значило бы
 * закрыть запись, которая не закрыта.
 */
const CATEGORY: Record<string, Category> = {
  todo: 'todo', backlog: 'todo', planned: 'todo', design: 'todo', deferred: 'todo',
  active: 'active', in_progress: 'active', partial: 'active', blocked: 'active', review: 'active',
  done: 'done', finished: 'done',
  cancelled: 'cancelled', withdrawn: 'cancelled', closed: 'cancelled',
};

/** Вид поля документа → тип поля конфига. Незнакомый — текст, и это сказано. */
const FIELD_TYPE: Record<string, FieldType> = {
  text: 'text', md: 'md', enum: 'enum', ref: 'ref', date: 'date',
  datetime: 'date', time: 'text', number: 'number', boolean: 'text',
};

const UML: readonly string[] = ['composition', 'aggregation', 'association', 'realization', 'attribute'];

export function configFromModel(model: LoreModelDoc, opts: ConfigFromModelOptions): ConfigFromModel {
  const statusNotes: string[] = [];
  const kindNotes: string[] = [];
  return {
    statuses: statusesOf(model, opts, statusNotes),
    ...kindsOf(model, kindNotes),
    notes: { statuses: statusNotes, kinds: kindNotes },
  };
}

function statusesOf(model: LoreModelDoc, opts: ConfigFromModelOptions, notes: string[]): StatusItem[] {
  const dict = opts.statusDict;
  if (Object.keys(model.statuses).length === 0) {
    notes.push('в документе нет раздела statuses — словарь статусов остаётся умолчанием приложения');
    return [];
  }
  const block = model.statuses[dict];
  const entries = isObj(block) && Array.isArray(block.entries) ? block.entries : null;
  if (!entries) {
    notes.push(`в документе не описан словарь «${dict}» — статусы остаются умолчанием приложения`);
    return [];
  }
  const out: { item: StatusItem; order: number }[] = [];
  entries.forEach((raw, i) => {
    if (!isObj(raw)) { notes.push('в словаре есть статья не того вида — пропущена'); return; }
    const code = str(raw.code);
    if (!code) { notes.push('в словаре есть статья без кода — пропущена'); return; }
    const color = str(raw.color);
    let use = color;
    if (!color) { notes.push(`у статуса «${code}» не задан цвет — показан нейтральным`); use = NEUTRAL; }
    else if (!TOKEN_RE.test(color)) {
      notes.push(`у статуса «${code}» цвет «${color}» не токен — показан нейтральным`);
      use = NEUTRAL;
    }
    const icon = str(raw.icon);
    if (!icon) notes.push(`у статуса «${code}» не задан значок — показан общим`);
    const cat = str(raw.category);
    const category = opts.categoryOf?.(cat) ?? CATEGORY[cat];
    if (!category) notes.push(`у статуса «${code}» категория «${cat}» неизвестна — показан как «в работе»`);
    const item: StatusItem = {
      code,
      title: str(raw.title) || code,
      category: category ?? 'active',
      icon: icon || UNKNOWN_ICON,
      color: use,
      ...(Array.isArray(raw.allow) ? { allow: raw.allow.filter((a): a is string => typeof a === 'string') } : {}),
    };
    out.push({ item, order: int(raw.order) ?? i });
  });
  // Порядок — из документа: полагаться на порядок ключей JSON нельзя.
  out.sort((a, b) => a.order - b.order);
  return out.map(o => o.item);
}

function kindsOf(model: LoreModelDoc, notes: string[]): Pick<ConfigFromModel, 'kinds' | 'display'> {
  const kinds: Record<string, KindConfig> = {};
  const display: Record<string, Record<string, FieldDisplay>> = {};
  const types = Object.keys(model.types);
  if (types.length === 0) {
    notes.push('в документе нет раздела types — виды записей остаются умолчанием приложения');
    return { kinds, display };
  }
  for (const name of types) {
    const t = model.types[name];
    if (!isObj(t)) { notes.push(`тип «${name}» описан не тем видом — пропущен`); continue; }
    const fields: FieldDef[] = [];
    const disp: Record<string, FieldDisplay> = {};
    const raw = Array.isArray(t.fields) ? t.fields : [];
    if (raw.length === 0) notes.push(`у типа «${name}» нет полей — показывать будет нечего`);
    for (const f of raw) {
      if (!isObj(f)) continue;
      const key = str(f.key);
      if (!key) { notes.push(`у типа «${name}» есть поле без ключа — пропущено`); continue; }
      // Служебное и скрытое не показываем: их и сервер показывать не просит.
      if (str(f.visibility) !== 'visible') continue;
      const kind = str(f.kind);
      const type = FIELD_TYPE[kind];
      if (!type) notes.push(`у поля «${name}.${key}» вид поля «${kind}» неизвестен — показано текстом`);
      fields.push({ key, title: str(f.label) || key, type: type ?? 'text' });
      const d = isObj(f.display) ? f.display : null;
      const priority = int(d?.priority);
      if (d && priority !== null) {
        disp[key] = { priority, width: str(d.width) || 'm', overflow: str(d.overflow) || 'none' };
      }
    }
    const relations: KitRelationDef[] = [];
    for (const r of Array.isArray(t.relations) ? t.relations : []) {
      if (!isObj(r)) continue;
      // Связь, спроецированная в ПОЛЕ, вкладкой не становится: место называет
      // документ, и решать за него нельзя.
      if (str(r.place) !== 'link_tab') continue;
      const key = str(r.key);
      const rel = str(r.rel);
      if (!key || !rel) { notes.push(`у типа «${name}» есть связь без ключа или ребра — пропущена`); continue; }
      const uml = str(r.relation);
      if (!UML.includes(uml)) notes.push(`у связи «${name}.${key}» вид «${uml}» неизвестен — показана ассоциацией`);
      relations.push({
        key,
        label: str(r.label) || key,
        relation: (UML.includes(uml) ? uml : 'association') as KitRelation,
        rel,
        dir: str(r.dir) === 'in' ? 'in' : 'out',
      });
    }
    const title = str(t.label);
    if (!title) notes.push(`у типа «${name}» нет названия — показан кодом`);
    kinds[name] = {
      title: title || name,
      // Значок из документа — УМОЛЧАНИЕ: выбор значков это вид, и приложение
      // вправе его перебить (у LORE значки берутся из старого UI, S4-25).
      icon: str(t.icon) || UNKNOWN_ICON,
      ...(fields.length ? { fields } : {}),
      ...(relations.length ? { relations } : {}),
    };
    if (Object.keys(disp).length) display[name] = disp;
  }
  return { kinds, display };
}
