// Данные раздела «Оформление» админки v2 ([[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]], прототип
// docs/prototypes/admin-appearance.html; решения владельца 25.11.2026):
//   1а — свой стиль хранится в базе: статья справочника palette с кодом own-… и полем tokens_json;
//   2в — умолчание и разрешённый набор палитр и пар шрифтов — на установку (app_setting appearance.*);
//   3б — на входе JSON или CSS-переменные, проверяет СЕРВЕР (POST /lore/dict/style-check) тем же правилом, что запись;
//   4а — своих шрифтов нет: пары бандла.
// Наши палитры и пары — из kit (бандл), обязательные: удалить и выключить их нельзя.
// Чтение — тот же срез dictionary, что у «Словарей»; запись — тот же POST /lore/dict/entry.
import { PALETTES, type OwnStyleTokens } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';
import { saveDictEntry, type DictRow } from './dicts';
import { saveSetting } from './appSettings';

export const BUILTIN_PALETTES: readonly string[] = PALETTES.map(p => p.id as string);
export const FONT_PAIRS: readonly ('pair' | 'mono')[] = ['pair', 'mono'];

export const K_PALETTE_DEFAULT = 'appearance.palette_default';
export const K_PALETTES_ALLOWED = 'appearance.palettes_allowed';
export const K_FONT_DEFAULT = 'appearance.font_default';
export const K_FONTS_ALLOWED = 'appearance.fonts_allowed';

export interface OwnStyle {
  code: string;
  name: string;
  active: boolean;
  /** Пусто — токены битые или их нет: стиль не рисуется, админка говорит об этом. */
  tokens: OwnStyleTokens;
  broken: boolean;
}

function parseTokens(raw: string | undefined): OwnStyleTokens | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { root?: Record<string, string>; light?: Record<string, string> };
    if (!j || typeof j !== 'object' || !j.root || typeof j.root !== 'object') return null;
    return j.light && Object.keys(j.light).length ? { root: j.root, light: j.light } : { root: j.root };
  } catch { return null; }
}

/** Свои стили установки — статьи palette с кодом own-…, по sort_order. */
export function ownStylesOf(rows: readonly DictRow[]): OwnStyle[] {
  return rows
    .filter(r => r.dict_type === 'palette' && r.code.startsWith('own-'))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code))
    .map(r => {
      const t = parseTokens(r.tokens_json);
      return { code: r.code, name: r.label_ru || r.code, active: r.is_active, tokens: t ?? { root: {} }, broken: !t };
    });
}

/** Подпись нашей палитры: статья справочника (5а — сеется на установку), иначе подпись kit. */
export function builtinLabel(rows: readonly DictRow[], code: string): string {
  const r = rows.find(x => x.dict_type === 'palette' && x.code === code);
  return r?.label_ru || PALETTES.find(p => p.id === code)?.label || code;
}

export interface InstallAppearance {
  paletteDefault: string;
  palettesAllowed: string[];
  fontDefault: 'pair' | 'mono';
  fontsAllowed: ('pair' | 'mono')[];
}

const csv = (v: string | null | undefined): string[] =>
  (v ?? '').split(',').map(s => s.trim()).filter((s, i, a) => s && a.indexOf(s) === i);

/**
 * Набор установки из app_setting — то же правило, что у сервера (LoreAppearance.install): не задан — разрешено всё;
 * умолчание вне набора — первое из кода, если оно в наборе, иначе первое набора.
 */
export function installOf(rows: readonly DictRow[], own: readonly OwnStyle[]): InstallAppearance {
  const val = (k: string) => rows.find(r => r.dict_type === 'app_setting' && r.code === k && r.is_active)?.label_ru ?? null;
  const palettes = [...BUILTIN_PALETTES, ...own.filter(o => o.active && !o.broken).map(o => o.code)];
  const pick = <T extends string>(known: readonly T[], set: string[]): T[] => {
    const out = known.filter(k => set.includes(k));
    return set.length && out.length ? out : [...known];
  };
  const pAllowed = pick(palettes, csv(val(K_PALETTES_ALLOWED)));
  const fAllowed = pick(FONT_PAIRS, csv(val(K_FONTS_ALLOWED)));
  const def = <T extends string>(v: string | null, code: T, allowed: T[]): T =>
    v && (allowed as string[]).includes(v.trim()) ? (v.trim() as T) : allowed.includes(code) ? code : allowed[0];
  return {
    paletteDefault: def(val(K_PALETTE_DEFAULT), BUILTIN_PALETTES[0], pAllowed),
    palettesAllowed: pAllowed,
    fontDefault: def(val(K_FONT_DEFAULT), 'pair' as const, fAllowed),
    fontsAllowed: fAllowed,
  };
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Код своего стиля из названия: own- и латиница; занятый — с номером. */
export function ownCode(name: string, taken: readonly string[]): string {
  const slug = [...name.toLowerCase()].map(c => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'style';
  const base = `own-${slug}`;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

export interface StyleCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  tokens: OwnStyleTokens;
}

/** Проверка исходника сервером (ничего не пишет). Отказ — словами в errors, а не исключением. */
export async function checkStyle(source: string, fetchImpl: typeof fetch = loreFetch): Promise<StyleCheck> {
  const res = await fetchImpl('/lore/dict/style-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ source }),
  });
  let b: Record<string, unknown> | null = null;
  try { b = (await res.json()) as Record<string, unknown>; } catch { b = null; }
  if (!res.ok || !b) throw new LoreHttpError(res.status, String(b?.error ?? 'NON_JSON'), String(b?.detail ?? ''));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const t = (b.tokens ?? {}) as { root?: Record<string, string>; light?: Record<string, string> };
  return { ok: b.ok === true, errors: list(b.errors), warnings: list(b.warnings), tokens: { root: t.root ?? {}, ...(t.light ? { light: t.light } : {}) } };
}

/** Новый свой стиль: статья palette own-…, исходник уходит как есть — сервер проверит и сохранит JSON. */
export function addOwnStyle(code: string, name: string, source: string, sortOrder: number, fetchImpl?: typeof fetch) {
  return saveDictEntry({
    dict_type: 'palette', code, label_ru: name.trim(), tokens_json: source, sort_order: sortOrder, is_active: true,
  }, fetchImpl);
}

/** Включить или выключить свой стиль (выключенный скрыт из выбора). Наши палитры так не выключаются — сервер откажет. */
export function setOwnActive(code: string, active: boolean, fetchImpl?: typeof fetch) {
  return saveDictEntry({ dict_type: 'palette', code, is_active: active }, fetchImpl);
}

/** Набор установки — четыре ключа app_setting. */
export async function saveInstall(v: InstallAppearance, fetchImpl?: typeof fetch): Promise<void> {
  await saveSetting(K_PALETTE_DEFAULT, v.paletteDefault, fetchImpl);
  await saveSetting(K_PALETTES_ALLOWED, v.palettesAllowed.join(','), fetchImpl);
  await saveSetting(K_FONT_DEFAULT, v.fontDefault, fetchImpl);
  await saveSetting(K_FONTS_ALLOWED, v.fontsAllowed.join(','), fetchImpl);
}
