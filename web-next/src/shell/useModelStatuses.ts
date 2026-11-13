// Словарь статусов для оболочки v2: грузим модель и честно говорим, что вышло
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Первый настоящий потребитель загрузчика модели из kit
// (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER): он был написан, покрыт тестами и
// до сих пор не вызывался ниоткуда — тот же класс, что я весь день разбираю.
//
// Три состояния различаются намеренно, потому что человеку они означают разное:
//   • модель пришла — словарь из данных, рукописный список не используется;
//   • модель из кеша — работаем, но говорим, что она устаревшая и почему;
//   • модели нет — остаётся рукописное умолчание приложения, и причина названа
//     словами. Это НЕ «всё хорошо»: на устаревшем или отсутствующем словаре
//     новый статус снова выйдет пустым чипом.
import { useEffect, useState } from 'react';
import { configFromModel, loadModel, type KitConfig } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import type { ModelNavGroup } from './v2Config';

/** Словарь статусов LORE для задач, спринтов и ADR — один справочник. */
export const LORE_STATUS_DICT = 'task_status';

export interface ModelStatuses {
  /** Статьи для `v2Config`; пусто — остаётся рукописное умолчание. */
  items: KitConfig['statuses']['items'];
  /** MC-07: общее меню из модели (surfaces.nav); нет — рукописное меню оболочки. */
  nav?: ModelNavGroup[];
  /** Что случилось: словами, для показа человеку. */
  notes: string[];
  /** Модель ещё грузится — чтобы не мигать умолчанием, если это важно экрану. */
  loading: boolean;
}

export interface UseModelStatusesOptions {
  /** Подмена сети (тесты). */
  fetchImpl?: typeof fetch;
  /** Адрес модели; по умолчанию относительный, как у остальных вызовов v2. */
  url?: string;
}

/** Разбор ответа модели в статьи словаря плюс причины — без React, для тестов. */
export async function fetchModelStatuses(
  opts: UseModelStatusesOptions = {},
): Promise<Omit<ModelStatuses, 'loading'>> {
  const http = opts.fetchImpl ?? loreFetch;
  const url = opts.url ?? '/lore/model';
  const res = await loadModel(async signal => {
    const r = await http(url, signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`модель не прочитана: сервер ответил ${r.status}`);
    return r.json();
  });

  const notes: string[] = [];
  if (res.state === 'error') {
    notes.push(`словарь статусов взят из умолчания приложения: модель недоступна (${reason(res.error)})`);
    return { items: [], notes };
  }
  if (res.state === 'stale') {
    notes.push(`модель взята из кеша и может быть устаревшей (${reason(res.error)})`);
  }
  // Генератор ЖИВЁТ В KIT (K-MODEL-LOADER, K-14): словарь статусов — данные
  // приложения, и знание о том, как документ превращается в конфиг, не должно
  // лежать в каждом приложении отдельно. Прежний разбор был здесь, в web-next,
  // и у второго приложения на kit пришлось бы написать такой же.
  //
  // Предметное имя словаря по-прежнему даёт ПРИЛОЖЕНИЕ (LORE_STATUS_DICT): в
  // kit нет ни одного имени из LORE, и это держится тестом-грепом.
  // Тип res.model допускает undefined у состояния error, а оно уже отсечено
  // выше возвратом: иначе пришлось бы молча подставлять пустой документ.
  if (!res.model) return { items: [], notes: [...notes, "модель прочитана, но документа в ответе нет"] };
  const parsed = configFromModel(res.model, { statusDict: LORE_STATUS_DICT });
  // Берём замечания ТОЛЬКО про статусы: про виды записей этот потребитель не
  // спрашивал, и печатать человеку жалобу о том, чем сам не пользуешься, —
  // шум, а не честность.
  // MC-07: меню — тем же ответом /lore/model; формы не проверенной сервером модели здесь нет.
  const surfaces = (res.model as { surfaces?: { nav?: unknown } }).surfaces;
  const nav = Array.isArray(surfaces?.nav) ? (surfaces.nav as ModelNavGroup[]) : undefined;
  return { items: parsed.statuses, notes: [...notes, ...parsed.notes.statuses], ...(nav ? { nav } : {}) };
}

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return e === undefined ? 'причина не названа' : String(e);
}

/**
 * Словарь статусов из модели для оболочки. Пока грузится — пусто, то есть
 * действует умолчание приложения; это honest-состояние, а не «ещё нет данных»:
 * экран работает, просто словарь пока рукописный.
 */
export function useModelStatuses(opts: UseModelStatusesOptions = {}): ModelStatuses {
  const [state, setState] = useState<Omit<ModelStatuses, 'loading'>>({ items: [], notes: [] });
  const [loading, setLoading] = useState(true);
  const { fetchImpl, url } = opts;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchModelStatuses({ fetchImpl, url })
      .then(r => { if (alive) setState(r); })
      .catch(e => {
        // Сюда попадаем только при поломке самого разбора: загрузчик модели
        // ошибки источника уже перевёл в состояние. Молчать всё равно нельзя.
        if (alive) setState({ items: [], notes: [`словарь статусов не прочитан: ${reason(e)}`] });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchImpl, url]);

  return { ...state, loading };
}
