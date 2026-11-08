// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-CONTENT-V4 — паспорт во весь экран как в прототипе v4 (часть kit):
//  п.2 «получено N мин ↻» — в строке фактов шапки, а не в правом углу;
//  п.3 во весь экран свойства — свёрнутой строкой «▶ Свойства · …» под шапкой и вертикальной
//      рейкой «Свойства · Граф · Аналитика» у правого края; колонки свойств нет;
//  п.4 вкладки крупнее, подчёркивание акцентом.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => { const s = css.indexOf(`\n${sel} {`); return s < 0 ? '' : css.slice(css.indexOf('{', s) + 1, css.indexOf('}', s)); };

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { spec: { title: 'Спека', icon: 'scroll-quill', fields: [{ key: 'projects', title: 'Проекты', type: 'ref' }, { key: 'version', title: 'Версия', type: 'text' }] } },
  statuses: { items: [{ code: 'proposed', title: 'предложено', category: 'active', icon: 'calendar', color: 'var(--acc)' }] },
};
const rec: KitRecord = { id: 'S-1', kind: 'spec', title: 'Спека', status: 'proposed', fields: { projects: ['volva', 'UnlimitedLORE'], version: '1.0' }, body_md: 'Текст' };
const ctx: KitCtx = { config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } }, href: id => `#${id}`, esc: s => s, md: s => s };

describe('S4-CONTENT-V4 (kit): паспорт во весь экран как v4', () => {
  it('п.2 «получено» стоит в строке фактов, а не прижато вправо', () => {
    expect(ruleOf('.sk-rec-facts__tail')).not.toMatch(/margin-left:\s*auto/);
  });

  it('п.3 во весь экран: колонки свойств нет; под шапкой свёрнутая строка «Свойства · значения»', () => {
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    expect(container.querySelector('aside[data-zone="props"]')).toBeNull();
    const row = container.querySelector('details.sk-rec-propsrow') as HTMLDetailsElement;
    expect(row).not.toBeNull();
    expect(row.open).toBe(false);
    expect(row.querySelector('summary')!.textContent).toMatch(/Свойства.*volva.*UnlimitedLORE/);
    expect(within(row).getByTestId('kit-fields').textContent).toContain('1.0');
  });

  it('п.3 вертикальная рейка у края: Свойства раскрывает строку, Граф и Аналитика — вкладки', () => {
    const onTab = vi.fn();
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={onTab} placement="full" />);
    const rail = screen.getByRole('navigation', { name: 'Разделы паспорта' });
    expect(within(rail).getAllByRole('button').map(b => b.textContent)).toEqual(['Свойства', 'Граф', 'Аналитика']);
    fireEvent.click(within(rail).getByRole('button', { name: 'Свойства' }));
    expect((container.querySelector('details.sk-rec-propsrow') as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(within(rail).getByRole('button', { name: 'Граф' }));
    expect(onTab).toHaveBeenLastCalledWith('graph');
    fireEvent.click(within(rail).getByRole('button', { name: 'Аналитика' }));
    expect(onTab).toHaveBeenLastCalledWith('links');
  });

  it('снизу — без изменений: свойства колонкой, рейки нет', () => {
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" />);
    expect(container.querySelector('aside[data-zone="props"]')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Разделы паспорта' })).toBeNull();
  });

  it('п.4 вкладки подчёркиванием — крупнее (var(--fs-md)), активная — акцентом', () => {
    expect(ruleOf('.sk-tabs--underline .sk-tab')).toMatch(/font-size:\s*var\(--fs-md\)/);
    expect(ruleOf(".sk-tabs--underline .sk-tab[aria-selected='true']")).toMatch(/border-bottom-color:\s*var\(--acc\)/);
  });
});
