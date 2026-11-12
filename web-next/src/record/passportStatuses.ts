// Статусы паспорта — ЦИКЛ ТИПА из модели (S4-STATUS-AXIS-CONFIG).
//
// Жалоба владелицы на проде v1.17.7 (меню статуса задачи): «В работе» дважды,
// чужие статусы — «Предложено», «Скоро», «Исправлено», «Достигнуто»,
// «Отложено», — и нет «Запланировано».
//
// ПРИЧИНУ указала серверная сессия, проверив обе стороны (я до проверки
// сказала «это данные справочников» и была не права): `loreStatuses()` строил
// `config.statuses` из `KNOWN_STATUSES` kit, то есть из ВСЕХ осей разом.
// Отсюда чужие коды и два «В работе» (`active` и `in_progress` — обе строки
// «В работе» в локали). «Запланировано» не предлагалось потому, что это был
// текущий статус записи; это правило, а не поломка.
//
// Сервер отдаёт цикл КАЖДОГО типа: `/lore/model` → `statuses.<type>.entries` с
// `allow`. Разбор — тот же генератор kit, что у оболочки (`configFromModel`):
// знание о том, как документ превращается в конфиг, живёт в одном месте.
//
// Модели нет — остаётся умолчание приложения, и об этом СКАЗАНО словами:
// молчаливый откат выглядел бы как «так и задумано», а меню снова показывало
// бы чужие статусы.
import { configFromModel, loadModel, type KitConfig } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export interface TypeStatuses {
  /** Статьи цикла для `config.statuses.items`; пусто — умолчание приложения. */
  items: KitConfig['statuses']['items'];
  /** Что случилось — словами, на экран. Пусто — говорить нечего. */
  notes: string[];
  /**
   * S4-35 / ADR-LORE-049: показ полей типа в колонках (приоритет, ширина,
   * переполнение) из той же модели. Нет в модели — поля нет, а не пустой объект.
   */
  display?: Record<string, { priority: number; width: string; overflow: string }>;
  /**
   * Циклы ВСЕХ типов модели — для показа чужих записей в паспорте (дочерние таблицы,
   * Peek). Владелица 11.11: «в дочерних табличных видах не подтягиваются правильные
   * иконки, привязанные к статусам» — строки задач в паспорте спринта искали свой
   * статус в цикле спринта.
   */
  byKind?: Record<string, KitConfig['statuses']['items']>;
}

export interface TypeStatusesOptions {
  fetchImpl?: typeof fetch;
  url?: string;
}

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return e === undefined ? 'причина не названа' : String(e);
}

/** Цикл статусов типа плюс причины. Без React — проверяется тестом без экрана. */
export async function fetchTypeStatuses(type: string, opts: TypeStatusesOptions = {}): Promise<TypeStatuses> {
  const http = opts.fetchImpl ?? loreFetch;
  const url = opts.url ?? '/lore/model';
  const res = await loadModel(async signal => {
    const r = await http(url, signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`модель не прочитана: сервер ответил ${r.status}`);
    return r.json();
  });

  if (res.state === 'error') {
    return { items: [], notes: [`статусы взяты из умолчания приложения: модель недоступна (${reason(res.error)})`] };
  }
  const notes: string[] = [];
  if (res.state === 'stale') {
    notes.push(`цикл статусов взят из кеша модели и может быть устаревшим (${reason(res.error)})`);
  }
  if (!res.model) return { items: [], notes: [...notes, 'статусы — умолчание приложения: документа в ответе нет'] };

  // Имя словаря — это имя ТИПА: предметное имя даёт приложение, генератор kit
  // предметных имён не знает (K-14).
  const parsed = configFromModel(res.model, { statusDict: type });
  const model = res.model;
  const byKind = Object.fromEntries(Object.keys(model.statuses ?? {})
    .map(k => [k, k === type ? parsed.statuses : configFromModel(model, { statusDict: k }).statuses] as const)
    .filter(([, items]) => items.length > 0));
  const withKinds = Object.keys(byKind).length ? { byKind } : {};
  const typeDisplay = parsed.display[type];
  if (parsed.statuses.length === 0) {
    return {
      items: [],
      notes: [...notes, `статусы — умолчание приложения: в модели нет цикла для типа «${type}»`],
      ...(typeDisplay ? { display: typeDisplay } : {}),
      ...withKinds,
    };
  }
  // Берём только замечания ПРО СТАТУСЫ: потребителю цикла незачем читать
  // жалобы про разделы types, которыми он не пользуется.
  const display = parsed.display[type];
  return { items: parsed.statuses, notes: [...notes, ...parsed.notes.statuses], ...(display ? { display } : {}), ...withKinds };
}
