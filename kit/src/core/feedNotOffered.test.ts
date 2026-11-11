// Валидатор говорит о НЕпредложенной ленте
// (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW, просьба сессии приложения 10.11.2026).
//
// ПОВОД — не гипотеза, а случившееся. Лента, тело записи и двухуровневый вид
// сделаны и влиты, но в LORE их не видно НИ НА ОДНОМ экране: приложение не
// назвало `list.feed`, и вид не предлагается. Два прежних предупреждения эту
// дырку не ловили: одно про «feed в views без list.feed», другое про «list.feed
// без feed в views». Случай «ни того, ни другого» был тишиной — и именно он
// случился.
//
// Чего валидатор НЕ делает: не решает за приложение, нужна ли разделу лента.
// Признак берётся из САМОГО конфига — приложение объявило у типа поле времени
// (`type: 'date'`), — а не угадывается по данным. `updated_at` для этого не
// годится: он есть у каждой записи по контракту, и предупреждение вылезало бы
// везде, то есть не значило бы ничего.
import { describe, expect, it } from 'vitest';
import type { KitConfig } from './contract';
import { validateKitConfig } from './validate';

const cfg = (over: Partial<KitConfig> = {}): KitConfig => ({
  modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }],
  menu: { groups: [] },
  kinds: {
    item: {
      title: 'Предмет',
      icon: 'scroll-quill',
      fields: [{ key: 'happened', title: 'Случилось', type: 'date' }],
    },
  },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns: ['title+id'], showClosed: 'all' },
  ...over,
} as KitConfig);

const codes = (c: KitConfig) => validateKitConfig(c).warnings.map(w => w.code);

describe('K2-FEED-VIEW · валидатор не молчит о непредложенной ленте', () => {
  it('положительный контроль: конфиг валиден, ошибок нет', () => {
    expect(validateKitConfig(cfg()).errors).toEqual([]);
  });

  it('у типа объявлено поле времени, а вида feed нет — предупреждение', () => {
    expect(codes(cfg())).toContain('feed-not-offered');
  });

  it('предупреждение называет ПОЛЕ: без имени оно не подсказывает, что писать', () => {
    const w = validateKitConfig(cfg()).warnings.find(x => x.code === 'feed-not-offered');
    expect(w?.message).toMatch(/happened/);
  });

  it('вид feed назван — предупреждения нет', () => {
    const c = cfg({ list: { views: ['list', 'feed'], columns: ['title+id'], showClosed: 'all', feed: { timeField: 'updated_at' } } } as Partial<KitConfig>);
    expect(codes(c)).not.toContain('feed-not-offered');
  });

  it('поля времени у типов не объявлено — молчим: решать за приложение нечем', () => {
    const c = cfg({
      kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'note', title: 'Заметка', type: 'text' }] } },
    } as Partial<KitConfig>);
    expect(codes(c)).not.toContain('feed-not-offered');
  });

  it('полей у типа нет вовсе — молчим', () => {
    const c = cfg({ kinds: { item: { title: 'Предмет', icon: 'scroll-quill' } } } as Partial<KitConfig>);
    expect(codes(c)).not.toContain('feed-not-offered');
  });

  it('`updated_at` сам по себе предупреждения НЕ даёт: он есть у каждой записи', () => {
    // Иначе предупреждение вылезло бы в каждом разделе и перестало что-либо
    // значить — это уже не честность, а шум.
    const c = cfg({
      kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'updated_at', title: 'Обновлено', type: 'text' }] } },
    } as Partial<KitConfig>);
    expect(codes(c)).not.toContain('feed-not-offered');
  });

  it('это ПРЕДУПРЕЖДЕНИЕ, а не ошибка: конфиг без ленты законен', () => {
    const v = validateKitConfig(cfg());
    expect(v.ok, 'раздел имеет право жить без ленты').toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('прежние два предупреждения на месте — их этот случай не подменяет', () => {
    const noFeedCfg = cfg({ list: { views: ['list', 'feed'], columns: ['title+id'], showClosed: 'all' } } as Partial<KitConfig>);
    expect(codes(noFeedCfg)).toContain('feed-config');
    const unused = cfg({ list: { views: ['list'], columns: ['title+id'], showClosed: 'all', feed: { timeField: 'updated_at' } } } as Partial<KitConfig>);
    expect(codes(unused)).toContain('feed-unused');
  });
});
