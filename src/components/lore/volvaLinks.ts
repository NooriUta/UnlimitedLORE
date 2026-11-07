/**
 * Ссылки из LORE в Völva (SPRINT_VOLVA_DATASTORY/DS-LINK-1, DS-LINK-2).
 * Völva открывается в сессии самого пользователя — права его, без служебного
 * ключа на бэкенде LORE. Адрес Völva — настройка volva.url (app_setting) в
 * админке LORE; пока её нет, кнопка честно говорит «Völva не подключена».
 */
export const VOLVA_URL_KEY = 'volva.url';

interface DictLike { code: string; label_ru: string | null; is_active?: boolean | null }

export function readVolvaUrl(rows: DictLike[]): string | null {
  const r = rows.find(x => x.code === VOLVA_URL_KEY && x.is_active !== false);
  const v = (r?.label_ru ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : null;
}

const MAX_TEXT = 1500;

/** Страница документов, объясняющих решение; с черновиком — заготовка нового документа. */
export function volvaDecisionDocsUrl(base: string, decisionId: string, draft?: { title?: string; text?: string }): string {
  const url = new URL(`${base}/document/decision/${encodeURIComponent(decisionId)}`);
  if (draft?.title) url.searchParams.set('title', draft.title);
  if (draft?.text) url.searchParams.set('text', draft.text.slice(0, MAX_TEXT));
  return url.toString();
}
