// Сумма с охватом: «сколько всего» и «у скольких это заполнено»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09, просьба владелицы 09.11.2026:
// «оценка и размер спринтов суммарно по дням и задач тоже важный элемент»).
//
// Колонка списка `sum:<поле>` читает `fields[<поле>]` и рисует итог. Что
// считать — решает приложение (у LORE это сервер), kit честно рисует исход.
// Тот же механизм, что у `progress:<поле>`, и та же доктрина.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ЯЧЕЙКА, А НЕ ЧИСЛО. Сумма без охвата врёт молча, и это не
// домысел: в корпусе LORE на 09.11.2026 поле «факт» не заполнено НИ У ОДНОЙ
// задачи — 0 из 1372 по двадцати крупнейшим спринтам, при том что оценка
// заполнена у 70%. Обычная числовая колонка напечатала бы в «факте» ноль, и
// он прочитался бы как «сделали за 0 дней» вместо «факт не заполняли». Это
// разные утверждения, и разница здесь дороже краткости.
//
// Четыре исхода, и ни один не выдаёт себя за другой:
//   • заполнено у всех      → только число;
//   • заполнено у части     → число и «у k из N» — число правда, но про часть;
//   • не заполнено ни у кого → «не заполнено», НЕ 0;
//   • не посчитали / считаем → причина и «…», как у прогресса.
import { kitT, useKitLang } from '../i18n';

/**
 * Имя поля из ключа колонки: `progress:tasks` и `sum:effort` → `tasks`,
 * `effort`. Заголовок колонки берётся по ИМЕНИ ПОЛЯ, а не по ключу, иначе в
 * шапке таблицы печатается «sum:effort». Одна функция на оба префикса: их было
 * два места на каждый, и они уже однажды разошлись бы при добавлении третьего.
 */
export function colKey(col: string): string {
  if (col.startsWith('progress:')) return col.slice('progress:'.length);
  if (col.startsWith('sum:')) return col.slice('sum:'.length);
  return col;
}

/**
 * Значение поля суммы, которое кладёт приложение в fields[<поле>].
 *
 * `cut` — «складывали НЕ ВСЁ»: выдачу, по которой считали, обрезали (потолок
 * строк, страница). Это НЕ то же, что `known < of`: там мы знаем, у скольких
 * поле заполнено, а здесь не знаем даже, все ли слагаемые видели. Признак
 * отдельный, потому что молча сложить обрезанное — худший исход: число
 * выглядит точным.
 */
export type KitSumInput =
  | { value: number | null; known: number; of: number; unit?: string; cut?: boolean }
  | { error: string }
  | { loading: true };

export type SumValue =
  | { kind: 'full' | 'partial'; value: number; known: number; of: number; unit?: string; cut?: boolean }
  | { kind: 'empty'; of: number; cut?: boolean }
  | { kind: 'error'; reason: string }
  | { kind: 'loading' }
  | { kind: 'none' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && v >= 0 && Number.isInteger(v);

export function sumOf(v: unknown): SumValue {
  if (!v || typeof v !== 'object') return { kind: 'none' };
  const o = v as Record<string, unknown>;
  if (typeof o.error === 'string') return { kind: 'error', reason: o.error };
  if (o.loading === true) return { kind: 'loading' };
  if (!isCount(o.known) || !isCount(o.of)) return { kind: 'none' };
  const unit = typeof o.unit === 'string' && o.unit ? o.unit : undefined;
  const cut = o.cut === true ? { cut: true as const } : {};
  // Охват ноль — «не заполнено», и значение при этом не смотрим вовсе: даже
  // если приложение прислало 0, утверждать «итог ноль» не из чего.
  if (o.known === 0) return { kind: 'empty', of: o.of, ...cut };
  if (!isNum(o.value)) return { kind: 'none' };
  const kind = o.known >= o.of ? 'full' : 'partial';
  return { kind, value: o.value, known: o.known, of: o.of, ...(unit ? { unit } : {}), ...cut };
}

/** Число без лишних нулей: 12 → «12», 12,5 → «12,5» (разделитель — по языку). */
export function formatSum(value: number, lang: string): string {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 2 }).format(value);
}

export function SumCell({ value }: { value: unknown }) {
  const lang = useKitLang();
  const s = sumOf(value);

  if (s.kind === 'error') {
    const label = kitT(lang, 'kit.sum.error', { reason: s.reason });
    return <span className="sk-sum" data-sum="error" role="img" aria-label={label} title={label}>?</span>;
  }
  if (s.kind === 'loading') {
    const label = kitT(lang, 'kit.sum.loading');
    return <span className="sk-sum" data-sum="loading" role="img" aria-label={label} title={label}>…</span>;
  }
  if (s.kind === 'none') {
    const label = kitT(lang, 'kit.sum.none');
    return <span className="sk-sum" data-sum="none" role="img" aria-label={label} title={label}>—</span>;
  }
  // «Складывали не всё»: звёздочка в строке и причина в подсказке. Та же
  // звёздочка, что у прогресса при неполном подсчёте, — один знак на оба
  // случая, чтобы его не приходилось узнавать дважды.
  const cutMark = s.cut ? '*' : '';
  const cutNote = s.cut ? ` · ${kitT(lang, 'kit.sum.cut')}` : '';

  if (s.kind === 'empty') {
    // «Не заполнено» словами, а не прочерком: прочерк читается как «нет данных
    // о поле», а здесь поле есть и оно пустое у всех.
    const label = kitT(lang, 'kit.sum.empty', { of: s.of }) + cutNote;
    return (
      <span className="sk-sum" data-sum="empty" data-cut={s.cut ? 'true' : undefined} title={label}>
        {kitT(lang, 'kit.sum.emptyShort')}{cutMark}
      </span>
    );
  }

  const num = formatSum(s.value, lang);
  const text = s.unit ? `${num} ${s.unit}` : num;
  if (s.kind === 'full') {
    const label = kitT(lang, 'kit.sum.full', { value: text, of: s.of }) + cutNote;
    return (
      <span className="sk-sum" data-sum="full" data-cut={s.cut ? 'true' : undefined} title={label}>
        {text}{cutMark}
      </span>
    );
  }
  const label = kitT(lang, 'kit.sum.partial', { value: text, known: s.known, of: s.of }) + cutNote;
  return (
    <span className="sk-sum" data-sum="partial" data-cut={s.cut ? 'true' : undefined} title={label}>
      <span className="sk-sum__value">{text}{cutMark}</span>
      {/* Охват виден В СТРОКЕ, а не только в подсказке: на телефоне наведения
          нет, и спрятанная туда оговорка там не существует. */}
      <span className="sk-sum__cover">{kitT(lang, 'kit.sum.cover', { known: s.known, of: s.of })}</span>
    </span>
  );
}
