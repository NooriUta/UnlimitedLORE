// @vitest-environment jsdom
// Подписи фасетов и разрезов по ВЫЧИСЛЯЕМЫМ полям (SPRINT_UXR_S13_KIT4/K4-FACET-LABELS).
//
// Повод — минипаспорт «Дата-странников» (K-08, 11.11.2026): их фасеты
// `quality` и `review` — поля, которые считает приложение, а не поля вида.
// Подпись kit искал только в `kind.fields`, не находил и молча печатал ключ —
// капсом, потому что так оформлена подпись фасета: «QUALITY все».
//
// Теперь у списка есть `list.fieldLabels` — подписи полей вне `kind.fields`;
// фасет или разрез без подписи валидатор называет (`facet-without-label`), а на
// экране такой ключ стоит строчными, с подсказкой «подпись не задана
// приложением» — пропуск виден, а не выдаётся за подпись.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitData } from './contract';
import { LIST_KEYS, validateKitConfig } from './validate';
import { groupKeyTitle } from '../list/groupLabel';
import { ListView } from '../list/ListView';

function cfg(list: Partial<NonNullable<KitConfig['list']>> = {}): KitConfig {
  return {
    modules: [{ id: 'm', title: 'Модуль', icon: 'compass' }],
    menu: { groups: [{ id: 'g', title: 'Группа', items: [{ id: 'item', title: 'Предметы' }] }] },
    kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'area', title: 'Область', type: 'enum' }] } },
    statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
    list: { views: ['list'], columns: ['title', 'status'], ...list },
  };
}
const labelWarns = (c: KitConfig) => validateKitConfig(c).warnings.filter(w => w.code === 'facet-without-label');

describe('K4-FACET-LABELS · валидатор называет фасет и разрез без подписи', () => {
  it('положительный контроль: поле вида и встроенные ключи подписаны — предупреждений нет', () => {
    expect(labelWarns(cfg({ filters: ['status', 'fields.area', 'area', 'kind'], groupings: ['area', 'status'] }))).toEqual([]);
  });

  it('фасет по вычисляемому полю без подписи — предупреждение с путём', () => {
    const w = labelWarns(cfg({ filters: ['status', 'quality'] }));
    expect(w.map(x => x.path)).toEqual(['list.filters[1]']);
    expect(w[0].message).toContain('quality');
  });

  it('разрез по вычисляемому полю без подписи — тоже предупреждение; разрез по связи не трогается', () => {
    const w = labelWarns(cfg({ groupings: ['review', 'rel:depends_on'] }));
    expect(w.map(x => x.path)).toEqual(['list.groupings[0]']);
  });

  it('подпись в list.fieldLabels — предупреждения нет (и с приставкой fields., и без)', () => {
    expect(labelWarns(cfg({
      filters: ['quality', 'fields.review'], groupings: ['quality'],
      fieldLabels: { quality: 'Качество', review: 'Согласование' },
    }))).toEqual([]);
  });

  it('пустая подпись или не строка — ошибка, а не тихий пропуск', () => {
    const v = validateKitConfig(cfg({ fieldLabels: { quality: '  ', review: 5 as unknown as string } }));
    expect(v.errors.map(e => e.path).sort()).toEqual(['list.fieldLabels.quality', 'list.fieldLabels.review']);
  });

  it('незнакомый ключ list — предупреждение unknown-key (список ключей один на валидатор и схему)', () => {
    const v = validateKitConfig(cfg({ facets: [] } as never));
    expect(v.warnings.filter(w => w.code === 'unknown-key').map(w => w.path)).toEqual(['list.facets']);
  });
});

describe('K4-FACET-LABELS · подпись на экране', () => {
  it('groupKeyTitle берёт подпись из list.fieldLabels', () => {
    const c = cfg({ fieldLabels: { quality: 'Качество' } });
    expect(groupKeyTitle(c, 'ru', 'quality')).toBe('Качество');
    expect(groupKeyTitle(c, 'ru', 'fields.quality')).toBe('Качество');
  });

  const data: KitData = {
    records: [{ id: 'r1', kind: 'item', title: 'Запись', status: 'todo', fields: { quality: 'bad', area: 'a' } }],
    edges: [], journal: [], meta: { generated_at: '2026-11-11T12:00:00Z' },
  };

  it('фасет с подписью показывает подпись', () => {
    render(<ListView config={cfg({ filters: ['quality'], fieldLabels: { quality: 'Качество' } })} data={data} urlState={false} />);
    const lbl = screen.getByText('Качество');
    expect(lbl.className).toContain('sk-list__label');
    expect(lbl.className).not.toContain('is-untitled');
  });

  it('фасет без подписи: ключ строчными и подсказка «подпись не задана приложением»', () => {
    const { container } = render(<ListView config={cfg({ filters: ['Quality'] })} data={data} urlState={false} />);
    const lbl = container.querySelector('.sk-facet .sk-list__label') as HTMLElement;
    expect(lbl.textContent).toBe('quality');
    expect(lbl.className).toContain('is-untitled');
    expect(lbl.getAttribute('title')).toContain('подпись не задана приложением');
  });
});

describe('K4-FACET-LABELS · сторож: ключи list в схеме и в валидаторе — один список', () => {
  const schema = JSON.parse(readFileSync(`${process.cwd()}/src/core/schema/kit-config.schema.json`, 'utf8'));
  const listProps = Object.keys(schema.properties.list.properties).sort();

  it('положительный контроль: схема и список прочитаны', () => {
    expect(listProps.length).toBeGreaterThan(5);
    expect(LIST_KEYS.length).toBeGreaterThan(5);
  });

  it('схема знает ровно те ключи list, что валидатор', () => {
    expect(listProps).toEqual([...LIST_KEYS].sort());
  });

  it('fieldLabels в схеме — словарь непустых строк', () => {
    const fl = schema.properties.list.properties.fieldLabels;
    expect(fl.type).toBe('object');
    expect(fl.additionalProperties.type).toBe('string');
    expect(fl.additionalProperties.minLength).toBe(1);
  });
});
