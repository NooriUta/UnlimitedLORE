// Флаг «новая навигация»: переход между LORE v1 и v2 (SPRINT_UXR_S3_V2_INFRA/S3-07).
//
// v1 открыт на lore.odal…, v2 — на new.lore.odal… (тот же адрес с поддоменом
// new.). Выбор хранится в общей cookie платформы seer-prefs, поле nav: это
// единственное хранилище, которое видят обе версии (S3-08) — её Domain общий
// родитель (.odal.seidrstudio.pro), поэтому флаг, поставленный в одной версии,
// читается в другой.
import { readSharedPrefs, writeSharedPrefs, type CookieJar } from '../storage/storage';

export type NavVersion = 'v1' | 'v2';

const V2_SUBDOMAIN = 'new.';

function isBareHost(h: string): boolean {
  return !h || h === 'localhost' || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Хост указанной версии для текущего хоста. null — пары нет (localhost, голый
 * IP): у таких адресов нет поддомена new., и выдумывать его значит увести
 * пользователя в никуда.
 */
export function counterpartHost(hostname: string, target: NavVersion): string | null {
  if (isBareHost(hostname)) return null;
  const isV2 = hostname.startsWith(V2_SUBDOMAIN);
  if (target === 'v2') return isV2 ? hostname : V2_SUBDOMAIN + hostname;
  return isV2 ? hostname.slice(V2_SUBDOMAIN.length) : hostname;
}

export interface LocationLike { protocol: string; hostname: string; port: string }

/** Корень указанной версии с тем же протоколом и портом; null — пары нет. */
export function switchNavUrl(loc: LocationLike, target: NavVersion): string | null {
  const host = counterpartHost(loc.hostname, target);
  if (!host) return null;
  return `${loc.protocol}//${host}${loc.port ? ':' + loc.port : ''}/`;
}

/** Выбор пользователя из seer-prefs; null — не выбирал (или значение не наше). */
export function readNavFlag(jar?: CookieJar): NavVersion | null {
  const v = readSharedPrefs(jar).nav;
  return v === 'v1' || v === 'v2' ? v : null;
}

export interface SwitchDeps { jar?: CookieJar; location?: LocationLike }

/**
 * Запоминает выбор в seer-prefs и возвращает адрес перехода (null — перейти
 * некуда, флаг при этом всё равно сохранён). Навигацию делает вызывающий.
 */
export function switchNav(target: NavVersion, deps: SwitchDeps = {}): string | null {
  const loc = deps.location ?? (typeof location === 'undefined'
    ? { protocol: 'https:', hostname: '', port: '' }
    : location);
  writeSharedPrefs({ nav: target }, deps.jar, loc.hostname);
  return switchNavUrl(loc, target);
}
