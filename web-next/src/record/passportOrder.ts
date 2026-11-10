// Порядок разделов паспорта: берём из модели, а при неудаче говорим об этом
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Просьба владелицы 09.11.2026: «ты должен определять порядок например Спринт
// первое как ни странно задачи потом уже контент потом еще что-то а зависимости
// и прочее можно скрыть под море и сделать настройкой интерфейс становиться
// перегруженным».
//
// Порядок живёт в `surfaces.passport.<type>.sections` (#1011) — это умолчание
// ПОВЕРХНОСТИ, а не свойство типа: я сначала просил `types[t].tabs`, и мне
// отказали справедливо (D-2026-LORE-MODEL-TYPES-VS-SURFACES, плюс мой же
// сторож `dataOnly` не пустил бы в модель слово `tabs`).
//
// ТРИ ИСХОДА, И НИ ОДИН НЕ МОЛЧИТ:
//   • модель пришла и тип решён — порядок из данных;
//   • модель пришла, а тип НЕ решён (`decided: false`) — порядок остаётся
//     умолчанием приложения, и это сказано словами. «Сервер не решал» ≠
//     «сервер решил показать всё подряд»;
//   • модель не прочиталась или форма не та — тоже умолчание приложения, и
//     причина названа. Молчаливый откат был бы худшим исходом: человек решил
//     бы, что так и задумано.
import { loadModel, passportSections, type PassportOrder } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export interface PassportOrderResult {
  order: PassportOrder;
  /** Что случилось — словами, для показа человеку. Пусто — говорить нечего. */
  notes: string[];
}

const NOT_DECIDED: PassportOrder = { decided: false, sections: [], notes: [] };

export interface PassportOrderOptions {
  fetchImpl?: typeof fetch;
  url?: string;
}

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return e === undefined ? 'причина не названа' : String(e);
}

const obj = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * ПОЧЕМУ порядка нет — тремя разными утверждениями.
 *
 * Разные виноватые: раздела `surfaces` в документе нет вовсе (сервер его не
 * отдал или до клиента дошла старая модель) · раздел есть, а этого ТИПА в нём
 * нет · тип есть, и сервер честно говорит `decided: false` — порядок он ещё не
 * решал. Одна общая строка на все три случая не позволяла понять по экрану,
 * куда смотреть (находка CJM на проде 09.11.2026).
 */
function whyNotDecided(model: unknown, type: string): string {
  const doc = obj(model);
  const surfaces = doc && obj(doc.surfaces);
  // Загрузчик модели приводит отсутствующий раздел к пустому объекту, поэтому
  // «нет раздела» — это ПУСТО, а не undefined. Отдельно смотрим `missing`:
  // сервер сам называет разделы, которых в документе нет.
  const missing = Array.isArray(doc?.missing) ? doc.missing.map(String) : [];
  const noSurfaces = !surfaces || Object.keys(surfaces).length === 0
    || missing.some(m => m === 'surfaces:*' || m.startsWith('surfaces:passport'));
  if (noSurfaces) return 'в модели нет раздела surfaces.passport — порядок выбрал клиент';
  const passport = obj(surfaces.passport);
  if (!passport || Object.keys(passport).length === 0) {
    return 'в модели есть surfaces, но нет passport — порядок выбрал клиент';
  }
  const forType = obj(passport[type]);
  if (!forType) return `в модели нет порядка для типа «${type}» — порядок выбрал клиент`;
  return `для типа «${type}» сервер порядок ещё не решал (decided: false)`;
}

/** Разбор без React — чтобы это можно было проверить тестом без экрана. */
export async function fetchPassportOrder(
  type: string,
  opts: PassportOrderOptions = {},
): Promise<PassportOrderResult> {
  const http = opts.fetchImpl ?? loreFetch;
  const url = opts.url ?? '/lore/model';
  const res = await loadModel(async signal => {
    const r = await http(url, signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`модель не прочитана: сервер ответил ${r.status}`);
    return r.json();
  });

  if (res.state === 'error') {
    return { order: NOT_DECIDED, notes: [`порядок разделов — умолчание приложения: модель недоступна (${reason(res.error)})`] };
  }
  const notes: string[] = [];
  if (res.state === 'stale') {
    notes.push(`порядок разделов взят из кеша модели и может быть устаревшим (${reason(res.error)})`);
  }
  try {
    const order = passportSections(res.model, type);
    // Замечания разбора (лишние ключи в документе) — на экран. Сторож ослаблен
    // по CJM: лишний ключ больше не отказывает целиком, значит о нём обязан
    // сказать кто-то другой, иначе ослабление превратится в молчание.
    notes.push(...order.notes);
    // «Порядка нет» — это ТРИ разных утверждения, и у них разные виноватые.
    // Пока они были слиты в одну строку, проверка на проде v1.17.7 не могла
    // сказать, что случилось: серверная сессия проверила по коду, что
    // `/lore/model` отдаёт `surfaces.passport.sprint` с `decided: true`, а
    // порядок на экране не применился — и понять, не дошёл ли раздел, не дошёл
    // ли тип или сервер действительно не решал, было нечем.
    if (!order.decided) notes.push(`порядок разделов — умолчание приложения: ${whyNotDecided(res.model, type)}`);
    return { order, notes };
  } catch (e) {
    // Сторож формы отказал (лишний ключ, неизвестный slot, дробный order).
    // Это расхождение с сервером, и прятать его нельзя: порядок окажется
    // клиентским, а выглядеть будет как серверный.
    return { order: NOT_DECIDED, notes: [...notes, `порядок разделов — умолчание приложения: модель не принята (${reason(e)})`] };
  }
}
