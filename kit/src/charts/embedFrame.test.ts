// SPRINT_VIZ_EMBED/EMB-L2 · VE-4 — чистые функции рамки встроенного графика
// (перенос v1 src/components/lore/volvaEmbed.ts в kit для v2).
// Рецепт апстрима (VE-5, 06.11.2026): высоту встройка шлёт сама —
// postMessage({metabase:{type:"frame", frame:{height}}}, "*"); тема — только
// через #hash адреса. Отправитель шлёт на "*", а в адресе лежит JWT, поэтому
// доверять сообщению можно ТОЛЬКО с origin подписанного адреса.
import { describe, expect, it } from 'vitest';
import { embedOrigin, embedSrc, embedThemeFromAttrs, frameErrorFromMessage, frameHeightFromMessage } from './embedFrame';

const SIGNED = 'https://volva.example.org/embed/question/eyJhbGciOi.payload.sig';

describe('рамка встройки: адрес', () => {
  it('тема transparent, палитра и режим уходят через hash, JWT не трогается (VE-4)', () => {
    const s = embedSrc(SIGNED, { palette: 'juniper', mode: 'dark' }, { locale: 'ru' });
    expect(s.startsWith(SIGNED + '#')).toBe(true);
    const h = new URLSearchParams(s.split('#')[1]);
    expect(h.get('theme')).toBe('transparent');
    expect(h.get('palette')).toBe('juniper');
    expect(h.get('mode')).toBe('dark');
    expect(h.get('bordered')).toBe('false');
    expect(h.get('titled')).toBe('false');
    expect(h.get('locale')).toBe('ru');
  });

  it('язык встройки — язык приложения, а не прибитый ru', () => {
    const s = embedSrc(SIGNED, { palette: 'slate', mode: 'light' }, { locale: 'en' });
    expect(new URLSearchParams(s.split('#')[1]).get('locale')).toBe('en');
  });

  it('прежний hash заменяется, а не дописывается вторым', () => {
    const s = embedSrc(SIGNED + '#theme=night', { palette: 'amber-forest', mode: 'light' });
    expect(s.split('#')).toHaveLength(2);
    expect(s).toContain('theme=transparent');
    expect(s).toContain('mode=light');
  });

  it('открытый параметр (продукт) — в адресе, поле скрыто; пусто — без параметра', () => {
    const s = embedSrc(SIGNED, { palette: 'amber-forest', mode: 'dark' }, { products: ['VOLVA', 'HOUND'] });
    const [beforeHash, hash] = s.split('#');
    const u = new URL(beforeHash);
    expect(u.pathname).toBe(new URL(SIGNED).pathname);
    expect(u.searchParams.getAll('product')).toEqual(['VOLVA', 'HOUND']);
    expect(new URLSearchParams(hash).get('hide_parameters')).toBe('product');
    const all = embedSrc(SIGNED, { palette: 'amber-forest', mode: 'dark' }, { products: [] });
    expect(new URL(all.split('#')[0]).searchParams.has('product')).toBe(false);
  });

  it('палитра и режим — из атрибутов корня: нет data-theme → amber-forest, нет data-mode → dark; чужая палитра — откат', () => {
    expect(embedThemeFromAttrs(null, null)).toEqual({ palette: 'amber-forest', mode: 'dark' });
    expect(embedThemeFromAttrs('slate', 'light')).toEqual({ palette: 'slate', mode: 'light' });
    // mono — палитра только v2, у встройки её нет: не уходит в адрес мусором
    expect(embedThemeFromAttrs('mono', null)).toEqual({ palette: 'amber-forest', mode: 'dark' });
    expect(embedThemeFromAttrs('neon', 'light')).toEqual({ palette: 'amber-forest', mode: 'light' });
  });
});

describe('рамка встройки: origin в обе стороны', () => {
  it('origin — из подписанного адреса; не http(s) — null (javascript:/data: в рамку не идут)', () => {
    expect(embedOrigin(SIGNED)).toBe('https://volva.example.org');
    expect(embedOrigin('не адрес')).toBeNull();
    expect(embedOrigin('javascript:alert(1)')).toBeNull();
    expect(embedOrigin('data:text/html,<b>x</b>')).toBeNull();
  });

  it('высота — только с origin встройки и только из сообщения frame', () => {
    const origin = 'https://volva.example.org';
    const msg = (o: string, data: unknown) => ({ origin: o, data });
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'frame', frame: { mode: 'fit', height: 420.2 } } }), origin)).toBe(421);
    expect(frameHeightFromMessage(msg('https://evil.example', { metabase: { type: 'frame', frame: { height: 9999 } } }), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'location', location: {} } }), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'frame', frame: { height: -5 } } }), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, 'строка'), origin)).toBeNull();
    expect(frameHeightFromMessage(msg(origin, { metabase: { type: 'frame', frame: { height: 300 } } }), null)).toBeNull();
  });

  // VE-7 (Völva 0.1.12, 15.11.2026): при ошибке встройка шлёт
  // {metabase:{type:"error", error:{code, message}}}, code ∈ FORBIDDEN | NOT_FOUND | QUERY_FAILED.
  // Код берём только из известного набора, только с origin встройки; текст Völva не показываем.
  it('ошибка — только с origin встройки и только из известного кода', () => {
    const origin = 'https://volva.example.org';
    const msg = (o: string, data: unknown) => ({ origin: o, data });
    const err = (code: unknown) => ({ metabase: { type: 'error', error: { code, message: 'текст Völva' } } });
    expect(frameErrorFromMessage(msg(origin, err('FORBIDDEN')), origin)).toBe('FORBIDDEN');
    expect(frameErrorFromMessage(msg(origin, err('NOT_FOUND')), origin)).toBe('NOT_FOUND');
    expect(frameErrorFromMessage(msg(origin, err('QUERY_FAILED')), origin)).toBe('QUERY_FAILED');
    expect(frameErrorFromMessage(msg(origin, err('ЧТО-ТО')), origin)).toBe('UNKNOWN');
    expect(frameErrorFromMessage(msg('https://evil.example', err('FORBIDDEN')), origin)).toBeNull();
    expect(frameErrorFromMessage(msg(origin, { metabase: { type: 'frame', frame: { height: 300 } } }), origin)).toBeNull();
    expect(frameErrorFromMessage(msg(origin, err('FORBIDDEN')), null)).toBeNull();
  });
});
