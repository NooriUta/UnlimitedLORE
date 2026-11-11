// Список палитр — из модели, а не из kit (SPRINT_UXR_S10_SEIDR_KIT/K-14, п. 5).
//
// Слова владелицы 09.11.2026: «зачем тебе словарь статусов на своей стороне,
// если это задача уже конкретного приложения» и «завтра кто-нибудь будет на
// kit собирать своё приложение и?». Список палитр — такой же прикладной
// словарь; в kit остаётся только ТЕМА (значения `--swatch-*`), потому что это
// оформление, а не словарь.
//
// Раздел `palettes` в `/lore/model` завела серверная сессия (PR #1069); форму
// я не угадывал — она прислана:
//   {source: 'settings:palette', default, entries: [{code, title, title_en, order, in_dictionary}]}
// Коды и умолчание — из того же белого списка, что принимает настройка
// `palette`: модель не предложит палитру, которую сервер не даст сохранить.
//
// Честность здесь важнее краткости: «раздела не прислали» (старый сервер на
// проде), «раздел пуст», «подписи нет в справочнике» и «модель недоступна» —
// РАЗНЫЕ утверждения, и панель настроек печатает их словами. Молчаливый откат
// к списку kit выглядел бы как выбор модели, которого не было.
import { PALETTES, loadModel, palettesFromModel, type ModelPaletteEntry } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export interface PaletteOption {
  value: string;
  label: string;
  /** Токен образца; null — цветов этой палитры в теме нет. */
  swatch: string | null;
}

export interface PalettesView {
  options: PaletteOption[];
  /** Умолчание модели; null — не прислали. */
  default: string | null;
  /** true — список пришёл из модели; false — умолчание темы kit. */
  fromModel: boolean;
  /** Что случилось — словами, на экран. */
  notes: string[];
}

export interface PalettesOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  /** Язык подписей: у модели есть ru и en. */
  lang?: 'ru' | 'en';
}

/** Список темы kit — именно УМОЛЧАНИЕ, и оно всегда помечено словами. */
export function paletteFallback(): PaletteOption[] {
  return PALETTES.map(p => ({ value: p.id as string, label: p.label, swatch: p.swatch }));
}

const label = (e: ModelPaletteEntry, lang: 'ru' | 'en'): string =>
  (lang === 'en' ? e.titleEn ?? e.title : e.title);

function reason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return e === undefined ? 'причина не названа' : String(e);
}

/** Палитры из модели плюс причины. Без React — проверяется тестом без экрана. */
export async function fetchPalettes(opts: PalettesOptions = {}): Promise<PalettesView> {
  const http = opts.fetchImpl ?? loreFetch;
  const url = opts.url ?? '/lore/model';
  const lang = opts.lang ?? 'ru';

  const res = await loadModel(async signal => {
    const r = await http(url, signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`модель не прочитана: сервер ответил ${r.status}`);
    return r.json();
  });

  if (res.state === 'error') {
    return {
      options: paletteFallback(),
      default: null,
      fromModel: false,
      notes: [`палитры взяты из темы kit как умолчание: модель недоступна (${reason(res.error)})`],
    };
  }

  const notes: string[] = [];
  if (res.state === 'stale') {
    notes.push(`список палитр взят из кеша модели и может быть устаревшим (${reason(res.error)})`);
  }

  const p = palettesFromModel(res.model, { known: PALETTES.map(x => x.id as string), lang });
  notes.push(...p.notes);

  // Пришёл пустой список — выбирать нечего; подставляем умолчание темы, но
  // оговорка от `palettesFromModel` остаётся на экране.
  if (!p.sent || p.entries.length === 0) {
    return { options: paletteFallback(), default: p.default, fromModel: false, notes };
  }

  return {
    options: p.entries.map(e => ({ value: e.code, label: label(e, lang), swatch: e.swatch })),
    default: p.default,
    fromModel: true,
    notes,
  };
}
