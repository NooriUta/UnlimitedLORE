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

/** Законные ключи элемента раздела. Шестёрка закрыта намеренно — см. шапку. */
export const SECTION_KEYS: readonly string[] = ['key', 'source', 'ref', 'order', 'slot', 'group'];

/** Источник раздела: тело записи, часть или связь. */
export type SectionSource = 'body' | 'part' | 'relation';

const SOURCES: readonly string[] = ['body', 'part', 'relation'];

/**
 * Место раздела в паспорте. ДВА, и это сокращение с трёх (паспорта v3,
 * 10.11.2026).
 *
 * Было третье — `more`, «под свёрткой Ещё». Убрано, потому что оказалось
 * решением о ЧУЖОМ ЭКРАНЕ, принятым вслепую: сервер не знает ни ширины окна,
 * ни масштаба текста, ни того, сколько вкладок у записи набралось вместе со
 * служебными. Что не влезло — считает тот, кто рисует ряд (shell/tabRow.ts:
 * первые по порядку в ряд, не больше потолка, остальное под «Ещё»).
 *
 * `more` теперь ОШИБКА разбора, а не молча принятое прошлое значение: приняв
 * его, мы вернули бы второго хозяина ряду вкладок, и кто из двоих победил —
 * зависело бы от порядка строк в коде.
 */
export type SectionSlot = 'own' | 'content';

const SLOTS: readonly string[] = ['own', 'content'];

/**
 * Группа разделов: несколько разделов — ОДНА вкладка (паспорта v3).
 *
 * `label` обязателен и непуст: вкладка группы подписана ИМЕННО ИМ, и подменить
 * его нечем — ключ группы это служебное слово, а не человеческое имя.
 */
export interface SectionGroup {
  key: string;
  label: string;
}

/** Раздел паспорта в том виде, в котором им пользуется приложение. */
export interface PassportSection {
  key: string;
  source: SectionSource;
  /** Ключ части или связи; у тела — `null` (тело одно на все разделы). */
  ref: string | null;
  order: number;
  /**
   * Место раздела — умолчание модели, человек может сдвинуть:
   *  • `own` — свой раздел (вкладкой, если влезет в ряд, иначе под «Ещё»);
   *  • `content` — блоком В ХВОСТЕ ТЕЛА, вкладкой НЕ становится вовсе (так было
   *    в v1 у зависимостей спринта и у списка решений ADR — подтверждено CJM).
   *
   * Второе место появилось по словам владелицы 09.11: «раньше блокирует и
   * зависит был как подраздел контента… вариант как пример адр в конце решения
   * были списком и это cjm работы просел и подтвердил». Булева мало: «вкладкой»
   * и «в конце контента» — разные места, а не разная видимость.
   */
  slot: SectionSlot;
  /**
   * Группа, в которую раздел входит, или `null`.
   *
   * Разделы одной группы идут ПОДРЯД и рисуются одной вкладкой с подписью
   * группы; внутри — подзаголовки по разделам, счётчик вкладки — сумма
   * счётчиков разделов. Это данные («какие разделы родственны» знает тот, кто
   * описал тип), а не форма: конструктор склеить их сам не может — он не знает,
   * что родственно, а что просто оказалось рядом по порядку.
   *
   * У `content` группы не бывает: группа — это ОДНА ВКЛАДКА на несколько
   * разделов, а у раздела без вкладки её складывать некуда.
   */
  group: SectionGroup | null;
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
    // Группа — та же граница отказа, что у `slot` и `source`: продолжение
    // показало бы НЕПРАВДУ О СТРУКТУРЕ. Группа без подписи дала бы безымянную
    // вкладку, а подставить вместо подписи ключ значило бы выдать служебное
    // слово за человеческое имя.
    let group: SectionGroup | null = null;
    if (raw.group !== undefined && raw.group !== null) {
      if (!isObj(raw.group)) {
        throw new Error(`surfaces.passport.${type}.sections[${key}]: group должен быть объектом {key, label} или null`);
      }
      const gk = typeof raw.group.key === 'string' ? raw.group.key : '';
      const gl = typeof raw.group.label === 'string' ? raw.group.label : '';
      if (!gk || !gl) {
        throw new Error(`surfaces.passport.${type}.sections[${key}]: у group нужны непустые key и label — вкладка группы подписана именно label`);
      }
      // «В конце текста групп не бывает» (условие серверной сессии): складывать
      // группу некуда, а уронить её молча значило бы потерять связь разделов
      // без следа.
      if (slot === 'content') {
        throw new Error(`surfaces.passport.${type}.sections[${key}]: group у раздела slot=content — в хвосте текста вкладки нет, группировать нечего`);
      }
      group = { key: gk, label: gl };
    }
    out.push({
      key,
      source: source as SectionSource,
      ref: typeof raw.ref === 'string' && raw.ref ? raw.ref : null,
      order: raw.order,
      slot: slot as SectionSlot,
      group,
    });
  }
  // Сортировка по `order`, а не по месту в массиве: порядок объявлен числом, и
  // полагаться на порядок ключей JSON нельзя.
  out.sort((a, b) => a.order - b.order);
  assertGroupRuns(out, type);
  return { decided: true, sections: out, notes };
}

/**
 * Разделы одной группы обязаны идти ПОДРЯД, и подпись у группы одна.
 *
 * Склейка в одну вкладку идёт по соседству в порядке модели — иначе пришлось бы
 * перетасовывать ряд, а правило «порядок по смыслу одинаков на любой ширине»
 * этого не допускает. Разорви группу чужим разделом, и исходов два: либо чужой
 * уедет внутрь группы, либо группа распадётся на две вкладки с одной подписью.
 * Оба — неправда о структуре, поэтому отказ, а не тихая склейка.
 *
 * Проверяется ПОСЛЕ сортировки: «подряд» — про порядок `order`, а не про
 * порядок строк в JSON.
 */
function assertGroupRuns(sections: readonly PassportSection[], type: string): void {
  const closed = new Map<string, string>();
  let open: string | null = null;
  for (const s of sections) {
    const gk = s.group?.key ?? null;
    if (gk !== open && gk && closed.has(gk)) {
      throw new Error(`surfaces.passport.${type}.sections: разделы группы ${gk} идут не подряд — склеить их в одну вкладку, не переставляя ряд, нельзя`);
    }
    if (gk && open === gk && s.group && closed.get(gk) !== s.group.label) {
      throw new Error(`surfaces.passport.${type}.sections: у группы ${gk} две подписи («${closed.get(gk)}» и «${s.group.label}») — вкладка была бы названа наугад`);
    }
    if (gk && gk !== open) closed.set(gk, s.group!.label);
    open = gk;
  }
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
 * Поэтому: названные моделью идут первыми, в её порядке; остальные — после, в
 * прежнем порядке.
 *
 * ЧЕГО ЭТА ФУНКЦИЯ БОЛЬШЕ НЕ ДЕЛАЕТ (паспорта v3): она не помечает вкладки
 * второстепенными. `more` из контракта убран, и вместе с ним — право модели
 * решать, что спрятать: про ширину экрана она ничего не знает. Прячет ряд
 * вкладок по месту (shell/tabRow.ts). Оставь обе половины — и у ряда стало бы
 * два хозяина, а кто победил, зависело бы от порядка строк в коде.
 *
 * `decided: false` (или порядка нет вовсе) — список не меняется ВООБЩЕ. Это и
 * есть умолчание приложения, и оно остаётся умолчанием, а не превращается в
 * «модель так решила».
 */
export function applySections<T extends { id: string }>(
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
    // `content` из ряда вкладок уходит ВОВСЕ: такой раздел рисуется блоком в
    // хвосте тела. В этом и разница между «вкладкой» и «в конце контента»:
    // оставь его здесь хоть второстепенным — раздел покажется дважды.
    if (order.sections[i].slot === 'content') continue;
    named.push({ item, i });
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

/** Группа и её разделы, в порядке модели. */
export interface SectionGroupRun {
  group: SectionGroup;
  /** Ключи разделов группы — подряд, как их объявила модель. */
  keys: string[];
}

/**
 * Группы разделов — прогонами, в порядке модели.
 *
 * Прогон, а не «набор по ключу группы»: склейка в одну вкладку идёт по
 * соседству (см. `assertGroupRuns`), и тот, кто рисует ряд, должен получить
 * ровно ту последовательность, которую будет склеивать. Отдай ему множество —
 * и порядок подзаголовков внутри вкладки стал бы случайным.
 *
 * Чего здесь НЕТ: подписей разделов, счётчиков и самой вкладки. Подпись
 * раздела берётся из описания связи, счётчик вкладки — сумма счётчиков
 * разделов; и то и другое знает только тот, кто рисует запись.
 */
export function sectionGroups(order?: PassportOrder | null): SectionGroupRun[] {
  if (!order?.decided) return [];
  const runs: SectionGroupRun[] = [];
  for (const s of order.sections) {
    if (!s.group) continue;
    const last = runs[runs.length - 1];
    if (last && last.group.key === s.group.key) last.keys.push(s.key);
    else runs.push({ group: { ...s.group }, keys: [s.key] });
  }
  return runs;
}
