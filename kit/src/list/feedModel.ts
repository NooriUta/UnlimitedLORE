// Лента как ВИД того же источника — модель (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW,
// spec:SPEC-LORE-KIT-FEED-VIEW §1–3, §6, §7).
//
// Лента — не экран, а ВИД: тот же источник (`KitData`), та же строка
// управления, те же честные состояния. Поэтому здесь НЕТ ни фильтрации, ни
// своей группировки по полю: записи приходят уже отфильтрованными общим
// движком списка, а группы по полю — общей `groupBy`. Иначе у фильтров
// появилась бы вторая реализация, и «Статус: в работе» в таблице и в ленте
// однажды разошлись бы.
//
// Что здесь ЕСТЬ и почему:
//   • ведра времени (сегодня · вчера · на этой неделе · раньше) — умолчание
//     вида, которого у таблицы нет;
//   • три исхода вместо одного: «нет отметки» ≠ «отметку не прочитали» ≠
//     «давно». Лента читается как ПОТОК СОБЫТИЙ, и пропуск в ней читается как
//     «ничего не было», поэтому каждый исход называется своим словом;
//   • провалы источника как строки ленты — на своём месте по времени.
//
// Какое поле записи несёт время, какие поля — суть, какие связи — повод, kit НЕ
// УГАДЫВАЕТ: это предметное знание приложения (водораздел K-14). Оно приходит
// названным, в `FeedFields`.
import type { KitConfig, KitMeta, KitRecord } from '../core/contract';
import { fieldValue, valueKey } from './listModel';
import type { ListGroup } from './listModel';

/**
 * Поля ленты, НАЗВАННЫЕ приложением (§2).
 *
 * `timeField` — по какому полю время (`updated_at`, `fields.happened`…);
 * `lead` — одно-два поля «сути», которые делают строку читаемой историей;
 * `because` — типы связей, объясняющих повод.
 *
 * Названо только `timeField` — лента работает: суть и повод необязательны, и
 * строка тогда состоит из времени, вида, кода и названия.
 */
export type FeedFields = NonNullable<NonNullable<KitConfig['list']>['feed']>;

/** Группа «без времени»: у записи нет отметки вовсе. Не ключ поля — с ним не столкнётся. */
export const FEED_UNDATED = '__feed_undated__';
/** Группа «время не прочиталось»: отметка есть, но разобрать её не смогли. */
export const FEED_UNREAD = '__feed_unread__';
/** Группа провалов источника при группировке полем: в чью группу они попали бы — неизвестно. */
export const FEED_GAPS = '__feed_gaps__';

export type FeedBucket = 'today' | 'yesterday' | 'week' | 'earlier';
/** Порядок групп сверху вниз: свежее выше, непрочитанное и «нет отметки» — в конце. */
export const FEED_GROUP_ORDER: readonly string[] = ['today', 'yesterday', 'week', 'earlier', FEED_UNREAD, FEED_UNDATED];

/**
 * Время записи по НАЗВАННОМУ полю; значения нет — null.
 *
 * null означает «отметки нет», а не «ошибка»: запись уйдёт в группу «без
 * времени» и НЕ потеряется (§2). Потерять её было бы худшим из исходов —
 * в ленте пропажа читается как «этого не было».
 */
export function feedTime(r: KitRecord, timeField: string): string | null {
  const v = valueKey(fieldValue(r, timeField));
  return v === '' ? null : v;
}

/** День отметки числом (UTC-полночь), чтобы считать разницу в сутках; не разобрали — null. */
function dayMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Ведро времени относительно «сейчас» ИСТОЧНИКА (`meta.generated_at`), а не
 * часов браузера: «сегодня» обязано значить тот же день, по которому собрана
 * выдача, иначе на стыке суток лента покажет «сегодня» там, где источник
 * считал иначе.
 *
 * Отметка в будущем не получает своего ведра: она идёт в «сегодня» — это
 * верхний край потока, и прятать такую запись хуже, чем показать её первой.
 */
export function feedBucket(iso: string | null, now: string): FeedBucket | typeof FEED_UNDATED | typeof FEED_UNREAD {
  if (iso === null) return FEED_UNDATED;
  const d = dayMs(iso);
  const n = dayMs(now);
  if (d === null) return FEED_UNREAD;
  // «Сейчас» источника не прочиталось — ведро посчитать нечем, но отметка у
  // записи есть: «не прочиталось» честнее, чем назвать её «давней».
  if (n === null) return FEED_UNREAD;
  const days = Math.round((n - d) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'week';
  return 'earlier';
}

/**
 * Умолчание порядка: свежие сверху, записи без отметки — в конце.
 *
 * Это УМОЛЧАНИЕ, а не правило: выбранный в строке управления порядок главнее,
 * и тогда ленте передаётся уже отсортированный им набор.
 */
export function feedOrder(records: readonly KitRecord[], timeField: string): KitRecord[] {
  return [...records]
    .map((r, i) => ({ r, i, at: feedTime(r, timeField) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.i - b.i;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      const c = b.at.localeCompare(a.at);
      return c !== 0 ? c : a.i - b.i;
    })
    .map(x => x.r);
}

/** Провал источника строкой ленты: «нет прав» и «не смогли проверить» — РАЗНЫЕ исходы (§6). */
export interface FeedGap {
  block: string;
  reason: string;
  kind: 'failed' | 'forbidden';
  /** Когда провал случился; не названо — строка идёт в «без времени», а не притворяется свежей. */
  at: string | null;
}

/**
 * Провалы блоков как строки ленты.
 *
 * «Нет прав» отличается от сбоя не формулировкой, а признаком из данных:
 * догадываться по тексту причины значило бы угадывать (403 бывает в чужом
 * сообщении, а сбой — без кода). Признак называет приложение.
 */
export function feedGaps(meta: Pick<KitMeta, 'errors'>): FeedGap[] {
  return (meta.errors ?? []).map(e => ({
    block: e.block,
    reason: e.reason,
    kind: e.forbidden ? 'forbidden' : 'failed',
    at: e.at ?? null,
  }));
}

export type FeedRow =
  | { kind: 'record'; at: string | null; record: KitRecord }
  | { kind: 'gap'; at: string | null; gap: FeedGap };

export interface FeedGroup {
  /** Ведро времени, FEED_UNDATED / FEED_UNREAD / FEED_GAPS или ключ группировки таблицы. */
  key: string;
  rows: FeedRow[];
  /** Группа пришла из общей группировки — подпись берётся её правилами (groupLabel). */
  group?: ListGroup;
  /** Ведро времени (умолчание вида). */
  bucket?: FeedBucket;
}

/**
 * Провал встаёт ТУДА, где запись с таким временем и была бы: перед первой
 * строкой, которая старше его (порядок внутри группы — свежие сверху).
 * Строки без отметки — всегда ниже: у них времени нет, спорить с ними нечем.
 */
function insertGap(rows: FeedRow[], gap: FeedGap): void {
  const at = gap.at;
  const row: FeedRow = { kind: 'gap', at, gap };
  if (at === null) { rows.push(row); return; }
  const i = rows.findIndex(r => r.at === null || r.at.localeCompare(at) < 0);
  if (i === -1) rows.push(row);
  else rows.splice(i, 0, row);
}

/**
 * Группы ленты по времени — умолчание вида (§3).
 *
 * Порядок записей внутри ведра — ТОТ, в котором они пришли: порядок выбирает
 * строка управления, а не лента. Пустых ведёр не рисуем: «Вчера — ничего» в
 * потоке событий читается как утверждение, которого мы не делали.
 */
export function feedByTime(
  records: readonly KitRecord[], gaps: readonly FeedGap[], timeField: string, now: string,
): FeedGroup[] {
  const byKey = new Map<string, FeedRow[]>();
  const push = (key: string, row: FeedRow) => {
    const rows = byKey.get(key);
    if (rows) rows.push(row);
    else byKey.set(key, [row]);
  };
  for (const r of records) {
    const at = feedTime(r, timeField);
    push(feedBucket(at, now), { kind: 'record', at, record: r });
  }
  for (const g of gaps) {
    const key = feedBucket(g.at, now);
    const rows = byKey.get(key) ?? [];
    if (!byKey.has(key)) byKey.set(key, rows);
    insertGap(rows, g);
  }
  return FEED_GROUP_ORDER
    .filter(k => (byKey.get(k)?.length ?? 0) > 0)
    .map(k => {
      const rows = byKey.get(k)!;
      const bucket = k === FEED_UNDATED || k === FEED_UNREAD ? undefined : (k as FeedBucket);
      return bucket ? { key: k, rows, bucket } : { key: k, rows };
    });
}

/**
 * Группы ленты по группировке ТАБЛИЦЫ (§3): те же группы, тот же порядок, те
 * же подписи. Своей группировки по полю у ленты нет — иначе «по статусу» в
 * таблице и в ленте однажды дали бы разные группы.
 *
 * Провалы источника при такой группировке идут ОТДЕЛЬНОЙ группой сверху: в
 * чью группу попала бы незагруженная запись, неизвестно, и положить провал в
 * любую из существующих значило бы это придумать.
 */
export function feedByGroups(
  groups: readonly ListGroup[], gaps: readonly FeedGap[], timeField: string,
): FeedGroup[] {
  const out: FeedGroup[] = [];
  if (gaps.length > 0) {
    const rows: FeedRow[] = [];
    for (const g of gaps) insertGap(rows, g);
    out.push({ key: FEED_GAPS, rows });
  }
  for (const g of groups) {
    out.push({
      key: g.key,
      group: g,
      rows: g.records.map(r => ({ kind: 'record' as const, at: feedTime(r, timeField), record: r })),
    });
  }
  return out;
}
