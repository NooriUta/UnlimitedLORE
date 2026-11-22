// @vitest-environment jsdom
// Меню «сверху» (пространства и главы), нижняя панель на телефоне, скрытие пространств по роли
// (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай» — пункты 1 и 2 сверки kit по прототипу GLADSHEIM /appnew).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig } from '../core/contract';
import { BottomBar, TopNav, menuForRole, spaceOfItem } from '.';

const groups: KitConfig['menu']['groups'] = [
  { id: 'analytics', title: 'Аналитика', items: [{ id: 'now', title: 'Сейчас', icon: 'sun' }, { id: 'rooms', title: 'По комнатам' }] },
  { id: 'use', title: 'Использование', items: [{ id: 'music', title: 'Музыка', icon: 'speaker' }] },
  { id: 'admin', title: 'Администрирование', roles: ['admin', 'operator'], items: [{ id: 'nodes', title: 'Узлы' }] },
];
const config = { modules: [], menu: { groups }, kinds: {}, statuses: { items: [] } } as unknown as KitConfig;

describe('скрытие пространств по роли', () => {
  it('группа с roles видна только этим ролям; без roles — всем', () => {
    expect(menuForRole(config, 'viewer').menu.groups.map((g) => g.id)).toEqual(['analytics', 'use']);
    expect(menuForRole(config, 'admin').menu.groups.map((g) => g.id)).toEqual(['analytics', 'use', 'admin']);
  });
  it('конфиг не мутируется', () => {
    menuForRole(config, 'viewer');
    expect(config.menu.groups).toHaveLength(3);
  });
});

describe('пространство пункта', () => {
  it('глава находит своё пространство; неизвестная — первое', () => {
    expect(spaceOfItem(groups, 'music')?.id).toBe('use');
    expect(spaceOfItem(groups, null)?.id).toBe('analytics');
  });
});

describe('TopNav — пространства сверху, главы под ними', () => {
  it('выбор главы зовёт onGo; текущие пространство и глава отмечены aria-current', () => {
    const onGo = vi.fn();
    render(<TopNav groups={groups} item="rooms" onGo={onGo} />);
    expect(screen.getByRole('button', { name: 'Аналитика' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'По комнатам' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Использование' }));
    expect(onGo).toHaveBeenCalledWith('music');
  });
  it('справа — место приложения (вид, языки)', () => {
    render(<TopNav groups={groups} item="now" onGo={() => {}} end={<span>ru en pl</span>} />);
    expect(screen.getByText('ru en pl')).toBeTruthy();
  });
});

describe('BottomBar — нижняя панель на телефоне', () => {
  it('по кнопке на пространство, ведёт в первую главу; текущее отмечено', () => {
    const onGo = vi.fn();
    render(<BottomBar groups={groups} item="music" onGo={onGo} icon={(slug) => <i data-icon={slug} />} />);
    expect(screen.getByRole('button', { name: 'Использование' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Аналитика' }));
    expect(onGo).toHaveBeenCalledWith('now');
  });
});
