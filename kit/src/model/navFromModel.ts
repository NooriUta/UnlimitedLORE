// Меню из документа модели (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS).
//
// Раздел `surfaces.nav` описывает общее меню: группы с подписью и тоном, в них пункты-разделы со
// значком. Раньше документ превращали в меню сами приложения (LORE v2 — `v2Config.menuFromModel`,
// пилот «Дата-странники» — свой разбор), то есть одно знание жило в двух местах.
//
// ПРЕДМЕТНОГО ЗДЕСЬ НЕТ (то же правило, что у configFromModel; держится тестом-грепом). Что за
// разделы бывают и как их подписать, знает приложение: оно даёт словарь `t` (ключ локализации →
// подпись), `sectionTitle` (раздел → подпись по умолчанию) и `knows` (у какого раздела есть экран).
//
// ЧЕСТНЫЕ СОСТОЯНИЯ: нет раздела — `decided: false`, а не пустое меню как решение; пропуск
// элемента, незнакомый раздел, подпись кодом — каждое строкой в `notes`.
import type { KitConfig } from '../core/contract';

type MenuGroup = KitConfig['menu']['groups'][number];
type MenuItem = MenuGroup['items'][number];

export interface NavFromModelOptions {
  /** Ключ локализации → подпись; `undefined` — подписи у приложения нет. */
  t?: (key: string) => string | undefined;
  /** Подпись пункта, если документ её не дал: раздел → подпись (словарь приложения). */
  sectionTitle?: (section: string) => string | undefined;
  /** Есть ли у приложения экран раздела. Нет функции — все разделы известны. */
  knows?: (section: string) => boolean;
}

export interface NavFromModel {
  /** Документ описал меню. `false` — приложение держит своё и говорит, что это умолчание. */
  decided: boolean;
  groups: MenuGroup[];
  notes: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function navFromModel(model: unknown, opts: NavFromModelOptions = {}): NavFromModel {
  const notes: string[] = [];
  const surfaces = isObj(model) && isObj(model.surfaces) ? model.surfaces : null;
  const nav = surfaces && Array.isArray(surfaces.nav) ? surfaces.nav : null;
  if (!nav) {
    notes.push('в документе нет surfaces.nav — меню остаётся умолчанием приложения');
    return { decided: false, groups: [], notes };
  }
  const label = (raw: Record<string, unknown>, fallback: () => string | undefined): string | undefined => {
    const own = str(raw.label);
    if (own) return own;
    const key = str(raw.label_key);
    return (key && opts.t?.(key)) || fallback();
  };
  const groups: MenuGroup[] = [];
  nav.forEach((g, gi) => {
    if (!isObj(g)) { notes.push(`элемент меню №${gi + 1} не того вида — пропущен`); return; }
    const id = str(g.id);
    if (!id) { notes.push(`у группы меню №${gi + 1} нет id — пропущена`); return; }
    const items: MenuItem[] = [];
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!isObj(it)) { notes.push(`в группе «${id}» есть пункт не того вида — пропущен`); continue; }
      const section = str(it.section);
      if (!section) { notes.push(`в группе «${id}» есть пункт без раздела — пропущен`); continue; }
      if (opts.knows && !opts.knows(section)) { notes.push(`раздел «${section}» есть в модели, но у приложения нет его экрана — пункт не показан`); continue; }
      const title = label(it, () => opts.sectionTitle?.(section));
      if (!title) notes.push(`у пункта «${section}» нет подписи — показан кодом`);
      const icon = str(it.icon);
      const view = str(it.view);
      items.push({ id: section, title: title || section, ...(icon ? { icon } : {}), ...(view ? { view } : {}) });
    }
    if (items.length === 0) return;
    const title = label(g, () => undefined);
    if (!title) notes.push(`у группы «${id}» нет подписи — показана кодом`);
    const tone = str(g.tone);
    groups.push({ id, title: title || id, ...(tone ? { tone } : {}), ...(g.pin_top === true ? { pinTop: true } : {}), items });
  });
  return { decided: true, groups, notes };
}
