// Контракт экрана-списка из модели (SPRINT_LORE_MODEL_AS_CONFIG/MC-09).
//
// Сервер отдаёт в `/lore/model` → `surfaces.list.<type>` срез, колонку кода и
// заголовка, путь паспорта и доступ. Откуда брать строки — знание СЕРВЕРА:
// раньше срез каждого раздела жил только в `screens.ts`, а у мобильного клиента
// была своя таблица, и пять типов на телефоне выходили пустым экраном.
//
// Здесь — только разбор контракта и сборка экрана из него. Оформление (иконки,
// колонки, фасеты) остаётся в `screens.ts`: модель говорит «что читать», а не
// «как рисовать».
import type { KitConfig, KitLang, KitRecord } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';

/** Сегмент списка: сервер сам делит записи по статусу разными срезами (задачи: открытые / закрытые / все). */
export interface ListSegment {
  key: string;
  slice: string;
  labelKey?: string;
  default: boolean;
}

export interface ListContract {
  /** Срез; при сегментах — срез сегмента по умолчанию. */
  slice: string;
  /** Есть — фильтр статуса серверный: переключатель сегментов, у каждого свой срез. */
  segments: ListSegment[];
  idKey: string;
  titleKey: string;
  /** Колонка статуса в строке среза; без сегментов — фильтр статуса на клиенте. */
  statusKey?: string;
  recordPath: string;
  /** Версия LORE, с которой срез отдаётся (`<=1.17` — был раньше). 404 UNKNOWN_SLICE на сервере старше — «ещё не отдаётся», не «пусто». */
  since?: string;
  defaultMode?: 'rows' | 'cards';
  groupKeys: string[];
  /** Роль, без которой срез ответит 403 (гейт сервера) — экран говорит об этом, а не показывает «пусто». */
  requiresRole?: string;
  /** Срез режется проектным скоупом: без проектов — 403 SCOPE_EMPTY. */
  projectScoped: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** `surfaces.list.<type>` документа модели; нет раздела или он неполон — null (тогда действует умолчание приложения). */
export function listContractOf(model: unknown, type: string): ListContract | null {
  const surfaces = isObj(model) && isObj(model.surfaces) ? model.surfaces : null;
  const list = surfaces && isObj(surfaces.list) ? surfaces.list : null;
  const raw = list && isObj(list[type]) ? list[type] : null;
  if (!raw || !nonEmpty(raw.slice) || !nonEmpty(raw.id_key) || !nonEmpty(raw.title_key) || !nonEmpty(raw.record_path)) return null;
  const mode = raw.default_mode === 'rows' || raw.default_mode === 'cards' ? raw.default_mode : undefined;
  const segments: ListSegment[] = Array.isArray(raw.segments)
    ? raw.segments.filter(isObj).filter(s => nonEmpty(s.key) && nonEmpty(s.slice)).map(s => ({
      key: s.key as string, slice: s.slice as string,
      ...(nonEmpty(s.label_key) ? { labelKey: s.label_key } : {}),
      default: s.default === true,
    }))
    : [];
  return {
    slice: raw.slice, segments, idKey: raw.id_key, titleKey: raw.title_key, recordPath: raw.record_path,
    ...(nonEmpty(raw.status_key) ? { statusKey: raw.status_key } : {}),
    ...(nonEmpty(raw.since) ? { since: raw.since } : {}),
    ...(mode ? { defaultMode: mode } : {}),
    groupKeys: Array.isArray(raw.group_keys) ? raw.group_keys.filter(nonEmpty) : [],
    ...(nonEmpty(raw.requires_role) ? { requiresRole: raw.requires_role } : {}),
    projectScoped: raw.project_scoped === true,
  };
}

/**
 * Где фильтруется статус: `server` — есть сегменты (у каждого свой срез); `client` — один срез и колонка
 * статуса; `none` — у типа нет статуса.
 */
export function statusFilterOf(c: ListContract): 'server' | 'client' | 'none' {
  if (c.segments.length > 0) return 'server';
  return c.statusKey ? 'client' : 'none';
}

/** Минимум экрана, который можно собрать из одного контракта (форма совместима с ListScreenDef). */
export interface ContractScreen {
  modelType: string;
  slice: string;
  titleKey: AppKey;
  icon: string;
  map: (row: Record<string, unknown>) => KitRecord;
  config: (lang: KitLang) => KitConfig;
  quickIcons: Record<string, string>;
  note?: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v));

/**
 * Экран типа, о котором приложение ничего не знает, — только из контракта модели:
 * код и заголовок строки — колонки `id_key`/`title_key`, разрезы — `group_keys`.
 */
export function contractScreen(type: string, c: ListContract): ContractScreen {
  const fields = c.groupKeys.map(k => ({ key: k, title: k, type: 'text' as const }));
  return {
    modelType: type,
    slice: c.slice,
    titleKey: `shell.sec.${type}` as AppKey,
    icon: 'lucide:list',
    quickIcons: {},
    ...(c.requiresRole ? { note: `раздел читается только с ролью ${c.requiresRole}` } : {}),
    map: row => {
      const id = str(row[c.idKey]);
      return {
        id, kind: type, title: str(row[c.titleKey]) || id, status: '',
        fields: Object.fromEntries(c.groupKeys.map(k => [k, str(row[k])])),
      };
    },
    config: lang => ({
      modules: [], menu: { groups: [] },
      kinds: { [type]: { title: appT(lang, `shell.sec.${type}` as AppKey), icon: 'lucide:list', fields } },
      statuses: { items: [] },
      list: {
        views: c.defaultMode === 'cards' ? ['cards', 'list'] : ['list', 'cards'],
        filters: c.groupKeys.map(k => `fields.${k}`),
        groupings: c.groupKeys.map(k => `fields.${k}`),
        columns: ['title', ...c.groupKeys],
      },
    }),
  };
}
