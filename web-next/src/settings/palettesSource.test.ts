// Список палитр берётся из модели (SPRINT_UXR_S10_SEIDR_KIT/K-14, п. 5).
//
// Проверяется не только «пришло — показали», а ЧЕТЫРЕ разных отказа, каждый
// своими словами: модель недоступна · раздела не прислали · раздел пуст ·
// подписи нет в справочнике. Молчаливый откат к списку kit выглядел бы как
// выбор модели, которого не было.
import { describe, expect, it, vi } from 'vitest';
import { fetchPalettes, paletteFallback } from './palettesSource';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const net = (body: unknown, status = 200) =>
  vi.fn(async () => json(body, status)) as unknown as typeof fetch;

/** Документ модели: format и version обязательны — загрузчик без них не работает. */
const DOC = { format: 'model/0', version: '2026-11-10T00:00:00Z' };

const MODEL = {
  ...DOC,
  palettes: {
    source: 'settings:palette',
    default: 'amber-forest',
    entries: [
      { code: 'lichen', title: 'Лишайник', title_en: 'Lichen', order: 2, in_dictionary: true },
      { code: 'amber-forest', title: 'Янтарный лес', title_en: 'Amber forest', order: 1, in_dictionary: true },
    ],
  },
};

describe('K-14 · палитры из модели', () => {
  it('положительный контроль: список и умолчание пришли из модели', async () => {
    const p = await fetchPalettes({ fetchImpl: net(MODEL) });
    expect(p.fromModel).toBe(true);
    expect(p.options.map(o => o.value)).toEqual(['amber-forest', 'lichen']);
    expect(p.options[0].label).toBe('Янтарный лес');
    expect(p.default).toBe('amber-forest');
    expect(p.notes).toEqual([]);
  });

  it('en: подписи берутся en-полем модели', async () => {
    const p = await fetchPalettes({ fetchImpl: net(MODEL), lang: 'en' });
    expect(p.options[0].label).toBe('Amber forest');
  });

  it('образец — токеном темы, а не цветом: значения живут в seidr.css', async () => {
    const p = await fetchPalettes({ fetchImpl: net(MODEL) });
    expect(p.options[0].swatch).toBe('var(--swatch-amber-forest)');
  });

  it('модель недоступна — список kit как умолчание, и это СКАЗАНО', async () => {
    const p = await fetchPalettes({ fetchImpl: net({}, 502) });
    expect(p.fromModel).toBe(false);
    expect(p.options).toEqual(paletteFallback());
    expect(p.notes.join(' ')).toMatch(/умолчание|недоступн/i);
  });

  it('раздела палитр нет (старый сервер на проде) — другая причина, тоже словами', async () => {
    const p = await fetchPalettes({ fetchImpl: net({ ...DOC, types: {} }) });
    expect(p.fromModel).toBe(false);
    expect(p.notes.join(' ')).toMatch(/не прислал/i);
  });

  it('раздел пуст — это НЕ «не прислали», и текст другой', async () => {
    const p = await fetchPalettes({ fetchImpl: net({ ...DOC, palettes: { entries: [], default: 'slate' } }) });
    expect(p.fromModel).toBe(false);
    expect(p.notes.join(' ')).toMatch(/пуст/i);
    // Умолчание сервера при этом не теряется.
    expect(p.default).toBe('slate');
  });

  it('палитра без статьи в справочнике — показан код и названа причина', async () => {
    const p = await fetchPalettes({
      fetchImpl: net({ ...DOC, palettes: { default: 'slate', entries: [{ code: 'slate', title: '', in_dictionary: false }] } }),
    });
    expect(p.fromModel).toBe(true);
    expect(p.options[0].label).toBe('slate');
    expect(p.notes.join(' ')).toMatch(/справочник/i);
  });

  it('палитра модели, цветов которой нет в теме — названа, образца нет', async () => {
    const p = await fetchPalettes({
      fetchImpl: net({ ...DOC, palettes: { default: 'neon', entries: [{ code: 'neon', title: 'Неон', in_dictionary: true }] } }),
    });
    expect(p.options[0].swatch).toBeNull();
    expect(p.notes.join(' ')).toContain('neon');
  });

  it('умолчание темы kit — все пять палитр платформы, образцы токенами', () => {
    const f = paletteFallback();
    expect(f.map(o => o.value)).toEqual(['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark']);
    expect(f.every(o => o.swatch?.startsWith('var(--swatch-'))).toBe(true);
  });
});
