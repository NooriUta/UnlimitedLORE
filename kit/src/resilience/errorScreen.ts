// window.onerror на экран без React (SPRINT_UXR_S10_SEIDR_KIT/K-06).
// Голый mount (SeidrKit.mount(el, config, data), бандл K-08) живёт в
// single-file HTML: если упал разбор конфига, импорт или сам React до того,
// как поднялась ErrorBoundary, человек видел бы белый лист. Этот экран — та
// же разметка .sk-error, что у ErrorBoundary, но на чистом DOM: текст только
// через textContent (сообщение исключения — не HTML), один узел на контейнер.
import { kitT, type KitLang } from '../i18n';
import { describeError, isBenignError } from './errorText';

const SCREEN_ATTR = 'data-kit-error-screen';

/** Показать ошибку в контейнере (повторный вызов обновляет тот же узел). */
export function showErrorScreen(el: HTMLElement, error: unknown, lang: KitLang = 'ru'): HTMLElement {
  const doc = el.ownerDocument;
  let box = el.querySelector<HTMLElement>(`[${SCREEN_ATTR}]`);
  if (!box) {
    box = doc.createElement('div');
    box.setAttribute(SCREEN_ATTR, '');
    box.setAttribute('role', 'alert');
    box.className = 'sk-error';
    const title = doc.createElement('h2');
    title.className = 'sk-error__title';
    const msg = doc.createElement('pre');
    msg.className = 'sk-error__message';
    box.append(title, msg);
    el.prepend(box);
  }
  box.children[0].textContent = kitT(lang, 'kit.error.title');
  box.children[1].textContent = describeError(error);
  return box;
}

export interface ErrorScreenOptions {
  lang?: KitLang;
  win?: Window;
  onError?: (error: unknown) => void;
}

/** Слушать window error / unhandledrejection и рисовать их в el. Возвращает снятие. */
export function installErrorScreen(el: HTMLElement, opts: ErrorScreenOptions = {}): () => void {
  const win = opts.win ?? (typeof window === 'undefined' ? undefined : window);
  if (!win) return () => {};
  const report = (error: unknown) => {
    opts.onError?.(error);
    showErrorScreen(el, error, opts.lang ?? 'ru');
  };
  const onError = (e: ErrorEvent) => {
    if (isBenignError(e.message, e.error)) return;
    report(e.error ?? e.message ?? '');
  };
  const onRejection = (e: Event) => report((e as PromiseRejectionEvent).reason);
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}
