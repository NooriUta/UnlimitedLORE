// Навигация из «Недавнего» левого меню (жалоба с прода v1.17.9): клик по
// пункту не вёл никуда — URL не менялся, паспорт не открывался, а порядок
// пунктов перестраивался.
//
// Разбор: KitShell обрабатывает клик сам — обновляет «Недавнее» и зовёт
// колбэк onOpenRecord(id) (kit/src/shell/KitShell.tsx), а web-next этот колбэк
// KitShell не передавал. Касание засчитывалось, а куда идти — было неизвестно.
//
// Куда вести запись решает единый модуль адресов (S4-13), а у «Недавнего» тип
// записи не хранится. Но при каждом открытии записи (ListScreen, палитра)
// оболочка кладёт в recentMeta адрес вида ?mod=…&sec=<раздел>&open=<id> —
// раздел записи читается оттуда. Выдумывать раздел по префиксу кода нельзя:
// неизвестный тип — честное «открыть негде», а не тихий раздел по умолчанию.
import { pushUrlState, readUrlState, type KitShellApi, type SafeStorage } from '@seidr/kit';
import { readRoute } from '../nav/loreRoutes';

/** Ключ хранилища оболочки — тот, что V2Shell передаёт KitShell (storageKey). */
export const SHELL_STORAGE_KEY = 'lore-v2.shell';

interface RecentMetaRow { title?: string; href?: string }

/** Мета недавних из хранилища оболочки; формат — тот, что пишет KitShell. */
export function readRecentMeta(storage: SafeStorage): Record<string, RecentMetaRow> {
  const raw = storage.get(`${SHELL_STORAGE_KEY}.recentMeta`);
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, RecentMetaRow> = {};
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
      if (!m || typeof m !== 'object') continue;
      const { title, href } = m as Record<string, unknown>;
      const row: RecentMetaRow = {};
      if (typeof title === 'string') row.title = title;
      if (typeof href === 'string') row.href = href;
      if (row.title || row.href) out[k] = row;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Раздел записи из адреса, сохранённого при её открытии; null — адреса нет
 * или вести некуда (раздел не раздел записей). Разбор — через readRoute
 * (loreRoutes): известный раздел записей с тем же open в адресе, иначе null.
 */
export function recentSectionOf(storage: SafeStorage, id: string): string | null {
  const href = readRecentMeta(storage)[id]?.href;
  if (!href) return null;
  const route = readRoute(new URL(href, 'http://lore.invalid').searchParams);
  return route.record && route.record.id === id ? route.sec : null;
}

/**
 * Открыть запись из «Недавнего»: сначала раздел — через navigate оболочки
 * (pushState popstate не поднимает, и оболочка должна узнать о смене раздела
 * сама), затем ?open= — заменой текущей записи истории: «назад» возвращает к
 * тому, откуда шли, а не заставляет жать дважды (порядок как у палитры, S4-14).
 *
 * False — адреса записи нет, окна нет или запись этого раздела УЖЕ открыта:
 * навигации негде взять раздел или нечего менять, и честнее остаться на месте,
 * чем увести не туда или гнать экран на пересборку. Уже-открытое бывает не
 * только по повторному клику: палитра открывает запись сама и тоже зовёт
 * api.openRecord — без проверки клик из неё дал бы вторую пересборку экрана.
 * Касание при этом уже засчитано в любом случае.
 */
export function openRecent(api: KitShellApi, storage: SafeStorage, id: string): boolean {
  const sec = recentSectionOf(storage, id);
  if (!sec || !api.win) return false;
  const cur = readUrlState(api.win);
  if (cur.get('sec') === sec && cur.get('open') === id) return false;
  api.navigate({ item: sec, view: null });
  pushUrlState({ open: id, place: null }, { replace: true, win: api.win, anchor: null });
  return true;
}
