// Настройки раскладки человека (SPRINT_UXR_S14_KIT5/K5-LAYOUT-PREFS): где открывать запись, правая
// колонка, сворачивать ли меню при чтении, Peek по наведению, техсведения, подтверждение смены
// статуса, вид графа. Владелица 16.11: «должно быть одинаково и настраиваемо по желанию» — у LORE и у
// пилота одно и то же, поэтому правило здесь, а не в каждом приложении.
//
// ОДИН ИСТОЧНИК — АТРИБУТЫ КОРНЯ. Что применено, то и прочитано (правило LORE S4-02: однажды настройки
// сохранялись и не читались никем, а рядом стоял второй блок со своей правдой). Хранит приложение —
// у LORE сервер, у пилота localStorage, — и оно же даёт умолчания. kit только кладёт и читает.
import { isRecordPlacement, type RecordPlacement } from '../record/RecordDock';

export type RightColumn = 'auto' | 'open' | 'closed';
export type GraphViewPref = 'force' | 'obsidian' | 'structure';

export interface KitLayoutPrefs {
  /** Где открывать запись; нет — человек не выбирал, решает экран. */
  passportPlace?: RecordPlacement;
  /** Правая колонка записи; `auto` — не выбирал (не «закрыто»). */
  rightColumn: RightColumn;
  /** Сворачивать меню оболочки, пока открыта запись. */
  collapseNavOnRead: boolean;
  /** Карточки Peek по наведению; по умолчанию включены. */
  peekHover: boolean;
  /** Технические сведения. */
  showTech: boolean;
  /** Спрашивать «A → B?» до смены статуса. */
  statusConfirm: boolean;
  /** Вид вкладки «Граф»; нет — не выбирал. */
  graphView?: GraphViewPref;
}

/** Где читать атрибуты; null — документа нет (сервер, тесты). */
export type LayoutHost = { getAttribute(name: string): string | null } | null;

const rootHost = (): LayoutHost => (typeof document === 'undefined' ? null : document.documentElement);

/**
 * Прочитать применённое. `defaults` — умолчания ПРИЛОЖЕНИЯ: действуют только там, где человек не
 * выбирал. Мусор в атрибуте — как невыбранное.
 */
export function readLayoutPrefs(host: LayoutHost = rootHost(), defaults: Partial<KitLayoutPrefs> = {}): KitLayoutPrefs {
  const a = (n: string) => host?.getAttribute(n) ?? null;
  const place = a('data-passport-place');
  const right = a('data-right-column');
  const graph = a('data-graph-view');
  const nav = a('data-read-nav');
  const peek = a('data-peek-hover');
  const tech = a('data-show-tech');
  const confirm = a('data-status-confirm');
  return {
    passportPlace: isRecordPlacement(place) ? place : defaults.passportPlace,
    rightColumn: right === 'open' || right === 'closed' ? right : defaults.rightColumn ?? 'auto',
    collapseNavOnRead: nav === 'collapse' ? true : nav === 'keep' ? false : defaults.collapseNavOnRead ?? false,
    peekHover: peek === 'off' ? false : peek === 'on' ? true : defaults.peekHover ?? true,
    showTech: tech === 'on' ? true : tech === 'off' ? false : defaults.showTech ?? false,
    statusConfirm: confirm === 'on' ? true : confirm === 'off' ? false : defaults.statusConfirm ?? false,
    graphView: graph === 'force' || graph === 'obsidian' || graph === 'structure' ? graph : defaults.graphView,
  };
}

/**
 * Атрибуты корня под выбор; null — снять (человек не выбирал). Флаг, заданный явно, пишется явно
 * (keep/on/off): иначе «выбрал не сворачивать» не отличить от «не выбирал», и умолчание приложения
 * перебило бы выбор человека.
 */
export function layoutAttrs(p: Partial<KitLayoutPrefs>): Record<string, string | null> {
  return {
    'data-passport-place': p.passportPlace ?? null,
    'data-right-column': p.rightColumn && p.rightColumn !== 'auto' ? p.rightColumn : null,
    'data-read-nav': p.collapseNavOnRead === undefined ? null : p.collapseNavOnRead ? 'collapse' : 'keep',
    'data-peek-hover': p.peekHover === undefined ? null : p.peekHover ? 'on' : 'off',
    'data-show-tech': p.showTech === undefined ? null : p.showTech ? 'on' : 'off',
    'data-status-confirm': p.statusConfirm === undefined ? null : p.statusConfirm ? 'on' : 'off',
    'data-graph-view': p.graphView ?? null,
  };
}

export interface LayoutTarget { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }

/** Положить выбор на корень (или другой узел). */
export function applyLayoutPrefs(target: LayoutTarget, p: Partial<KitLayoutPrefs>): void {
  for (const [n, v] of Object.entries(layoutAttrs(p))) {
    if (v === null) target.removeAttribute(n); else target.setAttribute(n, v);
  }
}
