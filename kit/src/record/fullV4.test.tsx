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
    // 09.11.2026: рейка стала «только иконками» (владелица: «три» на
    // предложенные иконки, и «не только при полном развороте — это
    // промежуточное состояние resizable состояния»). Поэтому имена проверяем
    // доступными именами, а не видимым текстом: текста у кнопок больше нет, и
    // прежняя форма утверждения запрещала бы саму мини-версию.
    expect(within(rail).getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Свойства', 'Граф', 'Аналитика']);
    expect(within(rail).getAllByRole('button').map(b => b.textContent?.trim())).toEqual(['', '', '']);
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

describe('во весь экран — воздушнее и по центру (владелица 08.11)', () => {
  it('паспорт во весь экран — колонкой по центру, с полями; текст с большим межстрочием', () => {
    const r = ruleOf(".sk-dock[data-placement='full'] .sk-rec");
    expect(r).toMatch(/max-width:/);
    expect(r).toMatch(/margin:\s*0 auto/);
    expect(r).toMatch(/padding:/);
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-prose")).toMatch(/line-height:\s*1\.7/);
  });
});

describe('во весь экран — линия вкладок шире текста (владелица 08.11: «выглядит классно, чем всё в одну ширину»)', () => {
  it('рамка и колонка — переменными в процентах («делай процентами и переменными — разные браузеры»)', () => {
    const vars = ruleOf(".sk-dock[data-placement='full']");
    // Поправка владелицы 09.11: мера должна считаться ОТ ДИСПЛЕЯ. Рамка стала
    // 66vw вместо 66 %, потому что слой теперь внутри оболочки и процент
    // считался бы от области содержимого, то есть от контекста. Это та же
    // «доля окна» переменной, что и раньше, — требование «процентами и
    // переменными, разные браузеры» не нарушено, поэтому тест принимает обе
    // формы доли: % и vw.
    expect(vars).toMatch(/--rec-frame:\s*\d+(%|vw)/);
    expect(vars).toMatch(/--rec-col:\s*\d+(%|vw)/);
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-rec")).toMatch(/max-width:\s*var\(--rec-frame\)/);
    const narrow = ruleOf(".sk-dock[data-placement='full'] .sk-rec-head,\n.sk-dock[data-placement='full'] .sk-rec-facts,\n.sk-dock[data-placement='full'] .sk-rec-propsrow,\n.sk-dock[data-placement='full'] .sk-tabpanel > *");
    expect(narrow).toMatch(/max-width:\s*var\(--rec-col\)/);
    expect(narrow).toMatch(/margin-left:\s*auto/);
  });
});

describe('во весь экран — ширина полей настраивается наверху («дать управлять шире или уже поля»)', () => {
  it('переключатель «Поля: уже · средне · шире» меняет data-width; выбор запоминается', () => {
    localStorage.clear();
    const { container, unmount } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    const seg = screen.getByRole('radiogroup', { name: 'Ширина текста' });
    expect(within(seg).getAllByRole('radio').map(b => b.textContent)).toEqual(['уже', 'средне', 'шире', 'во всю ширину']);
    expect(container.querySelector('.sk-rec')?.getAttribute('data-width')).toBe('m');
    fireEvent.click(within(seg).getByRole('radio', { name: 'шире' }));
    expect(container.querySelector('.sk-rec')?.getAttribute('data-width')).toBe('l');
    unmount();
    const again = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    expect(again.container.querySelector('.sk-rec')?.getAttribute('data-width')).toBe('l');
    for (const [w, re] of [['s', /--rec-col:\s*\d+%/], ['l', /--rec-col:\s*\d+%/]] as const) {
      expect(ruleOf(`.sk-dock[data-placement='full'] .sk-rec[data-width='${w}']`)).toMatch(re);
    }
  });
  it('снизу переключателя нет', () => {
    render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" />);
    expect(screen.queryByRole('radiogroup', { name: 'Ширина текста' })).toBeNull();
  });
});

describe('ушки разделов — без заливки (владелица 08.11: «акцентный фон убирает воздушность»)', () => {
  it('у кнопок рейки фон прозрачный, при наведении — без акцента', () => {
    // Рейка перешла на общие кнопки-иконки kit (09.11, «только иконками»),
    // поэтому утверждение теперь про них: своего правила `.sk-rec-rail__btn`
    // больше нет, а требование владелицы — то же, «акцентный фон убирает
    // воздушность».
    expect(ruleOf('.sk-iconbtn')).toMatch(/background:\s*(none|transparent)/);
    expect(ruleOf('.sk-iconbtn:hover')).not.toMatch(/--acc/);
  });
});

// Владелица 11.11.2026: «в Паспорте уменьши наполовину пустые отступы у каждого
// вида (уже средне шире), добавь ещё тип — на всю ширину: там всё раздвигаешь и
// оставляешь стандартную минимальную границу по краям».
// Пустое поле по бокам — (100 − мера)%. Вдвое меньше: 44→22, 34→17, 18→9.
describe('ширина текста 11.11: поля вдвое уже и вариант «во всю ширину»', () => {
  it('у «уже / средне / шире» пустые поля вдвое меньше прежних: 78% / 83% / 91%', () => {
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-rec[data-width='s']")).toMatch(/--rec-col:\s*78%/);
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-rec[data-width='m']")).toMatch(/--rec-col:\s*83%/);
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-rec[data-width='l']")).toMatch(/--rec-col:\s*91%/);
  });

  it('четвёртый вариант «во всю ширину»: рамка и мера 100%, по краям только стандартный отступ', () => {
    localStorage.clear();
    const { container } = render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} placement="full" />);
    const seg = screen.getByRole('radiogroup', { name: 'Ширина текста' });
    expect(within(seg).getAllByRole('radio').map(b => b.textContent)).toEqual(['уже', 'средне', 'шире', 'во всю ширину']);
    fireEvent.click(within(seg).getByRole('radio', { name: 'во всю ширину' }));
    expect(container.querySelector('.sk-rec')?.getAttribute('data-width')).toBe('f');
    const full = ruleOf(".sk-dock[data-placement='full'] .sk-rec[data-width='f']");
    expect(full).toMatch(/--rec-col:\s*100%/);
    expect(full).toMatch(/max-width:\s*100%/);
    expect(full).toMatch(/padding-left:\s*var\(--pad-x\)/);
    expect(full).toMatch(/padding-right:\s*var\(--pad-x\)/);
  });
});
