// @vitest-environment jsdom
// D-2026-MIG-REPOSITORY-ORGANIZATION (прототип mig-repos-orgs.html, владелица 19.11.2026): у раздела
// «Организации» проверенный ноль — не «пусто по ошибке», а «тип заведён, какие завести — решает
// владелица». Общие слова kit этого не скажут: пустое состояние раздела называет приложение (list.empty).
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitData } from '../core/contract';
import { validateKitConfig } from '../core/validate';
import { ListView } from './ListView';

const base = (empty?: { title?: string; hint?: string }): KitConfig => ({
  modules: [], menu: { groups: [] }, kinds: { org: { title: 'Организации', icon: 'castle' } },
  statuses: { items: [] },
  list: { views: ['list'], filters: [], groupings: [], columns: ['title+id'], ...(empty ? { empty } : {}) },
});

const data = (meta: Partial<KitData['meta']> = {}): KitData =>
  ({ records: [], edges: [], journal: [], meta: { generated_at: '2026-11-19T00:00:00Z', total: 0, truncated: false, ...meta } });

describe('list.empty — пустое состояние словами приложения', () => {
  it('проверенный ноль показывает заголовок и пояснение раздела', () => {
    const { container } = render(<ListView config={base({ title: 'Организаций пока нет', hint: 'Решает владелица' })} data={data()} urlState={false} />);
    const box = container.querySelector('[data-state="empty"]');
    expect(box?.textContent).toContain('Организаций пока нет');
    expect(box?.textContent).toContain('Решает владелица');
  });

  it('без list.empty — общие слова kit (положительный контроль)', () => {
    const { container } = render(<ListView config={base()} data={data()} urlState={false} />);
    const box = container.querySelector('[data-state="empty"]');
    expect(box).toBeTruthy();
    expect(box?.textContent).not.toContain('Организаций пока нет');
  });

  it('выдача неполная — слова раздела не говорятся: «пусто» утверждать нельзя', () => {
    const { container } = render(<ListView config={base({ title: 'Организаций пока нет' })} data={data({ total: undefined, truncated: true })} urlState={false} />);
    expect(container.textContent).not.toContain('Организаций пока нет');
  });

  it('валидатор знает ключ empty и проверяет строки', () => {
    const ok = validateKitConfig(base({ title: 'x', hint: 'y' }));
    expect([...ok.errors, ...ok.warnings].filter(i => i.path.startsWith('list'))).toEqual([]);
    const bad = validateKitConfig({ ...base(), list: { ...base().list!, empty: { title: 5 as unknown as string } } });
    expect(bad.errors.some(i => i.path.startsWith('list.empty'))).toBe(true);
  });
});
