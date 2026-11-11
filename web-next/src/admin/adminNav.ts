// Переход между разделами админки изнутри экрана (S7B-01): «Открыть в журнале»
// из пачки ролей, «карточка человека» из карточки роли.
//
// В модуле оболочки (?mod=admin) раздел — пункт меню KitShell, и переходить
// надо через навигацию оболочки: иначе меню не узнает, где мы. Экран сам не
// знает, где он смонтирован, поэтому способ перехода даёт тот, кто монтирует
// (V2Shell); без него — адрес ?adm=… (так экран живёт в тестах).
import { createContext, useContext } from 'react';
import { setUrlParams } from '@seidr/kit';

export type AdminTab = 'home' | 'wiz' | 'agents' | 'who' | 'projects' | 'roles' | 'dicts' | 'rules' | 'flags' | 'mcp' | 'log';

export interface AdminNav {
  /** Открыть раздел и положить в адрес его параметры. */
  go: (tab: AdminTab, params?: Record<string, string | null>) => void;
}

const fallback: AdminNav = {
  go: (tab, params = {}) => { setUrlParams({ adm: tab, ...params }); },
};

const AdminNavContext = createContext<AdminNav>(fallback);

export const AdminNavProvider = AdminNavContext.Provider;

export function useAdminNav(): AdminNav {
  return useContext(AdminNavContext);
}
