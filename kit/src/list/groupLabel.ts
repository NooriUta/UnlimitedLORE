// Подписи общей группировки (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-06): одна функция
// для групп списка, дорожек доски и дорожек таймлайна — иначе «без связи» в
// списке и на таймлайне разъедутся по формулировке.
import type { KitConfig } from '../core/contract';
import { kitPlural, kitT } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { parseGroupKey } from './grouping';
import type { ListGroup } from './listModel';

const BUILTIN_KEY_TITLES: Record<string, KitKey> = {
  title: 'kit.list.col.title',
  id: 'kit.list.col.id',
  status: 'kit.list.col.status',
  kind: 'kit.list.col.kind',
  updated_at: 'kit.list.col.updated',
};

/** Подпись ключа: встроенное поле, поле вида из конфига или пресет разреза. */
export function groupKeyTitle(config: KitConfig, lang: KitLang, key: string): string {
  const spec = parseGroupKey(key);
  if (spec.type === 'rel') {
    const edge = config.edges?.[spec.edge]?.label ?? spec.edge;
    return spec.dir === 'in' ? kitT(lang, 'kit.list.relIn', { edge }) : edge;
  }
  const builtin = BUILTIN_KEY_TITLES[key];
  if (builtin) return kitT(lang, builtin);
  const bare = key.startsWith('fields.') ? key.slice(7) : key;
  for (const k of Object.values(config.kinds)) {
    const f = (k.fields ?? []).find(x => x.key === bare || x.key === key);
    if (f) return f.title;
  }
  return bare;
}

/** Подпись значения поля (статус — из словаря, вне словаря — честно помечен). */
export function fieldValueTitle(config: KitConfig, lang: KitLang, key: string, v: string): string {
  if (key === 'status') {
    const s = config.statuses.items.find(x => x.code === v);
    return s ? s.title : kitT(lang, 'kit.list.unknownStatus', { code: v || '∅' });
  }
  if (v === '') return kitT(lang, 'kit.list.noValue');
  if (key === 'kind') return config.kinds[v]?.title ?? v;
  return v;
}

/** Подпись группы/дорожки по общему ключу. */
export function groupTitle(config: KitConfig, lang: KitLang, key: string | null, g: ListGroup): string {
  // «Прочие» называют ОБА числа: сколько групп спрятано и сколько в них строк
  // (S9-02). Одно число групп читается как «мелочь», а при 142 релизах в
  // «Прочих» лежит 396 строк из 426 — почти вся выдача. Число строк берётся из
  // самой группы, поэтому для разреза по связи оно уже без дублей.
  if (g.other) {
    return kitT(lang, 'kit.list.others', {
      groups: kitPlural(lang, 'kit.list.groupsN', g.groupCount ?? 0),
      rows: kitPlural(lang, 'kit.list.rowsN', g.records.length),
    });
  }
  const spec = parseGroupKey(key);
  if (spec.type === 'none') return '';
  if (spec.type === 'rel') {
    if (g.none) return kitT(lang, 'kit.list.noLink', { edge: groupKeyTitle(config, lang, key!) });
    if (g.missing) return kitT(lang, 'kit.list.linkMissing', { id: g.key });
    return g.title ?? g.key;
  }
  return fieldValueTitle(config, lang, spec.key, g.key);
}
