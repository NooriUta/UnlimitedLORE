import { describe, expect, it } from 'vitest';
import { VOLVA_URL_KEY, readVolvaUrl, volvaDecisionDocsUrl } from './volvaLinks';

/**
 * Решение ↔ документ Völva (SPRINT_VOLVA_DATASTORY/DS-LINK-1, DS-LINK-2):
 * кнопка в карточке решения LORE — ссылка на страницу Völva в сессии
 * пользователя; адрес Völva — настройка volva.url в админке LORE.
 */
describe('ссылки на Völva', () => {
  const row = (code: string, label_ru: string | null, is_active = true) => ({ code, label_ru, is_active });

  it('адрес Völva из настройки: без хвостового слэша; нет, пусто, выключено или не http(s) → null', () => {
    expect(readVolvaUrl([row(VOLVA_URL_KEY, 'https://volva.odal.seidrstudio.pro/')])).toBe('https://volva.odal.seidrstudio.pro');
    expect(readVolvaUrl([])).toBeNull();
    expect(readVolvaUrl([row(VOLVA_URL_KEY, '  ')])).toBeNull();
    expect(readVolvaUrl([row(VOLVA_URL_KEY, 'https://v', false)])).toBeNull();
    expect(readVolvaUrl([row(VOLVA_URL_KEY, 'javascript:alert(1)')])).toBeNull();
  });

  it('страница документов решения; id кодируется; с черновиком — title и text в адресе', () => {
    const base = 'https://volva.odal.seidrstudio.pro';
    expect(volvaDecisionDocsUrl(base, 'D-2026-VOLVA-DEVELOP-ACCUMULATE'))
      .toBe('https://volva.odal.seidrstudio.pro/document/decision/D-2026-VOLVA-DEVELOP-ACCUMULATE');
    const u = new URL(volvaDecisionDocsUrl(base, 'D-1', { title: 'Копим в develop', text: 'тело решения' }));
    expect(u.pathname).toBe('/document/decision/D-1');
    expect(u.searchParams.get('title')).toBe('Копим в develop');
    expect(u.searchParams.get('text')).toBe('тело решения');
  });

  it('текст черновика обрезается, чтобы адрес не рос без предела', () => {
    const u = new URL(volvaDecisionDocsUrl('https://v.example', 'D-1', { title: 't', text: 'я'.repeat(5000) }));
    expect((u.searchParams.get('text') ?? '').length).toBeLessThanOrEqual(1500);
  });
});
