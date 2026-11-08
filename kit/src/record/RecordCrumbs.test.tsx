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
