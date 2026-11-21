// Меню из документа модели одним вызовом kit (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS).
//
// Повод — пилот «Дата-странники» (сессия 696ed81e): `configFromModel` не читал `surfaces.nav`,
// и они собирали меню сами из того же документа; в LORE v2 то же делало приложение
// (`web-next/src/shell/v2Config.ts`, menuFromModel). Знание «как документ становится меню»
// жило в двух приложениях. Здесь — в kit, а предметное (подписи по ключу, какие разделы
// есть у приложения) приходит параметрами.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { navFromModel } from './navFromModel';
import { configFromModel } from './configFromModel';
import type { LoreModelDoc } from './loadModel';

const doc = (nav: unknown) => ({ surfaces: { nav } });
const NAV = [
  { id: 'feed', label_key: 'grp.feed', tone: 'var(--inf)', pin_top: true, items: [{ section: 'news', icon: 'newspaper' }] },
  { id: 'work', label: 'Работа', tone: 'var(--acc)', items: [{ section: 'sprint', icon: 'sprint', label: 'Спринты' }, { section: 'task', icon: 'checklist', view: 'board' }] },
];

describe('navFromModel · меню из surfaces.nav', () => {
  it('группы и пункты — в форме меню kit: подпись, тон, pinTop, значок, вид', () => {
    const r = navFromModel(doc(NAV), { t: k => ({ 'grp.feed': 'Лента' } as Record<string, string>)[k], sectionTitle: s => `раздел ${s}` });
    expect(r.decided).toBe(true);
    expect(r.groups).toEqual([
      { id: 'feed', title: 'Лента', tone: 'var(--inf)', pinTop: true, items: [{ id: 'news', title: 'раздел news', icon: 'newspaper' }] },
      { id: 'work', title: 'Работа', tone: 'var(--acc)', items: [{ id: 'sprint', title: 'Спринты', icon: 'sprint' }, { id: 'task', title: 'раздел task', icon: 'checklist', view: 'board' }] },
    ]);
    expect(r.notes).toEqual([]);
  });

  it('раздел, которого у приложения нет, отбрасывается — и это названо; пустая группа уходит', () => {
    const r = navFromModel(doc(NAV), { knows: s => s !== 'news', sectionTitle: s => s });
    expect(r.groups.map(g => g.id)).toEqual(['work']);
    expect(r.notes.join(' ')).toMatch(/news/);
  });

  it('нет surfaces.nav — decided: false и причина словами, а не пустое меню как решение', () => {
    const r = navFromModel({ surfaces: {} }, {});
    expect(r.decided).toBe(false);
    expect(r.groups).toEqual([]);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('подписи нет ни в документе, ни у приложения — показан код, и это названо', () => {
    const r = navFromModel(doc([{ id: 'x', label_key: 'missing', items: [{ section: 's', icon: 'cog' }] }]), {});
    expect(r.groups[0].title).toBe('x');
    expect(r.groups[0].items[0].title).toBe('s');
    expect(r.notes.join(' ')).toMatch(/подпис/);
  });

  it('элемент не той формы пропускается с причиной, а не роняет всё меню', () => {
    const r = navFromModel(doc([null, { items: [] }, ...NAV]), { sectionTitle: s => s, t: k => k });
    expect(r.groups.map(g => g.id)).toEqual(['feed', 'work']);
    expect(r.notes.length).toBeGreaterThanOrEqual(2);
  });

  it('configFromModel отдаёт меню тем же вызовом — с теми же параметрами приложения', () => {
    const m = { statuses: {}, types: {}, surfaces: { nav: NAV } } as unknown as LoreModelDoc;
    const c = configFromModel(m, { statusDict: 'x', nav: { sectionTitle: s => s, t: k => k } });
    expect(c.nav.decided).toBe(true);
    expect(c.nav.groups.map(g => g.id)).toEqual(['feed', 'work']);
  });

  it('в kit нет предметных имён: исходник не знает ни разделов, ни групп LORE', () => {
    const src = readFileSync(`${process.cwd()}/src/model/navFromModel.ts`, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const word of ['sprint', 'shell.sec', 'shell.grp', 'news', 'adr']) expect(src).not.toContain(word);
  });
});
