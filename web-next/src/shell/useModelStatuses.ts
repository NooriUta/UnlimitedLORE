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
import { loadModel, type KitConfig } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { statusesFromModel } from './statusesFromModel';

/** Словарь статусов LORE для задач, спринтов и ADR — один справочник. */
export const LORE_STATUS_DICT = 'task_status';

export interface ModelStatuses {
  /** Статьи для `v2Config`; пусто — остаётся рукописное умолчание. */
  items: KitConfig['statuses']['items'];
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
  const parsed = statusesFromModel(res.model, LORE_STATUS_DICT);
  return { items: parsed.items, notes: [...notes, ...parsed.warnings] };
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
