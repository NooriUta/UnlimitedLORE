// Умолчания поверхностей из модели: порядок разделов паспорта
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Повод — владелица 09.11.2026: «ты должен определять порядок например Спринт
// первое как ни странно задачи потом уже контент потом еще что-то а зависимости
// и прочее можно скрыть под море и сделать настройкой интерфейс становиться
// перегруженным».
//
// ПОЧЕМУ ЭТО ДАННЫЕ, А НЕ КОД kit. «У спринта задачи важнее зависимостей» —
// знание о предметной области, не форма. Зашей его в конструктор, и чужое
// приложение на kit получит порядок LORE: ровно то, против чего правило
// владелицы «конкретика на её стороне, а не на стороне kit» (K-14).
//
// ПОЧЕМУ `surfaces`, А НЕ `types`. Я просил у сервера `types[t].tabs`, и мне
// отказали двумя доводами — оба проверил по коду, оба верны:
//   1. в `model/dataOnly.ts` в `BEHAVIOUR_STAYS_IN_APP` стоит `tabs`, и
//      проверка идёт на ЛЮБОЙ глубине, так что `types.sprint.tabs` уронил бы
//      `assertDataOnly` на всю модель;
//   2. D-2026-LORE-MODEL-TYPES-VS-SURFACES: в `types` свойства типа, в
//      `surfaces` — интерфейсный выбор. Порядок разделов и «что под Ещё» это
//      умолчание поверхности, а не свойство типа.
// То есть я попросил то, что сам же запретил неделей раньше.
//
// ПОЧЕМУ `sections`, А НЕ `tabs` ПОД ДРУГИМ ИМЕНЕМ. «Вкладка» называет
// КОНТРОЛ, а на телефоне тот же раздел — свёртка или нижний лист (ADR-LORE-049
// п. 5, парные контролы). Список РАЗДЕЛОВ говорит ЧТО и В КАКОМ ПОРЯДКЕ, но не
// КАК. Чтобы это не осталось словесной разницей, здесь стоит сторож: у элемента
// ровно пять ключей, любой лишний — отказ. Тогда попытка протащить в модель
// `component` или `render` падает тестом, а не обсуждается в переписке.
//
// ТРИ СЛОЯ (D-2026-LORE-MODEL-COLUMN-LAYERS) не смешиваются: модель даёт
// умолчание (`default_visible`), командный вид может его переопределить,
// человек — поверх. Здесь только первый слой.

/** Законные ключи элемента раздела. Пятёрка закрыта намеренно — см. шапку. */
export const SECTION_KEYS: readonly string[] = ['key', 'source', 'ref', 'order', 'slot'];

/** Источник раздела: тело записи, часть или связь. */
export type SectionSource = 'body' | 'part' | 'relation';

const SOURCES: readonly string[] = ['body', 'part', 'relation'];

/** Место раздела в паспорте. Три, потому что мест в v1 было три. */
export type SectionSlot = 'own' | 'content' | 'more';

const SLOTS: readonly string[] = ['own', 'content', 'more'];

/** Раздел паспорта в том виде, в котором им пользуется приложение. */
export interface PassportSection {
  key: string;
  source: SectionSource;
  /** Ключ части или связи; у тела — `null` (тело одно на все разделы). */
  ref: string | null;
  order: number;
  /**
   * Место раздела — умолчание модели, человек может сдвинуть:
   *  • `own` — свой раздел, виден сразу;
   *  • `content` — блоком В ХВОСТЕ ТЕЛА, вкладкой НЕ становится вовсе (так было
   *    в v1 у зависимостей спринта и у списка решений ADR — подтверждено CJM);
   *  • `more` — под свёрткой «Ещё».
   *
   * Третье значение появилось по словам владелицы 09.11: «раньше блокирует и
   * зависит был как подраздел контента… вариант как пример адр в конце решения
   * были списком и это cjm работы просел и подтвердил». Булева мало: «под Ещё»
   * и «в конце контента» — разные места, а не разная видимость.
   */
  slot: SectionSlot;
}

/**
 * Порядок разделов паспорта для типа.
 *
 * `decided: false` — сервер НЕ решал: записи о типе нет, `surfaces` нет вовсе
 * или сам сервер пометил тип нерешённым. Это честное состояние, а не пустой
 * ответ: приложение тогда держит свой порядок и ПОМЕЧАЕТ его как умолчание, а
 * не выдаёт за правду.
 */
export interface PassportOrder {
  decided: boolean;
  sections: PassportSection[];
  /**
   * Что в документе не так, но не настолько, чтобы отказываться (условие 1
   * договора kit ↔ сервер, ослаблено 09.11 по CJM).
   *
   * Сначала лишний ключ отказывал ЦЕЛИКОМ. Серверная сессия проверила это по
   * пути человека и согласилась, что вред больше пользы: добавь сервер
   * безобидное поле — и клиент потеряет ВЕСЬ порядок разделов, показав
   * умолчание. Технически честно, а человеку хуже, чем принять лишнее и
   * сказать о нём строкой.
   *
   * Отказ остался там, где продолжение показало бы НЕПРАВДУ О СТРУКТУРЕ:
   * неизвестный `slot` или `source`. Там непонятно даже, куда раздел девать.
   */
  notes: string[];
}

const NOT_DECIDED: PassportOrder = { decided: false, sections: [], notes: [] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function passportSections(model: unknown, type: string): PassportOrder {
  if (!isObj(model)) return NOT_DECIDED;
  const surfaces = isObj(model.surfaces) ? model.surfaces : null;
  const passport = surfaces && isObj(surfaces.passport) ? surfaces.passport : null;
  const forType = passport && isObj(passport[type]) ? (passport[type] as Record<string, unknown>) : null;
  if (!forType || forType.decided !== true || !Array.isArray(forType.sections)) return NOT_DECIDED;

  const seen = new Set<string>();
  const notes: string[] = [];
  const out: PassportSection[] = [];
  for (const raw of forType.sections) {
    if (!isObj(raw)) throw new Error(`surfaces.passport.${type}.sections: элемент должен быть объектом`);
    const extra = Object.keys(raw).filter(k => !SECTION_KEYS.includes(k));
    if (extra.length) {
      // ПРИНЯТЬ И НАЗВАТЬ, а не отказаться (условие 1, ослаблено 09.11 по
      // CJM). Отказ целиком стоил бы человеку всего порядка разделов из-за
      // одного безобидного поля; молчаливое игнорирование спрятало бы попытку
      // положить в модель отрисовку. Названная строка — единственный исход, у
      // которого нет ни той, ни другой цены.
      notes.push(`surfaces.passport.${type}.sections[${String(raw.key)}]: лишние ключи ${extra.join(', ')} — в модели только данные, они не прочитаны`);
    }
    const key = typeof raw.key === 'string' ? raw.key : '';
    if (!key) throw new Error(`surfaces.passport.${type}.sections: у раздела пустой key`);
    if (seen.has(key)) throw new Error(`surfaces.passport.${type}.sections: ключ ${key} встречается дважды`);
    seen.add(key);
    const source = typeof raw.source === 'string' ? raw.source : '';
    if (!SOURCES.includes(source)) {
      throw new Error(`surfaces.passport.${type}.sections[${key}]: source «${source}» не из ${SOURCES.join(' | ')}`);
    }
    if (typeof raw.order !== 'number' || !Number.isInteger(raw.order)) {
      throw new Error(`surfaces.passport.${type}.sections[${key}]: order должен быть целым`);
    }
    const slot = typeof raw.slot === 'string' ? raw.slot : '';
    if (!SLOTS.includes(slot)) {
      throw new Error(`surfaces.passport.${type}.sections[${key}]: slot «${slot}» не из ${SLOTS.join(' | ')}`);
    }
    out.push({
      key,
      source: source as SectionSource,
      ref: typeof raw.ref === 'string' && raw.ref ? raw.ref : null,
      order: raw.order,
      slot: slot as SectionSlot,
    });
  }
  // Сортировка по `order`, а не по месту в массиве: порядок объявлен числом, и
  // полагаться на порядок ключей JSON нельзя.
  out.sort((a, b) => a.order - b.order);
  return { decided: true, sections: out, notes };
}

/**
 * Применить порядок модели к списку разделов приложения.
 *
 * Правило, которое важнее сортировки: **чего модель не называла, то не
 * прячется и не переставляется.** Модель знает тела, части и связи типа, но не
 * знает вкладок, которые конструктор добавляет сам (граф, журнал, история,
 * связи целиком). Спрятать их «за компанию» значило бы решить за сервера то,
 * о чём он не говорил, — и человек потерял бы вкладку без причины.
 *
 * Поэтому: названные моделью идут первыми, в её порядке, с её видимостью;
 * остальные — после, в прежнем порядке и видимые, как были.
 *
 * `decided: false` (или порядка нет вовсе) — список не меняется ВООБЩЕ. Это и
 * есть умолчание приложения, и оно остаётся умолчанием, а не превращается в
 * «модель так решила».
 */
export function applySections<T extends { id: string; secondary?: boolean }>(
  items: readonly T[],
  order?: PassportOrder | null,
): T[] {
  if (!order?.decided || order.sections.length === 0) return [...items];
  const at = new Map(order.sections.map((s, i) => [s.key, i]));
  const named: { item: T; i: number }[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const i = at.get(item.id);
    if (i === undefined) { rest.push(item); continue; }
    const slot = order.sections[i].slot;
    // `content` из ряда вкладок уходит ВОВСЕ: такой раздел рисуется блоком в
    // хвосте тела. Это и есть разница между «под Ещё» (вкладка есть, но
    // свёрнута) и «в конце контента» (вкладки нет). Если оставить его здесь
    // хотя бы как `secondary`, раздел покажется дважды.
    if (slot === 'content') continue;
    named.push({ item: { ...item, secondary: slot === 'more' }, i });
  }
  named.sort((a, b) => a.i - b.i);
  return [...named.map(n => n.item), ...rest];
}

/**
 * Разделы, которые рисуются блоками в ХВОСТЕ ТЕЛА, в порядке модели.
 *
 * Отдельная функция, а не флаг в списке вкладок: это другое место на экране, и
 * путать их нельзя. Сервер гарантирует инвариант — `content` допустим только у
 * типа с телом и только ПОСЛЕ раздела тела, — поэтому угадывать, куда
 * вклеивать, не нужно.
 *
 * Что делает приложение с этим списком (мои обязательства перед серверной
 * сессией, записаны здесь, чтобы не потерялись):
 *  • заголовок блока со СЧЁТЧИКОМ («Решения 12»): вкладки у раздела больше нет,
 *    и без счётчика число исчезнет с экрана совсем;
 *  • пустой блок не рисуется — иначе у ADR вылезет семь пустых заголовков;
 *  • «не смогли прочитать» — это ДРУГОЕ утверждение, и его печатает блок
 *    «Состояние данных» по `meta.data_state`, а не пустой заголовок.
 */
export function gluedSections(order?: PassportOrder | null): PassportSection[] {
  if (!order?.decided) return [];
  return order.sections.filter(s => s.slot === 'content');
}

/**
 * Разделы, которые модель назвала, а у записи их нет (условие 5 договора).
 *
 * Молчаливое игнорирование здесь было бы той же бедой, что и везде: модель
 * говорит «есть раздел X», человек его не видит, и никто не знает, почему.
 * Отказываться тоже нельзя — остальной порядок верен и полезен. Поэтому имя
 * называется строкой, а порядок применяется.
 *
 * Отдельно от разбора: во время разбора я ещё не знаю, какие разделы есть у
 * ЭТОЙ записи — это знает только тот, кто её рисует.
 */
export function unknownSections(
  items: readonly { id: string }[],
  order?: PassportOrder | null,
): string[] {
  if (!order?.decided) return [];
  const have = new Set(items.map(i => i.id));
  const missing = order.sections.filter(s => !have.has(s.key)).map(s => s.key);
  return missing.length
    ? [`модель называет разделы, которых у записи нет: ${missing.join(', ')} — порядок применён к остальным`]
    : [];
}
