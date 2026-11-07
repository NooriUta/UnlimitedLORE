// Состояние в URL с фолбэком на «#» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f).
// history.pushState бросает в песочнице iframe, на file:// и при лимите
// частоты вызовов. Тогда параметры пишутся в location.hash
// («#section=admin&tab=rules»), а чтение сливает query и hash — hash
// побеждает, потому что после фолбэка он свежее.

export interface UrlWindow {
  location: { pathname: string; search: string; hash: string };
  history: Pick<History, 'pushState' | 'replaceState'>;
}

/** Hash похож на набор параметров, только если в нём есть «=» (#top — якорь). */
function hashParams(hash: string): URLSearchParams | null {
  const raw = hash.replace(/^#\??/, '');
  return raw.includes('=') ? new URLSearchParams(raw) : null;
}

export function readUrlState(win: UrlWindow = window): URLSearchParams {
  const out = new URLSearchParams(win.location.search);
  hashParams(win.location.hash)?.forEach((v, k) => out.set(k, v));
  return out;
}

export function pushUrlState(
  patch: Record<string, string | null | undefined>,
  opts: { replace?: boolean; win?: UrlWindow } = {},
): 'history' | 'hash' {
  const win = opts.win ?? window;
  const params = readUrlState(win);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) params.delete(k);
    else params.set(k, v);
  }
  const query = params.toString();
  // Якорь (#top) сохраняем; параметры из hash уже слиты в query.
  const anchor = hashParams(win.location.hash) ? '' : win.location.hash;
  const url = `${win.location.pathname}${query ? `?${query}` : ''}${anchor}`;
  try {
    if (opts.replace) win.history.replaceState(null, '', url);
    else win.history.pushState(null, '', url);
    return 'history';
  } catch {
    win.location.hash = `#${query}`;
    return 'hash';
  }
}
