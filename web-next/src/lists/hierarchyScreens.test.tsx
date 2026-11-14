// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-23, вторая ветка правила владелицы 14.11.2026: иерархия ОДНОГО типа
// (ссылка на себя однотипных объектов) в виде «Таблица» — дети строками той же таблицы с отступом.
// Разделы, у записи которых есть родитель того же типа, объявляют это list.tree.parent — той же
// настройкой, что читает вид «Дерево»; kit строит иерархию сам.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { ListView, registerGameIcons } from '@seidr/kit';
import { validateKitConfig } from '@seidr/kit/core';
import { LIST_SCREENS } from './screens';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('PU-23 · разделы с иерархией одного типа объявляют list.tree', () => {
  it.each(['components', 'docs', 'products', 'features'] as const)('%s: list.tree.parent = parent, без предупреждений валидатора', id => {
    const cfg = LIST_SCREENS[id].config('ru');
    expect(cfg.list?.tree?.parent).toBe('parent');
    expect(validateKitConfig(cfg).warnings.map(w => w.code)).not.toContain('tree-unused');
  });

  it('спринты (дети — задачи, другой тип) иерархией одного типа не объявлены: там вложенная таблица (#1387)', () => {
    expect(LIST_SCREENS.sprints.config('ru').list?.tree).toBeUndefined();
  });

  it('компоненты: подкомпонент — строкой под родителем в тех же колонках, по раскрытию', () => {
    const def = LIST_SCREENS.components;
    const rows = [
      { component_id: 'CORE', full_name: 'Ядро', parent_id: '' },
      { component_id: 'CORE.API', full_name: 'API ядра', parent_id: 'CORE' },
      { component_id: 'UI', full_name: 'Интерфейс', parent_id: '' },
    ];
    const records = rows.map(r => def.map(r));
    render(
      <ListView
        config={def.config('ru')}
        data={{ records, edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: records.length } }}
        urlState={false}
      />,
    );
    const ids = () => [...document.querySelectorAll('tbody tr[data-record-id]')].map(tr => tr.getAttribute('data-record-id'));
    expect(ids()).toEqual(['CORE', 'UI']);
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Ядро' }));
    expect(ids()).toEqual(['CORE', 'CORE.API', 'UI']);
    expect(document.querySelector('tr[data-record-id="CORE.API"]')!.getAttribute('data-depth')).toBe('1');
  });
});
