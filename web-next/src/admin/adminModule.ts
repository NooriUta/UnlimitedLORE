// Админка модулем оболочки v2 (SPRINT_UXR_S7B_ADMIN/S7B-01, прототип
// docs/prototypes/s7b-admin-v6.html): ?mod=admin, раздел — sec=adm-….
//
// Здесь только данные: разделы, группы меню по смыслу и риску и перевод
// старых адресов /admin?adm=… в модуль. Экраны подключает V2Shell, меню
// рисует KitShell — kit предметных имён не знает (K-14).
import { appT, type AppKey } from '../i18n';
import type { KitConfig, KitLang } from '@seidr/kit';

export const ADMIN_MODULE = 'admin';

/** Разделы админки — они же id пунктов меню и значения sec. */
export const ADMIN_SECTIONS = ['adm-home', 'adm-agents', 'adm-who', 'adm-roles', 'adm-rules', 'adm-flags', 'adm-mcp', 'adm-log'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function isAdminSection(id: string | null): id is AdminSection {
  return id !== null && (ADMIN_SECTIONS as readonly string[]).includes(id);
}

/** Подпись раздела — те же ключи, что у заголовков экранов. */
const TITLE: Record<AdminSection, AppKey> = {
  'adm-home': 'admin.home.title',
  'adm-agents': 'admin.agents.title',
  'adm-who': 'admin.who.title',
  'adm-roles': 'admin.roles.title',
  'adm-rules': 'admin.rules.title',
  'adm-flags': 'admin.flags.title',
  'adm-mcp': 'admin.mcp.title',
  'adm-log': 'admin.log.title',
};

const ICON: Record<AdminSection, string> = {
  'adm-home': 'house',
  'adm-agents': 'robot-golem',
  'adm-who': 'person',
  'adm-roles': 'key',
  'adm-rules': 'scroll-quill',
  'adm-flags': 'flying-flag',
  'adm-mcp': 'plug',
  'adm-log': 'open-book',
};

export function adminSectionTitle(lang: KitLang, id: AdminSection): string {
  return appT(lang, TITLE[id]);
}

/**
 * Меню админки — группы по смыслу и риску, а не по таблицам:
 *   • «Начало» — Главная «что требует внимания» (S7B-26): вход в модуль;
 *   • «Люди и агенты» — кто есть и чем работает (чтение, правка своего);
 *   • «Доступ» — роли и права: правка здесь меняет, кто что видит, — тон риска;
 *   • «Язык графа» — правила CLAUDE;
 *   • «Система» — флаги и версия, MCP, журнал действий.
 */
export function adminMenu(lang: KitLang): KitConfig['menu'] {
  const item = (id: AdminSection) => ({ id, title: adminSectionTitle(lang, id), icon: ICON[id] });
  return {
    myViews: false,
    recent: false,
    groups: [
      { id: 'adm-start', title: appT(lang, 'shell.grp.admStart'), tone: 'var(--acc)', items: [item('adm-home')] },
      { id: 'adm-people', title: appT(lang, 'shell.grp.admPeople'), tone: 'var(--acc)', items: [item('adm-agents'), item('adm-who')] },
      { id: 'adm-access', title: appT(lang, 'shell.grp.admAccess'), tone: 'var(--wrn)', items: [item('adm-roles')] },
      { id: 'adm-lang', title: appT(lang, 'shell.grp.admLang'), tone: 'var(--suc)', items: [item('adm-rules')] },
      { id: 'adm-system', title: appT(lang, 'shell.grp.admSystem'), tone: 'var(--inf)', items: [item('adm-flags'), item('adm-mcp'), item('adm-log')] },
    ],
  };
}

/** Вкладка прежней страницы /admin (?adm=…) → раздел модуля. */
export function adminSectionOfTab(tab: string | null): AdminSection {
  const id = `adm-${tab ?? ''}`;
  // Нет вкладки или она неизвестна — Главная (S7B-26): вход в модуль начинается с неё.
  return isAdminSection(id) ? id : 'adm-home';
}

/**
 * Старый адрес /admin?adm=X&… → /?mod=admin&sec=adm-X&… Параметры раздела
 * (adm-person, adm-batch…) сохраняются: ссылка из журнала или чата открывает
 * то же самое, только уже внутри оболочки.
 */
export function legacyAdminHref(search: string): string {
  const old = new URLSearchParams(search);
  const next = new URLSearchParams();
  next.set('mod', ADMIN_MODULE);
  next.set('sec', adminSectionOfTab(old.get('adm')));
  old.forEach((v, k) => { if (k !== 'adm' && k !== 'mod' && k !== 'sec') next.append(k, v); });
  return `/?${next.toString()}`;
}
