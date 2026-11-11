// Значение-чип: объект с кодом и подписью вместо строки
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, половина kit).
//
// Серверная сессия 10.11.2026 сменила форму: `values.projects` и
// `values.components` были списком строк, стали списком объектов
// `{id, label, inherited_from}`. Старый путь падал в `JSON.stringify`, и на
// экран выезжал JSON целиком: подпись выглядела данными, ссылка по такому
// «коду» вела в никуда, а в фасете каждый чип становился отдельным значением —
// то есть фильтр по проекту ломался МОЛЧА.
//
// Почему это форма, а не предметное знание (водораздел K-14): «значение может
// прийти объектом с кодом и человеческой подписью, и подпись бывает
// унаследована от другой записи» — утверждение о форме данных. Что именно за
// проект или компонент, от кого он наследуется и как это назвать словами —
// знает приложение, и подписи приходят от него.

/**
 * Значение, пришедшее объектом.
 *
 * `label` необязателен: подписи может не быть, и тогда на экран идёт КОД —
 * выдумывать слово за приложение нельзя, а пустое место скрыло бы, что
 * значение есть.
 *
 * `inherited_from` — откуда значение досталось записи. `null` значит «своё»;
 * у задачи «проект её спринта» и «её собственный проект» — РАЗНЫЕ утверждения,
 * и человек принимает по ним разные решения.
 */
export interface ChipValue {
  id: string;
  label?: string | null;
  inherited_from?: { type: string; id: string } | null;
}

/**
 * Сколько чипов стоит в ряду до свёртки «ещё N». Число названо серверной
 * сессией; живёт ОДНИМ местом, иначе вёрстка и договор разойдутся.
 */
export const VALUE_CHIPS_INLINE = 3;

/** Непустая строка или ничего. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Значение — чип? Признак один: объект с НЕПУСТЫМ строковым кодом.
 *
 * Код обязателен, потому что он — единственное, по чему чип можно открыть и
 * отфильтровать. Объект с одной подписью и без кода чипом не считается: мы не
 * смогли бы ни сослаться на него, ни сравнить с другим.
 */
export function asChip(v: unknown): ChipValue | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  if (id === null) return null;
  const from = o.inherited_from;
  return {
    id,
    label: str(o.label),
    // Битый источник (без типа или кода) читать нечем, но утверждение «пришло
    // не от самой записи» остаётся верным: обнулить его значило бы выдать
    // унаследованный чип за собственный.
    inherited_from: from === null || from === undefined
      ? null
      : typeof from === 'object' && !Array.isArray(from)
        ? { type: String((from as Record<string, unknown>).type ?? ''), id: String((from as Record<string, unknown>).id ?? '') }
        : null,
  };
}

/** Код чипа — то, по чему его открывают, фильтруют и сравнивают. */
export function chipId(c: ChipValue): string {
  return c.id;
}

/** Подпись чипа словами; подписи нет — КОД, а не пустота. */
export function chipLabel(c: ChipValue): string {
  return str(c.label) ?? c.id;
}

/**
 * Список — это список чипов? Достаточно ОДНОГО пригодного элемента.
 *
 * Нарочно не «все элементы»: на стыке версий список бывает смешанным (часть
 * уже объектами, часть ещё строками). Требовать однородности значило бы в этом
 * случае уехать на старый путь и снова напечатать JSON.
 */
export function isChipList(v: unknown): boolean {
  return Array.isArray(v) && v.some(x => asChip(x) !== null);
}

/** Список значений к чипам; строки становятся чипами без подписи. */
export function toChips(v: unknown): ChipValue[] {
  const list = Array.isArray(v) ? v : [v];
  const out: ChipValue[] = [];
  for (const x of list) {
    const c = asChip(x);
    if (c) { out.push(c); continue; }
    const s = str(x);
    if (s !== null) out.push({ id: s, label: null, inherited_from: null });
  }
  return out;
}
