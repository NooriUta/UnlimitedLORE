// Допуск пишущих сценариев стенда.
//
// 1) Копия (model118 M5, MA4): запись в копию с заглушкой входа. Стенд и прод вход держат включённым всегда,
//    поэтому «вход выключен» — второй, независимый от адреса признак копии.
// 2) Препрод тестовыми учётками (владелица 21.11.2026: «у нас же есть тестовые пользователи, пусть заводят
//    тестовые проекты»): запись ТОЛЬКО на хосте препрода, ТОЛЬКО из сценария с меткой @writes и ТОЛЬКО сущностей
//    с кодом на TEST (TEST-proj-a, TEST-org-…). Прод и всё остальное — отказ, как прежде.
import { isForbiddenStandUrl } from '../../src/standSmoke/summary.ts';

/** Ответ /lore/whoami, нужная часть. null — узнать не смогли. */
export interface WhoamiAuth { auth_enabled?: unknown }

/** Причина отказа писать по этому адресу; null — это копия, писать можно. */
export function writeCopyRefusal(url: string | undefined, whoami: WhoamiAuth | null): string | null {
  let u: URL;
  try { u = new URL(url ?? ''); } catch { return `адрес «${url ?? ''}» не разобран — запись не выполняется`; }
  if (isForbiddenStandUrl(u.href)) return 'адрес прода — запись запрещена';
  const host = u.hostname.toLowerCase();
  if (host === '192.168.3.131') return 'ci-server (стенд и препрод) — запись запрещена';
  if (host === 'seidrstudio.pro' || host.endsWith('.seidrstudio.pro')) return `${host}: адрес *.seidrstudio.pro (стенд или прод) — запись запрещена`;
  if (whoami?.auth_enabled !== false) return 'вход на этом адресе включён или не узнан — пишем только в копию с заглушкой входа';
  return null;
}

/** Единственный адрес, где тестовые учётки пишут TEST-данные. */
export const PREPROD_HOST = 'preprod.lore.odal.seidrstudio.pro';
/** Метка пишущего сценария: `test('…', { tag: WRITES_TAG }, …)`. */
export const WRITES_TAG = '@writes';
/** Код тестовой сущности: TEST-… или TEST_… (регистр TEST — любой). */
export const TEST_ID_RE = /^test[-_][a-z0-9][a-z0-9._-]*$/i;

export interface PreprodWrite {
  /** Сценарий помечен WRITES_TAG. */
  writer: boolean;
  /** Коды/ключи всех сущностей, которые сценарий заведёт или изменит. */
  ids: readonly string[];
}

/** Причина отказа записи TEST-данных на препроде; null — можно. */
export function preprodTestWriteRefusal(url: string | undefined, w: PreprodWrite): string | null {
  let u: URL;
  try { u = new URL(url ?? ''); } catch { return `адрес «${url ?? ''}» не разобран — запись не выполняется`; }
  if (isForbiddenStandUrl(u.href)) return 'адрес прода — запись запрещена';
  const host = u.hostname.toLowerCase();
  if (host !== PREPROD_HOST) return `${host}: запись тестовыми учётками — только на ${PREPROD_HOST}`;
  if (u.protocol !== 'https:') return 'препрод — только https';
  if (!w.writer) return `сценарий не помечен ${WRITES_TAG} — на препроде он только читает`;
  if (!w.ids.length) return 'не названы сущности записи — пишем только названные TEST-сущности';
  const bad = w.ids.filter(id => !TEST_ID_RE.test(id));
  if (bad.length) return `не тестовые коды: ${bad.join(', ')} — на препроде пишем только TEST-…`;
  return null;
}
