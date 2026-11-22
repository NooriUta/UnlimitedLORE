// Меню «сверху» и нижняя панель на телефоне; скрытие пространств по роли (SPRINT_UXR_S15_KIT6;
// владелица 21.11.2026: «доделай» — по сверке kit с прототипом GLADSHEIM /appnew).
//   • Пространства — группы меню kit (config.menu.groups), главы — их пункты. Рейка слева (KitShell, режим rail)
//     и эти два элемента показывают ОДНО меню: приложение не держит второй список.
//   • TopNav — верхняя полоса: пространства, под ними главы текущего; справа — место приложения (вид, языки).
//   • BottomBar — нижняя панель для узкого экрана (на широком скрыта CSS): кнопка на пространство.
//   • menuForRole — меню под роль: группа с roles видна только им. Права решает сервер; это — не показывать
//     человеку разделы, которые ему всё равно откажут.
// Навигацию делает приложение (onGo) — обычно useKitShell().navigate({ item }).
import type { ReactNode } from 'react';
import type { KitConfig } from '../core/contract';
import { kitT, useKitLang } from '../i18n';

export type MenuGroup = KitConfig['menu']['groups'][number];

/** Конфиг с меню под роль: группы с roles — только для перечисленных ролей. Исходный конфиг не меняется. */
export function menuForRole(config: KitConfig, role: string): KitConfig {
  const groups = config.menu.groups.filter((g) => !g.roles || g.roles.includes(role));
  return { ...config, menu: { ...config.menu, groups } };
}

/** Пространство, в котором лежит пункт; неизвестный пункт — первое пространство. */
export function spaceOfItem(groups: readonly MenuGroup[], item: string | null | undefined): MenuGroup | undefined {
  return groups.find((g) => g.items.some((i) => i.id === item)) ?? groups[0];
}

export function TopNav({ groups, item, onGo, end }: { groups: readonly MenuGroup[]; item: string | null | undefined; onGo: (item: string) => void; end?: ReactNode }) {
  const space = spaceOfItem(groups, item);
  const lang = useKitLang();
  return (
    <nav className="sk-topnav" aria-label={kitT(lang, 'kit.nav.spaces')}>
      <div className="sk-topnav__spaces">
        {groups.map((g) => (
          <button key={g.id} type="button" className="sk-topnav__space" aria-current={g.id === space?.id ? 'true' : undefined}
            onClick={() => g.items[0] && onGo(g.items[0].id)}>{g.title}</button>))}
        {end && <span className="sk-topnav__end">{end}</span>}
      </div>
      {space && space.items.length > 1 && (
        <div className="sk-topnav__chapters">
          {space.items.map((i) => (
            <button key={i.id} type="button" className="sk-topnav__chapter" aria-current={i.id === item ? 'page' : undefined} onClick={() => onGo(i.id)}>{i.title}</button>))}
        </div>)}
    </nav>
  );
}

/** Нижняя панель (узкий экран): кнопка на пространство с иконкой первой главы или своей. icon — рисует приложение (GameIcon, Lucide…). */
export function BottomBar({ groups, item, onGo, icon }: { groups: readonly MenuGroup[]; item: string | null | undefined; onGo: (item: string) => void; icon?: (slug: string) => ReactNode }) {
  const space = spaceOfItem(groups, item);
  const lang = useKitLang();
  return (
    <nav className="sk-bottombar" aria-label={kitT(lang, 'kit.nav.spaces')}>
      {groups.map((g) => {
        const slug = g.items.find((i) => i.icon)?.icon;
        return (
          <button key={g.id} type="button" className="sk-bottombar__btn" aria-label={g.title} aria-current={g.id === space?.id ? 'true' : undefined}
            onClick={() => g.items[0] && onGo(g.items[0].id)}>
            {slug && icon && <span className="sk-bottombar__icon">{icon(slug)}</span>}
            <span className="sk-bottombar__label">{g.title}</span>
          </button>);
      })}
    </nav>
  );
}
