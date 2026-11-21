// Допуск пишущих сценариев стенда (model118 M5): запись — только в копию с заглушкой входа.
// Стенд и прод вход держат включённым всегда, поэтому «вход выключен» — второй, независимый от адреса признак копии.
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
