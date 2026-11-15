// @vitest-environment jsdom
// Карточка показывает то же, что колонки списка (K4-PHONE-PEOPLE-CARDS, S4-22).
// Дефект прода 14.11.2026: поля карточки отбирались по приставке «fields.», а колонки
// всех экранов приложения заданы без неё («roles», «n_projects») — на карточке не было
// ни одного поля, а код записи (у человека это kc_sub) печатался всегда.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const UUID = '52f6fad5-3fe6-42b2-8393-f5e667ac8c8f';
const person: KitRecord = { id: UUID, kind: 'person', title: 'omiloreadmin', status: '', fields: { roles: ['owner'], n_projects: 3, agents: 2 } };
const config = (columns: string[]): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { person: { title: 'Люди', icon: 'person', fields: [
    { key: 'roles', title: 'Роль', type: 'enum' },
    { key: 'n_projects', title: 'Проектов', type: 'number' },
    { key: 'agents', title: 'Агентов', type: 'number' },
  ] } },
  statuses: { items: [] },
  list: { views: ['list', 'cards'], columns },
});
const data: KitData = { records: [person], edges: [], journal: [], meta: { generated_at: '2026-11-14T12:00:00Z', total: 1 } };
const pick = (name: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: /Вид/ })).getByRole('radio', { name }));
const card = (c: HTMLElement) => c.querySelector(`.sk-cards [data-record-id="${UUID}"]`) as HTMLElement;

describe('карточки: поля и код — по колонкам списка', () => {
  it('колонки без приставки «fields.» попадают на карточку с подписями', () => {
    const { container } = render(<ListView config={config(['title', 'roles', 'n_projects', 'agents'])} data={data} urlState={false} />);
    pick('Карточки');
    const fields = card(container).querySelector('.sk-cards__fields');
    expect(fields, 'на карточке есть блок полей').not.toBeNull();
    expect(fields!.textContent).toContain('Роль');
    expect(fields!.textContent).toContain('owner');
    expect(fields!.textContent).toContain('Проектов');
    expect(fields!.textContent).toContain('3');
    expect(fields!.textContent).toContain('Агентов');
  });

  it('колонки «id» нет — кода записи (сырого UUID) на карточке нет', () => {
    const { container } = render(<ListView config={config(['title', 'roles'])} data={data} urlState={false} />);
    pick('Карточки');
    expect(card(container).textContent).not.toContain(UUID);
    expect(card(container).textContent).toContain('omiloreadmin');
  });

  it('колонка «id» или «title+id» есть — код на карточке есть', () => {
    for (const cols of [['id', 'title'], ['title+id']]) {
      const { container, unmount } = render(<ListView config={config(cols)} data={data} urlState={false} />);
      pick('Карточки');
      expect(card(container).textContent, cols.join(',')).toContain(UUID);
      unmount();
    }
  });

  it('служебные колонки (title, status) полями карточки не дублируются', () => {
    const { container } = render(<ListView config={config(['title+id', 'status', 'roles'])} data={data} urlState={false} />);
    pick('Карточки');
    const dts = [...card(container).querySelectorAll('.sk-cards__fields dt')].map(d => d.textContent);
    expect(dts).toEqual(['Роль']);
  });
});
