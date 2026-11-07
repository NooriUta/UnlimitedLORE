// Палитра LORE v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14): «/» — поиск по записям
// с сервера (слайс search), Ctrl+K — записи, команды и действия над целью:
// открытой записью или выделением списка (S4-10, ListView.onSelectionChange).
// Клавиши, ARIA, честные состояния — kit (CommandPalette, useKitPalette);
// здесь только склейка с API LORE. Своей копии палитры web-next не держит.
import { useMemo } from 'react';
import {
  CommandPalette, IconButton, SECTION_ICONS, createRecentList, useKitLang, useKitPalette,
  type KitCtx, type KitData, type KitRecord, type PaletteAction, type PaletteTarget, type SafeStorage,
} from '@seidr/kit';
import { appT } from '../i18n';
import { copyActions, loreRemoteSearch, searchKinds, type ClipboardLike } from './paletteSource';

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
}

const EMPTY_DATA: KitData = { records: [], edges: [], journal: [], meta: { generated_at: '' } };

export function defaultHref(id: string): string {
  return `?rec=${encodeURIComponent(id)}`;
}

export function LorePalette({
  storage, ctx, target, actions, href = defaultHref, onOpenRecord, headers, fetchImpl, clipboard, remoteDelayMs, enabled, trigger,
}: LorePaletteProps) {
  const lang = useKitLang();
  const palette = useKitPalette({ enabled });
  const recent = useMemo(() => createRecentList(storage), [storage]);
  const remote = useMemo(() => loreRemoteSearch({ headers, fetchImpl, lang }), [headers, fetchImpl, lang]);

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
        <span className="palette-trigger">
          <IconButton icon={SECTION_ICONS.search} label={appT(lang, 'palette.trigger.search')} shortcut="/" onClick={palette.openSearch} />
          <IconButton icon={SECTION_ICONS.commands} label={appT(lang, 'palette.trigger.commands')} shortcut="Control+K" onClick={palette.openPalette} />
        </span>
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
