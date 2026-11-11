// Параметры приложения (app_setting) во «Флагах» админки v2
// (SPRINT_UXR_S7B_ADMIN/S7B-31 п.4, решение 4а). Перенесено из старой вкладки
// v1 «Настройки» (AL-38 — реестр известных ключей, chart-слой — решение
// владелицы 06.11.2026, проверка интеграции Völva).
//
// Ключи живут в справочнике dict_type=app_setting: значение — label_ru.
// Запись — тот же POST /lore/dict/entry, что у v1 и у «Словарей» (partial-safe).
// Реестр известных ключей пополняется ТОЛЬКО вместе с чтением ключа в коде:
// всё прочее в app_setting — «неопознанное» (его никто не читает).
import { fetchSlice, LoreHttpError } from '../api/loreSlice';
import { loreFetch } from '../auth/session';
import type { AppKey } from '../i18n';
import { parseDictRows, saveDictEntry, type DictRow } from './dicts';

export type SettingKind = 'url' | 'choice' | 'projects' | 'bool' | 'number';

export interface KnownSetting {
  key: string;
  kind: SettingKind;
  /** Для kind=choice — допустимые значения, первое — умолчание. */
  choices?: readonly string[];
  placeholder: string;
  /** Подписи — ключами локалей (литералами: их видит сторож i18n). */
  type: AppKey;
  def: AppKey;
  descr: AppKey;
  hint: AppKey;
}

export const KNOWN_SETTINGS: readonly KnownSetting[] = [
  // Адрес Völva для ссылок «решение ↔ документ» (DS-LINK-1, DS-LINK-2).
  {
    key: 'volva.url', kind: 'url', placeholder: 'https://volva.odal.seidrstudio.pro',
    type: 'admin.set.type.url', def: 'admin.set.def.volvaUrl', descr: 'admin.set.descr.volvaUrl', hint: 'admin.set.hint.volvaUrl',
  },
  // Слой графиков: свои графики на ECharts или встроенные графики Völva.
  {
    key: 'charts.layer', kind: 'choice', choices: ['echarts', 'volva'], placeholder: 'echarts',
    type: 'admin.set.type.chartLayer', def: 'admin.set.def.chartLayer', descr: 'admin.set.descr.chartLayer', hint: 'admin.set.hint.chartLayer',
  },
  // QG-09: какие репозитории опрашивает канал прогонов Forgejo Actions.
  {
    key: 'qg.actions_projects', kind: 'projects', placeholder: 'NooriUta/UnlimitedLORE,NooriUta/AIDA',
    type: 'admin.set.type.projects', def: 'admin.set.def.qgProjects', descr: 'admin.set.descr.qgProjects', hint: 'admin.set.hint.qgProjects',
  },
  // Картинки в MD-полях (LoreAssetResource) — читается при каждой загрузке.
  {
    key: 'md_images_enabled', kind: 'bool', placeholder: 'true',
    type: 'admin.set.type.bool', def: 'admin.set.def.true', descr: 'admin.set.descr.mdImages', hint: 'admin.set.hint.mdImages',
  },
  {
    key: 'md_image_max_mb', kind: 'number', placeholder: '5',
    type: 'admin.set.type.mb', def: 'admin.set.def.five', descr: 'admin.set.descr.mdImageMax', hint: 'admin.set.hint.mdImages',
  },
];

export interface KnownValue { def: KnownSetting; value: string | null }

/** Известные ключи (всегда, даже без записи) и неопознанные активные записи. */
export function splitSettings(rows: readonly DictRow[]): { known: KnownValue[]; unknown: DictRow[] } {
  const active = rows.filter(r => r.dict_type === 'app_setting' && r.is_active);
  return {
    known: KNOWN_SETTINGS.map(def => {
      const r = active.find(a => a.code === def.key);
      return { def, value: r && r.label_ru && r.label_ru.trim() !== '' ? r.label_ru : null };
    }),
    unknown: active.filter(a => !KNOWN_SETTINGS.some(k => k.key === a.code)),
  };
}

export type SettingError = 'url' | 'choice' | 'bool' | 'number';

/** Проверка значения до записи. Пусто — законно: значение снимается, действует умолчание. */
export function settingError(key: string, raw: string): SettingError | null {
  const v = raw.trim();
  const def = KNOWN_SETTINGS.find(k => k.key === key);
  if (!def || v === '') return null;
  switch (def.kind) {
    case 'url':
      return /^https?:\/\/\S+$/i.test(v) ? null : 'url';
    case 'choice':
      return def.choices!.includes(v) ? null : 'choice';
    case 'bool':
      return v === 'true' || v === 'false' ? null : 'bool';
    case 'number':
      return Number.isFinite(Number(v)) && Number(v) > 0 ? null : 'number';
    default:
      return null;
  }
}

export async function fetchAppSettings(signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<DictRow[]> {
  const b = await fetchSlice<unknown>('dictionary', { dict_type: 'app_setting' }, { signal, fetchImpl });
  return parseDictRows(b.rows);
}

/** Значение известного ключа. Прочие поля null — /dict/entry их не трогает. */
export function saveSetting(code: string, value: string, fetchImpl?: typeof fetch) {
  return saveDictEntry({
    dict_type: 'app_setting', code, label_ru: value.trim(), is_active: true,
    label_en: null, color: null, icon: null, sort_order: null, is_extensible: null,
  }, fetchImpl);
}

/** Неопознанный ключ — soft-delete (is_active=false), как в v1. */
export function removeSetting(code: string, fetchImpl?: typeof fetch) {
  return saveDictEntry({
    dict_type: 'app_setting', code, is_active: false,
    label_ru: null, label_en: null, color: null, icon: null, sort_order: null, is_extensible: null,
  }, fetchImpl);
}

export type VolvaVerdict =
  | { kind: 'ok'; origin: string; expires: string }
  | { kind: 'not_configured' | 'unknown_chart' | 'forbidden' | 'error'; detail: string };

/** Исход проверки Völva — по коду ответа: не настроено ≠ нет графика ≠ нет доступа ≠ сбой. */
export function volvaVerdict(e: unknown): VolvaVerdict {
  if (e instanceof LoreHttpError) {
    const detail = e.detail || e.code || `HTTP ${e.status}`;
    if (e.status === 503) return { kind: 'not_configured', detail };
    if (e.status === 404) return { kind: 'unknown_chart', detail };
    if (e.status === 401 || e.status === 403) return { kind: 'forbidden', detail };
  }
  return { kind: 'error', detail: e instanceof Error ? e.message : String(e) };
}

/**
 * Запросить подписанный адрес пилотного графика velocity — тот же путь, что у
 * слоя Völva. Адрес целиком не возвращаем: в нём JWT; только origin и срок.
 */
export async function checkVolva(fetchImpl: typeof fetch = loreFetch): Promise<VolvaVerdict> {
  try {
    const res = await fetchImpl('/lore/embed/volva/velocity', { headers: { Accept: 'application/json' } });
    let b: Record<string, unknown> | null = null;
    try { b = (await res.json()) as Record<string, unknown>; } catch { b = null; }
    if (!res.ok || !b) throw new LoreHttpError(res.status, String(b?.error ?? (b ? '' : 'NON_JSON')), String(b?.detail ?? ''));
    const url = typeof b.url === 'string' ? b.url : '';
    let origin = '';
    try { origin = new URL(url).origin; } catch { throw new Error('malformed answer: url'); }
    return { kind: 'ok', origin, expires: typeof b.expires_at === 'string' ? b.expires_at : '' };
  } catch (e) {
    return volvaVerdict(e);
  }
}
