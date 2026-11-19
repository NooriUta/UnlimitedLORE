// @vitest-environment jsdom
// Таблицы админки карточками на телефоне: каждая клетка несёт имя своей колонки (data-label) — иначе в карточке
// значение без подписи. Раскрытая панель строки (colSpan) подписи не получает. Раскладку проверяет Playwright
// (e2e/admin-phone.spec.ts), здесь — подписи.
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import { labelTableCells, useTableCardLabels } from './tableCards';

const TABLE = `
  <table class="adm-table"><thead><tr><th>Агент</th><th colspan="2">Где</th><th><span class="sk-sr">действия</span></th></tr></thead>
  <tbody>
    <tr><td>Kimi</td><td>ryzenai</td><td>arharaga</td><td>Изменить</td></tr>
    <tr><td colspan="4">панель правки</td></tr>
  </tbody></table>`;

describe('подписи клеток', () => {
  it('клетка получает заголовок своей колонки, colSpan заголовка учитывается', () => {
    const div = document.createElement('div');
    div.innerHTML = TABLE;
    labelTableCells(div);
    const cells = Array.from(div.querySelectorAll('tbody tr:first-child td')).map(c => c.getAttribute('data-label'));
    expect(cells).toEqual(['Агент', 'Где', 'Где', 'действия']);
  });
  it('раскрытая панель строки (colSpan) — без подписи', () => {
    const div = document.createElement('div');
    div.innerHTML = TABLE;
    labelTableCells(div);
    expect(div.querySelector('tbody tr:last-child td')!.hasAttribute('data-label')).toBe(false);
  });
  it('таблица не .adm-table не трогается', () => {
    const div = document.createElement('div');
    div.innerHTML = TABLE.replace('class="adm-table"', 'class="other"');
    labelTableCells(div);
    expect(div.querySelector('td')!.hasAttribute('data-label')).toBe(false);
  });
  it('хук подписывает строки, появившиеся после загрузки', async () => {
    let add: () => void = () => {};
    function Screen(): ReactNode {
      const ref = useRef<HTMLDivElement>(null);
      const [rows, setRows] = useState(['a']);
      add = () => setRows(r => [...r, 'b']);
      useTableCardLabels(ref);
      return (
        <div ref={ref}>
          <table className="adm-table"><thead><tr><th>Код</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r}><td>{r}</td></tr>)}</tbody></table>
        </div>
      );
    }
    const { container } = render(<Screen />);
    expect(container.querySelector('td')!.getAttribute('data-label')).toBe('Код');
    add();
    await waitFor(() => expect(container.querySelectorAll('td[data-label="Код"]')).toHaveLength(2));
  });
});
