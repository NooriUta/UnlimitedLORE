// @vitest-environment jsdom
// Поле «ключ → значение» с вложенностью (SPRINT_UXR_S13_KIT4/K4-FIELD-KV).
//
// «Дата-странники»: правила игры (game_rules — бой, экономика, тепло руны) приходят вложенным
// объектом, и поле вида text выводило сырой JSON. Прототип — kit_gaps_v1.html, раздел К2
// (владелица 15.11: «заводи спринт kit4»). Правила: вложенный объект — группа с ▾, список
// объектов — подтаблица (колонки — объединение ключей), скаляры — моно, `_doc` не строка.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { FieldValue } from './RecordView';
import { validateKitConfig } from '../core/validate';
import { KvValue } from './KvValue';

const RULES = {
  _doc: 'Правила боя и экономики',
  combat: { base_damage: 3, crit: { chance: 0.1, mult: 2 } },
  economy: { start_gold: 50 },
  runes: [{ rune: 'Феху', heat: 2 }, { rune: 'Уруз', heat: 3, rare: true }],
  tags: ['бой', 'руны'],
  enabled: true,
};

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);

describe('KvValue · раскладка', () => {
  it('скаляры — строкой «ключ — значение» моношрифтом; _doc строкой не показан', () => {
    wrap(<KvValue value={RULES} label="Правила" />);
    const root = screen.getByTestId('kit-kv');
    expect(root.textContent).not.toContain('Правила боя и экономики');
    expect(root.textContent).not.toContain('_doc');
    const row = within(root).getByText('enabled').closest('tr')!;
    expect(row.querySelector('.sk-kv__val')?.textContent).toBe('true');
  });

  it('вложенный объект — сворачиваемая группа ▾ со своими строками', () => {
    wrap(<KvValue value={RULES} label="Правила" />);
    const group = screen.getByText('combat').closest('details')!;
    expect(group.open).toBe(true);
    expect(within(group).getByText('base_damage')).toBeTruthy();
    // глубже — тоже группа
    expect(within(group).getByText('crit').closest('details')).toBeTruthy();
    fireEvent.click(within(group).getAllByText('combat')[0]);
  });

  it('список объектов — подтаблица, колонки — объединение ключей, пропуск — «—»', () => {
    wrap(<KvValue value={RULES} label="Правила" />);
    const table = screen.getByTestId('kit-kv-table-runes');
    const heads = [...table.querySelectorAll('th')].map(th => th.textContent);
    expect(heads).toEqual(['rune', 'heat', 'rare']);
    const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    expect(rows).toEqual([['Феху', '2', '—'], ['Уруз', '3', 'true']]);
  });

  it('список скаляров — через запятую', () => {
    wrap(<KvValue value={RULES} label="Правила" />);
    const row = screen.getByText('tags').closest('tr')!;
    expect(row.querySelector('.sk-kv__val')?.textContent).toBe('бой, руны');
  });

  it('строка с JSON-объектом разбирается; не JSON — показана как есть, а не ошибкой', () => {
    wrap(<KvValue value={JSON.stringify({ a: 1 })} label="x" />);
    expect(screen.getByText('a')).toBeTruthy();
  });

  it('пустой объект — «—», а не пустая рамка', () => {
    wrap(<KvValue value={{ _doc: 'только пояснение' }} label="x" />);
    expect(screen.queryByTestId('kit-kv')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('поле вида kv в паспорте и конфиге', () => {
  const ctx = { config: { modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [] } }, data: { records: [], edges: [], journal: [], meta: { generated_at: '' } }, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;

  it('FieldValue type=kv — таблица, не сырой JSON', () => {
    wrap(<FieldValue type="kv" value={RULES} ctx={ctx} title="Правила" />);
    expect(screen.getByTestId('kit-kv')).toBeTruthy();
    expect(document.body.textContent).not.toContain('{"');
  });

  it('валидатор принимает виды полей kv и list (схема их уже знает)', () => {
    const cfg = { modules: [{ id: 'm', title: 'M', icon: 'quill-ink' }], menu: { groups: [] }, statuses: { items: [] },
      kinds: { rule: { title: 'Правило', icon: 'gears', fields: [{ key: 'game_rules', title: 'Правила', type: 'kv' }, { key: 'hints', title: 'Подсказки', type: 'list' }] } } };
    const errs = validateKitConfig(cfg).errors.map(i => i.path);
    expect(errs.filter(p => p.includes('fields'))).toEqual([]);
  });
});
