// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28 — верхняя строка паспорта как в прототипе v4 (скрин 115443):
// «← Спеки · Категория: wip / SPEC-…» слева, справа «‹ 1 из 2 ›», Aa, «Свойства».
// В v2 пейджер висел над заголовком отдельной полосой, крошек не было вовсе —
// паспорт выглядел отдельным приложением, а не продолжением списка.
// Крошка ведёт назад в список С ТЕМ ЖЕ фильтром (контекст — текстом), текущая
// запись — aria-current. «Свойства» в строке — кнопка того же раскрытия, что ушко.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { RecordCrumbs } from './RecordCrumbs';
import { RecordReader } from './RecordReader';
import { RecordPager } from './RecordPager';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { spec: { title: 'Спека', icon: 'scroll-quill' } },
  statuses: { items: [{ code: 'wip', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--acc)' }] },
};
const record: KitRecord = { id: 'SPEC-1', kind: 'spec', title: 'Спека один', status: 'wip', fields: {} };
const ctx: KitCtx = {
  config, data: { records: [record, { ...record, id: 'SPEC-2' }], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
};

describe('RecordCrumbs', () => {
  it('«← Раздел · контекст фильтра» — ссылка назад; ID — текущая страница', () => {
    render(<RecordCrumbs back={{ label: 'Спеки', href: '/?sec=spec&lf=x' }} context="Категория: wip" current="SPEC-1" />);
    const nav = screen.getByRole('navigation', { name: 'Путь к записи' });
    const link = within(nav).getByRole('link', { name: /Спеки · Категория: wip/ });
    expect(link.getAttribute('href')).toBe('/?sec=spec&lf=x');
    expect(within(nav).getByText('SPEC-1').getAttribute('aria-current')).toBe('page');
  });

  it('без href — кнопка с onBack (возврат обработчиком приложения)', () => {
    const onBack = vi.fn();
    render(<RecordCrumbs back={{ label: 'Спринты', onClick: onBack }} current="S-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Спринты/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('RecordReader: крошки и пейджер одной строкой', () => {
  it('строка над записью: слева крошки, справа пейджер и «Свойства»', () => {
    const onAside = vi.fn();
    render(
      <RecordReader record={record} ctx={ctx} tab="overview" onTab={() => {}}
        crumbs={<RecordCrumbs back={{ label: 'Спеки', href: '#list' }} current="SPEC-1" />}
        pager={<RecordPager ids={['SPEC-1', 'SPEC-2']} current="SPEC-1" onGo={() => {}} />}
        aside={<p>свойства</p>} asideOpen={false} onAside={onAside} />,
    );
    const bar = screen.getByTestId('kit-rec-bar');
    const kids = [...bar.children];
    expect(kids[0].querySelector('nav[aria-label="Путь к записи"]')).not.toBeNull();
    expect(within(bar).getByRole('navigation', { name: /Листать/ })).toBeTruthy();
    const props = within(bar).getByRole('button', { name: 'Свойства' });
    expect(props.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(props);
    expect(onAside).toHaveBeenCalledWith(true);
  });

  it('без крошек и пейджера строки нет — пустая полоса не занимает экран', () => {
    render(<RecordReader record={record} ctx={ctx} tab="overview" onTab={() => {}} asideOpen={false} onAside={() => {}} />);
    expect(screen.queryByTestId('kit-rec-bar')).toBeNull();
  });
});

describe('CSS: на телефоне крошки сокращаются до «← ID»', () => {
  it('контекст фильтра скрыт в узком медиа-блоке', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    expect(css).toMatch(/\.sk-crumbs\s*\{/); // положительный контроль
    expect(css).toMatch(/@media \(max-width: 720px\)[^{]*\{[^@]*\.sk-crumbs__ctx[^}]*display:\s*none/);
  });
});

// B7 ревью владелицы 10.11.2026: «Крошка „← Раздел“ в паспорте зачёркнута —
// выглядит как удалённая запись». Зачёркивания в правилах крошек нет: линию
// даёт `text-decoration: underline`, заданный САМОМУ flex-контейнеру
// .sk-crumbs__back (inline-flex + min-height: max(var(--tap), 22px) +
// align-items: center). У flex-контейнера позиция линии считается от базовой
// линии бокса, а текст центрированием сдвинут вниз, и линия проходит по
// глифам. Blink линию пробрасывает во flex-элементы и рисует верно, WebKit
// рисует её самим боксом — отсюда «зачёркнуто» на телефоне.
// Правило, а не случай: НИ ОДИН flex-бокс крошек не носит text-decoration;
// линия живёт на инлайновом потомке, где её положение задаёт сам текст.
describe('CSS: крошка-возврат нигде не выглядит зачёркнутой (B7)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');
  // Плоский разбор: @media-обёртки снимаем, их `}` остаются сиротами и в
  // селекторы не попадают (`[^{}]`).
  const rules = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ sel: m[1].trim(), body: m[2] }));
  const crumbs = rules.filter(r => r.sel.includes('.sk-crumbs'));
  const drawsLine = (body: string) => /text-decoration(-line)?:\s*(?![^;]*none)[^;]*(underline|line-through|overline)/.test(body);

  it('положительный контроль: правила крошек найдены, а зачёркивание в файле вообще ловится', () => {
    expect(crumbs.length).toBeGreaterThan(3);
    // Намеренное зачёркивание (удалённый кусок диффа, прежнее значение в журнале) — есть и остаётся.
    expect(rules.filter(r => /line-through/.test(r.body)).length).toBeGreaterThan(0);
  });

  it('ни одно правило крошек не зачёркивает текст', () => {
    expect(crumbs.filter(r => /line-through/.test(r.body)).map(r => r.sel)).toEqual([]);
  });

  it('линию рисует не flex-контейнер крошек, а инлайновый потомок', () => {
    expect(crumbs.filter(r => /display:\s*(inline-)?flex/.test(r.body) && drawsLine(r.body)).map(r => r.sel)).toEqual([]);
  });

  // Вторая половина правила пришла из параллельной правки соседней сессии и
  // здесь сведена с первой: ПОСТОЯННОЙ декорации у крошки нет вовсе (канон
  // ссылок kit — none, подчёркивание на наведении). Одна проверка без другой
  // неполна: без первой линия вернулась бы на hover тем же боксом и снова
  // пошла бы по глифам; без второй крошка носила бы неубираемую линию.
  it('постоянного подчёркивания нет — оно появляется только на наведении', () => {
    const always = crumbs.filter(r => !/:hover|:focus/.test(r.sel) && drawsLine(r.body)).map(r => r.sel);
    expect(always, 'крошка носит декорацию постоянно').toEqual([]);
    const hover = crumbs.filter(r => /:hover/.test(r.sel) && drawsLine(r.body)).map(r => r.sel);
    expect(hover, 'подчёркивания на наведении нет вовсе').not.toEqual([]);
  });

  it('и на наведении линию рисует подпись, а не flex-бокс', () => {
    const hover = crumbs.filter(r => /:hover/.test(r.sel) && drawsLine(r.body));
    expect(hover.map(r => r.sel).every(sel => sel.includes('__label')),
      `линия на наведении задана боксом: ${hover.map(r => r.sel).join(', ')}`).toBe(true);
  });

  it('цвет ссылки-возврата — токен темы, а не сырой цвет', () => {
    // Селектор ищем ВХОЖДЕНИЕМ: плоский разбор тащит в него предшествующий
    // комментарий, и сравнение на равенство правило не находило — проверка
    // шла по пустой строке, то есть ни по чему.
    const back = crumbs.find(r => r.sel.includes('.sk-crumbs__back') && /color:/.test(r.body));
    expect(back, 'правило .sk-crumbs__back с цветом не найдено').toBeTruthy();
    expect(back!.body).toMatch(/color:\s*var\(--acc\)/);
  });
});

describe('RecordCrumbs: подпись возврата — один инлайновый узел', () => {
  it('стрелка, раздел и контекст лежат в .sk-crumbs__label одной строкой (пробелы не съедены)', () => {
    render(<RecordCrumbs back={{ label: 'Спеки', href: '#list' }} context="Категория: wip" current="SPEC-1" />);
    const label = screen.getByRole('link').querySelector('.sk-crumbs__label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('← Спеки · Категория: wip');
    // Контекст по-прежнему отдельным узлом: на телефоне его прячет медиа-правило.
    expect(label!.querySelector('.sk-crumbs__ctx')).not.toBeNull();
  });
});
