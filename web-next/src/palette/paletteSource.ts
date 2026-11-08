// Палитра v2: источник серверного поиска и общие действия над целью
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14). Сама палитра — kit (CommandPalette);
// здесь только то, что знает про LORE: типы слайса search и их подписи.
import type { KindConfig, KitLang, KitRecord, PaletteAction, PaletteRemoteSearch } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { fetchSearchSlice, type SearchSliceOptions, type SearchSliceRow } from '../api/searchSlice';

/** Типы, которые отдаёт слайс search (LoreSlices), и их иконки game-icons. */
export const SEARCH_KIND_ICONS = {
  adr: 'scales',
  sprint: 'sprint',
  task: 'scroll-unfurled',
  spec: 'spell-book',
  decision: 'gavel',
  quality_gate: 'checkered-flag',
  runbook: 'book-cover',
  doc: 'scroll-quill',
  question: 'help',
  use_case: 'bullseye',
  pain: 'broken-heart',
  gain: 'gift-of-knowledge',
  job: 'anvil',
  actor: 'person',
} as const satisfies Record<string, string>;

export type SearchKind = keyof typeof SEARCH_KIND_ICONS;

export function searchKinds(lang: KitLang): Record<string, KindConfig> {
  const out: Record<string, KindConfig> = {};
  for (const [kind, icon] of Object.entries(SEARCH_KIND_ICONS)) {
    out[kind] = { title: appT(lang, `kind.${kind}` as AppKey), icon };
  }
  return out;
}

/** Строка слайса → запись контракта kit. Заголовка нет — показываем код, а не пустоту. */
export function toKitRecords(rows: readonly SearchSliceRow[]): KitRecord[] {
  return rows.map(r => ({ id: r.ref_id, kind: r.type, title: r.title ?? r.ref_id, status: '', fields: {} }));
}

export function loreRemoteSearch(opts: Omit<SearchSliceOptions, 'signal'> = {}): PaletteRemoteSearch {
  return async (query, signal) => {
    const r = await fetchSearchSlice(query, { ...opts, signal });
    return { records: toKitRecords(r.rows), partial: r.partial };
  };
}

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

function defaultClipboard(): ClipboardLike | null {
  return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
}

/**
 * Общие действия над записью/выделением — без записи в базу: открыть,
 * скопировать коды, скопировать ссылки. Действия экранов (статус, массовые
 * правки) экран передаёт сам через props.actions.
 */
export function copyActions(
  lang: KitLang,
  href: (id: string) => string,
  clipboard: ClipboardLike | null | undefined = defaultClipboard(),
  open?: (id: string) => void,
): PaletteAction[] {
  const write = async (text: string) => {
    if (!clipboard) throw new Error(appT(lang, 'palette.err.clipboard'));
    await clipboard.writeText(text);
  };
  const abs = (id: string) => (typeof location === 'undefined' ? href(id) : new URL(href(id), location.origin).toString());
  return [
    { id: 'copy-codes', title: appT(lang, 'palette.action.copyCodes'), scope: 'any', run: ids => write(ids.join('\n')) },
    { id: 'copy-links', title: appT(lang, 'palette.action.copyLinks'), scope: 'any', run: ids => write(ids.map(abs).join('\n')) },
    {
      id: 'open', title: appT(lang, 'palette.action.open'), scope: 'record',
      run: ids => { if (open) open(ids[0]); else window.location.assign(href(ids[0])); },
    },
  ];
}
