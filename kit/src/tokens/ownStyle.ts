// Свой стиль установки (SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE, решения владельца 25.11.2026: 1а — хранится в базе
// JSON токенов, 3б — на входе JSON или CSS-переменные). Сервер уже проверил токены (LoreAppearance.checkStyle);
// здесь — только наложение: инлайн-переменные на корень поверх базовой палитры, без <style> и без внешних загрузок
// (CSP не трогаем). Применённые имена помнит атрибут data-own-style — смена стиля снимает прежние, ничего не висит.

export interface OwnStyleTokens {
  /** Основной (тёмный) режим. */
  root: Record<string, string>;
  /** Поправки светлого режима поверх root. */
  light?: Record<string, string>;
}

const VAR_NAME = /^--[a-z0-9_-]+$/;

/** Переменные стиля для режима: light накладывается поверх root; чужие имена отбрасываются. */
export function ownStyleVars(t: OwnStyleTokens, mode: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (m: Record<string, string> | undefined) => {
    for (const [k, v] of Object.entries(m ?? {})) if (VAR_NAME.test(k) && typeof v === 'string') out[k] = v;
  };
  put(t.root);
  if (mode === 'light') put(t.light);
  return out;
}

export interface StyleTarget {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

const MARK = 'data-own-style';

/** Наложить свой стиль (или снять: null). Прежние переменные снимаются всегда. */
export function applyOwnStyle(el: StyleTarget, t: OwnStyleTokens | null, mode: 'dark' | 'light'): void {
  for (const k of (el.getAttribute(MARK) ?? '').split(',').filter(Boolean)) el.style.removeProperty(k);
  if (!t) { el.removeAttribute(MARK); return; }
  const vars = ownStyleVars(t, mode);
  const keys = Object.keys(vars).sort();
  for (const k of keys) el.style.setProperty(k, vars[k]);
  if (keys.length) el.setAttribute(MARK, keys.join(','));
  else el.removeAttribute(MARK);
}
