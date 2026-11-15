// Аватары людей (AP-07 «аватары доделать», владелица 15.11.2026, SPRINT_LORE_ADMIN_POLISH/AP-07).
//
// Корень дефекта, ради которого это место есть: GET /lore/users/{sub}/avatar, как и весь /lore,
// требует входа (без токена — 401, проверено на препроде 1f09ded3). <img src> браузер шлёт без
// заголовка Authorization, поэтому картинка по голому адресу не показывалась НИКОГДА. Картинку
// берём тем же запросом с токеном (loreFetch) и показываем из blob: — одна точка на всё приложение.
//
// Кэш на вкладку: профиль и картинка запрашиваются один раз на человека, а не на каждую строку ленты.
// Отказ — честный null (клиент рисует инициалы), а не исключение в рендере.
import { createContext, useContext, useEffect, useState } from 'react';
import { loreFetch } from '../auth/session';

export interface PersonProfile {
  kc_sub: string | null;
  login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  found: boolean;
}

/** Загрузчик профилей и картинок для экранов, которым его не передают явно (лента, списки). Тесты подменяют. */
export const PeopleFetchCtx = createContext<typeof fetch>(loreFetch);

const profiles = new Map<string, Promise<PersonProfile | null>>();
const blobs = new Map<string, Promise<string | null>>();

/** Сбросить кэш человека (после смены имени или аватара). */
export function forgetPerson(sub: string): void {
  const p = profiles.get(sub);
  profiles.delete(sub);
  void p?.then(row => { if (row?.avatar_url) blobs.delete(row.avatar_url); });
}

/** Только для тестов: пустой кэш. */
export function resetPeopleCache(): void { profiles.clear(); blobs.clear(); queues.clear(); }

// Запросы одного такта собираются в ОДИН вызов ?ids=a,b,c (список людей — 50 строк, а не 50 запросов).
const queues = new Map<typeof fetch, Map<string, (row: PersonProfile | null) => void>>();

function flush(fetchImpl: typeof fetch): void {
  const q = queues.get(fetchImpl);
  queues.delete(fetchImpl);
  if (!q || q.size === 0) return;
  const subs = [...q.keys()];
  fetchImpl(`/lore/users?ids=${subs.map(encodeURIComponent).join(',')}`)
    .then(async r => {
      const rows = r.ok ? await r.json() as PersonProfile[] : [];
      const by = new Map((Array.isArray(rows) ? rows : []).filter(x => x.found && x.kc_sub).map(x => [x.kc_sub as string, x]));
      for (const [sub, done] of q) done(by.get(sub) ?? null);
    })
    .catch(() => { for (const done of q.values()) done(null); });
}

export function loadPerson(sub: string, fetchImpl: typeof fetch = loreFetch): Promise<PersonProfile | null> {
  let p = profiles.get(sub);
  if (!p) {
    p = new Promise<PersonProfile | null>(resolve => {
      let q = queues.get(fetchImpl);
      if (!q) { q = new Map(); queues.set(fetchImpl, q); queueMicrotask(() => flush(fetchImpl)); }
      q.set(sub, resolve);
    });
    // Отказ не кэшируем навсегда: следующий показ спросит снова.
    void p.then(row => { if (row === null) profiles.delete(sub); });
    profiles.set(sub, p);
  }
  return p;
}

/** Картинка по относительному avatar_url — запросом с токеном, в blob:. Нет или отказ — null. */
export function loadAvatar(avatarUrl: string, fetchImpl: typeof fetch = loreFetch): Promise<string | null> {
  let p = blobs.get(avatarUrl);
  if (!p) {
    p = fetchImpl(avatarUrl)
      .then(async r => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    void p.then(src => { if (src === null) blobs.delete(avatarUrl); });
    blobs.set(avatarUrl, p);
  }
  return p;
}

/** Профиль и готовая картинка человека; sub нет — ничего не запрашивается. */
export function usePerson(sub: string | null | undefined, fetchArg?: typeof fetch, bust = 0): { row: PersonProfile | null; src: string | null } {
  const ctxFetch = useContext(PeopleFetchCtx);
  const fetchImpl = fetchArg ?? ctxFetch;
  const [state, setState] = useState<{ row: PersonProfile | null; src: string | null }>({ row: null, src: null });
  useEffect(() => {
    if (!sub) { setState({ row: null, src: null }); return; }
    let live = true;
    void loadPerson(sub, fetchImpl).then(async row => {
      if (!live) return;
      setState({ row, src: null });
      if (!row?.avatar_url) return;
      const src = await loadAvatar(row.avatar_url, fetchImpl);
      if (live) setState({ row, src });
    });
    return () => { live = false; };
  }, [sub, fetchImpl, bust]);
  return state;
}

/** Картинка по известному avatar_url (профиль уже на руках). */
export function useAvatarSrc(avatarUrl: string | null | undefined, fetchImpl: typeof fetch = loreFetch, bust = 0): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!avatarUrl) return;
    let live = true;
    if (bust) blobs.delete(avatarUrl);
    void loadAvatar(avatarUrl, fetchImpl).then(s => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [avatarUrl, fetchImpl, bust]);
  return src;
}
