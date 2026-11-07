import { describe, expect, it } from 'vitest';
import { embedSrc, frameHeightFromMessage, embedOrigin, themeFromAttrs } from './volvaEmbed';

// SPRINT_VIZ_EMBED/EMB-L2 · рецепт Völva (VE-5, 06.11.2026):
// высоту Metabase шлёт сам — postMessage({metabase:{type:"frame", frame:{height}}}, "*");
// тема — только через #hash адреса фрейма. Отправитель шлёт на "*", а в адресе
// фрейма лежит JWT, поэтому доверять сообщению можно ТОЛЬКО с origin Völva.

const SIGNED = 'https://volva.odal.seidrstudio.pro/embed/question/eyJhbGciOi.payload.sig';

describe('встроенный график Völva', () => {
  it('тема и оформление уходят через hash, JWT не трогается', () => {
    const s = embedSrc(SIGNED, { palette: 'juniper', mode: 'dark' });
    expect(s.startsWith(SIGNED + '#')).toBe(true);
    const h = new URLSearchParams(s.split('#')[1]);
    // VE-4 (Völva PR #49): фон прозрачный, акценты и оси — в палитре страницы
    expect(h.get('theme')).toBe('transparent');
    expect(h.get('palette')).toBe('juniper');
    expect(h.get('mode')).toBe('dark');
    expect(h.get('bordered')).toBe('false');
    expect(h.get('titled')).toBe('false');
    expect(h.get('locale')).toBe('ru');
  });

  it('прежний hash заменяется, а не дописывается вторым', () => {
    const s = embedSrc(SIGNED + '#theme=night', { palette: 'amber-forest', mode: 'light' });
    expect(s.split('#')).toHaveLength(2);
    expect(s).toContain('theme=transparent');
    expect(s).toContain('mode=light');
  });

  it('палитра и режим — из атрибутов страницы LORE: без data-theme — amber-forest, без data-mode — dark', () => {
    expect(themeFromAttrs(null, null)).toEqual({ palette: 'amber-forest', mode: 'dark' });
    expect(themeFromAttrs('slate', 'light')).toEqual({ palette: 'slate', mode: 'light' });
    expect(themeFromAttrs('warm-dark', 'dark')).toEqual({ palette: 'warm-dark', mode: 'dark' });
    // неизвестная палитра не уходит в адрес мусором — откат к палитре по умолчанию
    expect(themeFromAttrs('neon', 'light')).toEqual({ palette: 'amber-forest', mode: 'light' });
  });

  it('продукт — открытым параметром в адресе рамки, не в токене; «все» — без ?product (карточка 47, 07.11.2026)', () => {
    const s = embedSrc(SIGNED, { palette: 'amber-forest', mode: 'dark' }, ['VOLVA', 'HOUND']);
    const [beforeHash, hash] = s.split('#');
    const u = new URL(beforeHash);
    expect(u.pathname).toBe(new URL(SIGNED).pathname);            // токен в пути не тронут
    expect(u.searchParams.getAll('product')).toEqual(['VOLVA', 'HOUND']);
    expect(new URLSearchParams(hash).get('hide_parameters')).toBe('product');
    const all = embedSrc(SIGNED, { palette: 'amber-forest', mode: 'dark' }, []);
    expect(new URL(all.split('#')[0]).searchParams.has('product')).toBe(false);
  });

  it('origin берётся из подписанного адреса', () => {
    expect(embedOrigin(SIGNED)).toBe('https://volva.odal.seidrstudio.pro');
    expect(embedOrigin('не адрес')).toBeNull();
  });

  it('высота принимается только с origin Völva и только из сообщения frame', () => {
    const origin = 'https://volva.odal.seidrstudio.pro';
    const msg = (o: string, data: unknown) => ({ origin: o, data });
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'frame', frame: { mode: 'fit', height: 420 } } }), origin)).toBe(420);
    expect(frameHeightFromMessage(msg('https://evil.example', { metabase: { type: 'frame', frame: { height: 9999 } } }), origin))
      .toBeNull();                                   // чужой origin — игнор
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'location', location: {} } }), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'frame', frame: { height: -5 } } }), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, 'строка'), origin)).toBeNull();
  });
});
