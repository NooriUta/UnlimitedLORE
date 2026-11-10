// SPRINT_UXR_S3_V2_INFRA/S3-07: переключатель «новая навигация» — сторона v1.
//
// v2 открыт на том же адресе с поддоменом new. (web-next/src/nav/navVersion.ts —
// там же обратный переход). Выбор хранится в общей cookie платформы seer-prefs,
// поле nav: её Domain — общий родитель обоих хостов, поэтому флаг, поставленный
// здесь, читается в v2 (и наоборот).
import { writePrefs } from './prefs';

export interface LocationLike { protocol: string; hostname: string; port: string }

const V2_SUBDOMAIN = 'new.';

function isBareHost(h: string): boolean {
  return !h || h === 'localhost' || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}

/** Корень v2 для текущего адреса; null — пары нет (localhost, голый IP). */
export function v2Url(loc: LocationLike): string | null {
  const h = loc.hostname;
  if (isBareHost(h)) return null;
  const host = h.startsWith(V2_SUBDOMAIN) ? h : V2_SUBDOMAIN + h;
  return `${loc.protocol}//${host}${loc.port ? ':' + loc.port : ''}/`;
}

/**
 * Запоминает nav=v2 и возвращает адрес перехода. Пары нет — ничего не пишет и
 * возвращает null: флаг без перехода оставил бы пользователя в v1 с «включённой»
 * новой навигацией. Навигацию делает вызывающий.
 */
export function switchToV2(
  loc: LocationLike,
  write: (patch: { nav: string }) => void = writePrefs,
): string | null {
  const url = v2Url(loc);
  if (!url) return null;
  write({ nav: 'v2' });
  return url;
}
