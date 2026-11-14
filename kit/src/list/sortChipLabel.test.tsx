// @vitest-environment jsdom
// Приёмка препрода efe20f03: чип «Порядок» в списке спринтов показывал служебный ключ
// `progress:tasks` вместо подписи колонки «Задачи». Шапка таблицы брала подпись по имени
// поля (colKey), а чип — по сырому ключу колонки. Правило: подпись ключа никогда не
// бывает сырым составным ключом — `progress:` / `sum:` / `fresh:` подписываются как
// колонка, по имени поля.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, registerGameIcons } from '../index';
import type { KitConfig, KitData } from '../index';
import { groupKeyTitle } from './groupLabel';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'effort_total', title: 'Оценка', type: 'number' }] } },
  statuses: { items: [{ code: 'active', title: 'В работе', color: 'var(--inf)', icon: 'gears', category: 'in_progress' }] },
  list: {
    views: ['list'],
    columns: ['id', 'title', 'progress:tasks', 'sum:effort_total', 'status'],
    fieldLabels: { tasks: 'Задачи' },
  },
};
const data: KitData = {
  records: [{ id: 'S1', kind: 'sprint', title: 'Первый', status: 'active', fields: {} }],
  edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: 1 },
};

describe('чип «Порядок» не показывает сырой ключ колонки', () => {
  it('сортировка по «progress:tasks» — в чипе подпись колонки «Задачи»', () => {
    render(<ListView config={config} data={data} urlState={false} initial={{ sort: { key: 'progress:tasks', dir: 'desc' } }} />);
    const chip = screen.getByRole('button', { name: /^Порядок: / });
    expect(chip.textContent).toContain('Задачи');
    expect(chip.textContent).not.toContain('progress:');
  });

  it('подпись ключа = подпись колонки для всех составных префиксов', () => {
    expect(groupKeyTitle(config, 'ru', 'progress:tasks')).toBe('Задачи');
    expect(groupKeyTitle(config, 'ru', 'sum:effort_total')).toBe('Оценка');
    // Подписи нет нигде — показываем имя поля, но не служебный префикс.
    expect(groupKeyTitle(config, 'ru', 'fresh:checked_at')).toBe('checked_at');
  });
});
