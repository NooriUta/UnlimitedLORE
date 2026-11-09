// Палитра LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14): «/» — поиск по записям
// с сервера (слайс search), Ctrl+K — записи, команды и действия над целью:
// открытой записью или выделением списка (S4-10, ListView.onSelectionChange).
// Клавиши, ARIA, честные состояния — kit (CommandPalette, useKitPalette);
// здесь только склейка с API LORE. Своей копии палитры web-next не держит.
import { useMemo, useRef } from 'react';
import {
  CommandPalette, PaletteTriggers, createRecentList, useKitLang, useKitPalette,
  type KitCtx, type KitData, type KitRecord, type PaletteAction, type PaletteTarget, type RecentList, type SafeStorage,
} from '@seidr/kit';
import { copyActions, loreRemoteSearch, searchKinds, type ClipboardLike } from './paletteSource';
import { recordHref } from '../nav/loreRoutes';

export interface LorePaletteProps {
  storage: SafeStorage;
  /** Загруженные экраном записи и конфиг; без них ищем только на сервере. */
  ctx?: Partial<Pick<KitCtx, 'data' | 'config' | 'role' | 'user'>>;
  /** Над чем Ctrl+K: открытая запись или выделение списка. */
  target?: PaletteTarget | null;
  /** Действия экрана над целью — вдобавок к общим (коды, ссылки, открыть). */
  actions?: readonly PaletteAction[];
  /** Ссылка на запись; по умолчанию — параметр rec в URL текущей страницы. */
  href?: (id: string) => string;
  onOpenRecord?: (r: KitRecord) => void;
  headers?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  clipboard?: ClipboardLike | null;
  remoteDelayMs?: number;
  enabled?: boolean;
  /** Кнопки «Поиск» и «Команды»: на сенсоре клавиш нет — у каждой клавиши есть кнопка. */
  trigger?: boolean;
  /**
   * Список недавнего. По умолчанию свой, в хранилище палитры. Внутри
   * оболочки передаётся список оболочки (shellRecent.ts): два списка
   * недавнего — это две правды о том, где человек был.
   */
  recent?: RecentList;
}

const EMPTY_DATA: KitData = { records: [], edges: [], journal: [], meta: { generated_at: '' } };

/**
 * Ссылка на запись из палитры (S4-13, переоткрыто 09.11): известна запись — адрес
 * раздела её типа из loreRoutes (?mod&sec&open), как у ленты и списка; иначе —
 * переданная ссылка. «Копировать ссылку» и переход давали ?rec=<id>, а такого
 * маршрута в v2 нет: ссылка открывала «Новости» (тот же тупик, что аудит D-01).
 */
export function paletteHref(id: string, records: readonly KitRecord[], fallback: (id: string) => string): string {
  const r = records.find(x => x.id === id);
  const kind = r ? String((r as { kind?: unknown }).kind ?? (r as { type?: unknown }).type ?? '') : '';
  return (kind && recordHref(kind, id)) || fallback(id);
}

export function defaultHref(id: string): string {
  return `?rec=${encodeURIComponent(id)}`;
}

export function LorePalette({
  storage, ctx, target, actions, href: hrefProp = defaultHref, onOpenRecord, headers, fetchImpl, clipboard, remoteDelayMs, enabled, trigger, recent: recentProp,
}: LorePaletteProps) {
  const lang = useKitLang();
  const palette = useKitPalette({ enabled });
  const ownRecent = useMemo(() => createRecentList(storage), [storage]);
  const recent = recentProp ?? ownRecent;
  const remote = useMemo(() => loreRemoteSearch({ headers, fetchImpl, lang }), [headers, fetchImpl, lang]);
  // Записи, которые палитра знает (экрана и цель), — для адреса по типу записи.
  // Через ref: ссылку зовут лениво (копировать, открыть), а ctx собирается ниже.
  const known = useRef<readonly KitRecord[]>([]);
  known.current = [
    ...(ctx?.data?.records ?? []),
    ...(target?.type === 'record' ? [target.record] : []),
  ];
  const href = useMemo(() => (id: string) => paletteHref(id, known.current, hrefProp), [hrefProp]);

  const fullCtx = useMemo<KitCtx>(() => {
    const config = ctx?.config ?? { modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [] } };
    return {
      data: ctx?.data ?? EMPTY_DATA,
      // Типы серверного поиска — подписи и иконки; конфиг экрана важнее.
      config: { ...config, kinds: { ...searchKinds(lang), ...config.kinds } },
      role: ctx?.role,
      user: ctx?.user,
      href,
      esc: s => s,
      md: s => s,
    };
  }, [ctx, href, lang]);

  const open = (id: string) => {
    const rec = fullCtx.data.records.find(r => r.id === id)
      ?? (target?.type === 'record' && target.record.id === id ? target.record : undefined);
    if (rec && onOpenRecord) onOpenRecord(rec);
    else window.location.assign(href(id));
  };
  const allActions = useMemo(
    () => [...(actions ?? []), ...copyActions(lang, href, clipboard, open)],
    // open читает свежие ctx/target через замыкание — пересобираем вместе с ними.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, lang, href, clipboard, fullCtx, target, onOpenRecord],
  );

  return (
    <>
      {trigger && (
        // S4-23: поиск строкой и «Команды» с подписью и клавишами — деталь kit.
        <PaletteTriggers onSearch={palette.openSearch} onCommands={palette.openPalette} />
      )}
      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        onClose={palette.close}
        ctx={fullCtx}
        recent={recent}
        onOpenRecord={onOpenRecord}
        target={target}
        actions={allActions}
        remote={remote}
        remoteDelayMs={remoteDelayMs}
      />
    </>
  );
}
