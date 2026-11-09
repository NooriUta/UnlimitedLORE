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

const NOT_DECIDED: PassportOrder = { decided: false, sections: [] };

export interface PassportOrderOptions {
  fetchImpl?: typeof fetch;
  url?: string;
}

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return e === undefined ? 'причина не названа' : String(e);
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
    // «Тип не решён» — это НЕ ошибка и не повод молчать: человек должен знать,
    // что порядок перед ним выбрал клиент, а не модель.
    if (!order.decided) notes.push('порядок разделов — умолчание приложения: для этого типа модель его не задаёт');
    return { order, notes };
  } catch (e) {
    // Сторож формы отказал (лишний ключ, неизвестный slot, дробный order).
    // Это расхождение с сервером, и прятать его нельзя: порядок окажется
    // клиентским, а выглядеть будет как серверный.
    return { order: NOT_DECIDED, notes: [...notes, `порядок разделов — умолчание приложения: модель не принята (${reason(e)})`] };
  }
}
