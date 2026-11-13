// MD-WINDOW §3a в LORE (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, D-2026-LORE-MD-REF-PASTE-CHECK,
// spec:SPEC-LORE-MD-INLINE-REF §3a). Kit оборачивает голые ID при вставке и красит ссылки; что
// считать ID LORE и как узнать, есть ли запись, знает приложение (K-14).
//
// Формы — только заглавные коды с цифрами/дефисами (как splitLoreRefs в miniLORE): обычные слова
// («ADR без номера», «UTF-8») не оборачиваются. Задача спринта (SPRINT_X/CODE) стоит РАНЬШЕ
// спринта — иначе SPRINT_X съел бы начало кода задачи.
//
// Существование — тем же фасадом записи, что паспорт (GET /lore/record/{тип}/{id}), только по
// статусу: 200 — есть, 404 — нет, 403 — есть (записи не показывают, но она существует),
// остальное — «не смогли проверить» (null, ссылку не красим: отказ проверки — не «записи нет»).
import type { BareRefForm, MdRef } from '@seidr/kit/content';
import { loreFetch } from '../auth/session';
import { typeByForm } from './loreRefForms';

export const LORE_ID_FORMS: readonly BareRefForm[] = [
  { type: 'adr', re: /ADR-[A-Z0-9]+(?:-[A-Z0-9]+)*/ },
  { type: 'spec', re: /SPEC-[A-Z0-9]+(?:-[A-Z0-9]+)*/ },
  { type: 'decision', re: /D-\d{4}-[A-Z0-9]+(?:-[A-Z0-9]+)*/ },
  { type: 'task', re: /SPRINT_[A-Z0-9_]+\/[A-Z0-9]+(?:-[A-Z0-9]+)*/ },
  { type: 'sprint', re: /SPRINT_[A-Z0-9]+(?:_[A-Z0-9]+)+/ },
];

/** Сколько ссылок проверять за раз — текст со стой ссылок не должен ронять сервер. */
const MAX_CHECK = 40;

export async function loreRefsExist(refs: readonly MdRef[], fetchImpl?: typeof fetch): Promise<Record<string, boolean | null>> {
  const http = (fetchImpl ?? loreFetch) as (u: string) => Promise<Response>;
  const out: Record<string, boolean | null> = {};
  await Promise.all(refs.slice(0, MAX_CHECK).map(async r => {
    const type = r.type ?? typeByForm(r.id);
    if (!type) { out[r.id] = null; return; }
    try {
      const res = await http(`/lore/record/${type}/${r.id.split('/').map(encodeURIComponent).join('/')}`);
      out[r.id] = res.ok || res.status === 403 ? true : res.status === 404 ? false : null;
    } catch {
      out[r.id] = null;
    }
  }));
  return out;
}
