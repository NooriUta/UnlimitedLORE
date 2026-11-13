// Виды «Библиотека» и «Календарь» в разделах LORE
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY, SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR).
//
// kit рисует оба вида, а ЧТО в них — решает приложение (граница K-14):
//   • библиотека — по какому полю группы, что значит «устарел», что писать
//     над заголовком; сам вид — `LibraryView` kit, читалка — паспорт записи;
//   • календарь — какое поле записи является датой. Поле называется явно и
//     только там, где дата у записи ЕСТЬ: время правки (`updated_at`) датой
//     события не считается, а раздел без даты календаря не получает вовсе.
import type { KitConfig, KitRecord, LibraryDoc, LibraryGroup } from '@seidr/kit';
import type { AppKey } from '../i18n';

/** Вид «Библиотека» в адресе: `?lib=1` — вид включён, `?libo=<id>` — читаемая запись. */
export const LIBRARY_PARAM = 'lib';
export const LIBRARY_OPEN_PARAM = 'libo';
/** Поле даты календаря в адресе (`?lcd=<поле>`), когда у раздела дат несколько. */
export const CALENDAR_DATE_PARAM = 'lcd';

export interface LibrarySpec {
  /** Поле разреза групп слева — ключ `fields` записи, объявленный у вида. */
  groupBy: string;
  /** Подпись группы записей без значения поля. */
  noGroupKey: AppKey;
  /** Устарел ли документ — решает раздел; нет — устаревших не бывает. */
  stale?: (r: KitRecord, cfg: KitConfig) => boolean;
  /** Строка над заголовком в читалке. */
  meta?: (r: KitRecord) => string | undefined;
}

export interface CalendarDate {
  /** Ключ поля записи (YYYY-MM-DD…). */
  field: string;
  /** Подпись даты словом раздела: «План: начало», «Дата выпуска». */
  labelKey: AppKey;
}

const categoryOf = (r: KitRecord, cfg: KitConfig) => cfg.statuses.items.find(s => s.code === r.status)?.category;

/** Устарел — статус закрытой ветки «отменено» (заменён, отклонён, выведен). */
export const staleByStatus = (r: KitRecord, cfg: KitConfig): boolean => categoryOf(r, cfg) === 'cancelled';

const groupValue = (v: unknown): string => {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
  return typeof v === 'string' ? v : v == null ? '' : String(v);
};

/**
 * Записи раздела → группы библиотеки.
 *
 * Порядок групп: крупные выше, при равенстве — по алфавиту; записи без
 * значения — последней группой с подписью раздела («Без области»), а не
 * пустым заголовком. Порядок записей в группе — как в выдаче (срез уже
 * отдаёт их в своём порядке; второй порядок здесь разошёлся бы со списком).
 */
export function libraryGroups(records: readonly KitRecord[], spec: LibrarySpec, cfg: KitConfig, noGroupTitle: string): LibraryGroup[] {
  const by = new Map<string, KitRecord[]>();
  for (const r of records) {
    const k = groupValue(r.fields[spec.groupBy]);
    const list = by.get(k) ?? [];
    list.push(r);
    by.set(k, list);
  }
  const statusTitle = (r: KitRecord) => cfg.statuses.items.find(s => s.code === r.status)?.title;
  const toDoc = (r: KitRecord): LibraryDoc => {
    const state = r.status ? statusTitle(r) : undefined;
    const meta = spec.meta ? spec.meta(r) : undefined;
    return {
      id: r.id, code: r.id, title: r.title,
      ...(state ? { state } : {}),
      stale: spec.stale ? spec.stale(r, cfg) : false,
      ...(meta ? { meta } : {}),
    };
  };
  return [...by.entries()]
    .sort(([a, ra], [b, rb]) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || rb.length - ra.length || a.localeCompare(b))
    .map(([k, rs]) => ({ key: k || '—', title: k || noGroupTitle, docs: rs.map(toDoc) }));
}

/** Поле даты календаря: выбор из адреса, если он из названных разделом; иначе первое. */
export function calendarField(dates: readonly CalendarDate[], picked: string | null | undefined): string {
  return dates.find(d => d.field === picked)?.field ?? dates[0]?.field ?? '';
}

/** Конфиг раздела + календарь: вид `calendar` и `list.calendar.date` — первое из названных полей. */
export function withCalendar(cfg: KitConfig, dates: readonly CalendarDate[]): KitConfig {
  const list = cfg.list!;
  return {
    ...cfg,
    list: { ...list, views: list.views.includes('calendar') ? list.views : [...list.views, 'calendar'], calendar: { date: dates[0].field } },
  };
}

/**
 * Конфиг раздела + библиотека (MP2-12): «Библиотека» — ВИД движка списка kit
 * (`lv=library`, радиокнопка в меню видов наравне с лентой и карточками), а не
 * соседняя кнопка в шапке. Адрес `?lib=1` остаётся рабочим входом в вид:
 * экран переводит его в состояние вида при загрузке.
 */
export function withLibrary(cfg: KitConfig): KitConfig {
  const list = cfg.list!;
  return {
    ...cfg,
    list: { ...list, views: list.views.includes('library') ? list.views : [...list.views, 'library'] },
  };
}
