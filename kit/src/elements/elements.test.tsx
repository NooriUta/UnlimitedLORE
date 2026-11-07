// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00b — базовые элементы Seiðr-kit: у каждого
// рендер-тест и axe-проверка. Кирпичи общие для каркаса, списков, записи,
// новостей и админки: экран не рисует их сам (D-2026-UXR-KIT-REACT).
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import {
  GameIcon, IconButton, KNOWN_STATUSES, Kbd, Pill, Chip, SECTION_ICONS, STATUS_CATEGORIES,
  StatusStar, Toolbar, Tooltip, registerGameIcons, statusMeta,
} from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

describe('axe — положительный контроль (иначе «0 нарушений» не отличить от слепой проверки)', () => {
  it('безымянная кнопка-иконка ловится', async () => {
    const { container } = render(<div><button type="button"><svg aria-hidden="true" /></button></div>);
    expect((await axeViolations(container)).join('\n')).toMatch(/button-name/);
  });
});

describe('Pill / Chip — скругление 999, варианты фильтр · значение · ID', () => {
  it('значение: обычная пилюля с классом варианта, Chip — тот же элемент', async () => {
    const { container } = render(<Pill>в работе</Pill>);
    const el = screen.getByText('в работе');
    expect(el.className).toMatch(/\bsk-pill\b/);
    expect(el.className).toMatch(/\bsk-pill--value\b/);
    expect(Chip).toBe(Pill);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('ID-пилюля — моноширинная, текст как есть', async () => {
    const { container } = render(<Pill variant="id">S4-00b</Pill>);
    expect(screen.getByText('S4-00b').className).toMatch(/\bsk-pill--id\b/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('фильтр — кнопка с aria-pressed; переключается; крестик снимает со своим именем', async () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(
      <Pill variant="filter" pressed onToggle={onToggle} onRemove={onRemove} removeLabel="Снять фильтр «активные»">
        активные
      </Pill>,
    );
    const btn = screen.getByRole('button', { name: 'активные' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр «активные»' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('тон статуса окрашивает пилюлю токеном, а не сырым цветом', () => {
    render(<Pill tone="dng">ошибка</Pill>);
    expect(screen.getByText('ошибка').style.getPropertyValue('--pill-c')).toBe('var(--dng)');
  });
});

describe('IconButton — цель ≥44px на касании, видимый фокус, имя обязательно', () => {
  it('кнопка с aria-label и подсказкой, иконка внутри скрыта от чтения', async () => {
    const onClick = vi.fn();
    const { container } = render(<IconButton icon="funnel" label="Фильтр" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Фильтр' });
    expect(btn.className).toMatch(/\bsk-iconbtn\b/);
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('title')).toBe('Фильтр');
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('клавиша — aria-keyshortcuts и в подсказке; переключатель — aria-pressed', async () => {
    const { container } = render(<IconButton icon="funnel" label="Фильтр" shortcut="F" pressed={false} />);
    const btn = screen.getByRole('button', { name: 'Фильтр' });
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('F');
    expect(btn.getAttribute('title')).toBe('Фильтр (F)');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('пустое имя — громкая ошибка, а не безымянная кнопка', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<IconButton icon="funnel" label="  " />)).toThrow(/label/);
    err.mockRestore();
  });
});

describe('GameIcon — game-icons через Iconify (офлайн), канонические слаги разделов', () => {
  it('рисует svg известного слага; декоративная скрыта от чтения', async () => {
    const { container } = render(<GameIcon slug="compass" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('с подписью — role=img и имя', async () => {
    const { container } = render(<GameIcon slug="raven" label="Исследования" />);
    expect(screen.getByRole('img', { name: 'Исследования' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('неизвестный слаг — честная заглушка того же размера, помеченная data-missing', () => {
    const { container } = render(<GameIcon slug="no-such-icon-xyz" size={16} />);
    const ph = container.querySelector('[data-missing]');
    expect(ph).not.toBeNull();
    expect(ph!.getAttribute('data-missing')).toBe('no-such-icon-xyz');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('канонические слаги разделов существуют в наборе game-icons', () => {
    const known = new Set(Object.keys((gameIcons as { icons: Record<string, unknown> }).icons));
    const missing = Object.entries(SECTION_ICONS).filter(([, slug]) => !known.has(slug));
    expect(missing).toEqual([]);
    expect(SECTION_ICONS.projects).toBe('compass');
  });
});

describe('StatusStar — категория и цвет статуса (D-2026-UXR-STATUS-AXIS)', () => {
  it('статус → категория, иконка и свой цвет --st-*', () => {
    expect(statusMeta('done')).toMatchObject({ category: 'done', color: 'var(--st-done)', icon: 'divided-spiral' });
    expect(statusMeta('IN_PROGRESS')).toMatchObject({ category: 'active', color: 'var(--st-active)' });
    expect(statusMeta('blocked').category).toBe('blocked');
    // неизвестный — не «тихо todo», а своя категория unknown
    expect(statusMeta('weird')).toMatchObject({ category: 'unknown', color: 'var(--t3)' });
    expect(STATUS_CATEGORIES).toEqual(['backlog', 'planned', 'active', 'review', 'done', 'blocked', 'closed', 'unknown']);
  });

  it('иконка каждого статуса (и unknown) есть в наборе game-icons — звезда не бывает пустой', () => {
    const known = new Set(Object.keys((gameIcons as { icons: Record<string, unknown> }).icons));
    const icons = [...KNOWN_STATUSES, 'zzz-unknown'].map(s => statusMeta(s).icon);
    expect(icons.filter(i => !known.has(i))).toEqual([]);
  });

  it('только показ — role=img с именем; цвет и категория на элементе', async () => {
    const { container } = render(<StatusStar status="done" label="Статус: готово" />);
    const el = screen.getByRole('img', { name: 'Статус: готово' });
    expect(el.getAttribute('data-category')).toBe('done');
    expect(el.style.getPropertyValue('--star-c')).toBe('var(--st-done)');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('со сменой — кнопка, открывающая палитру (aria-haspopup), с подписью текста', async () => {
    const onOpen = vi.fn();
    const { container } = render(<StatusStar status="active" label="Статус: в работе" showLabel onOpen={onOpen} />);
    const btn = screen.getByRole('button', { name: 'Статус: в работе' });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.className).toMatch(/\bsk-star\b/);
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Kbd — подсказка клавиши рядом с кнопкой (D-2026-UXR-KEYBOARD-LAYER)', () => {
  it('сочетание — по <kbd> на клавишу; подсказка скрыта от чтения (имя несёт кнопка)', async () => {
    const { container } = render(<button type="button" aria-keyshortcuts="Control+K">Команды <Kbd keys={['Ctrl', 'K']} /></button>);
    const hint = container.querySelector('.sk-kbd')!;
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    expect([...hint.querySelectorAll('kbd')].map(k => k.textContent)).toEqual(['Ctrl', 'K']);
    expect(screen.getByRole('button', { name: 'Команды' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Tooltip — подсказка по наведению и фокусу, Esc закрывает', () => {
  it('фокус показывает role=tooltip и связывает его через aria-describedby', async () => {
    const { container } = render(
      <Tooltip text="Скопировать ID"><button type="button">ID</button></Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'ID' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(btn);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Скопировать ID');
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('наведение показывает, уход — прячет', () => {
    render(<Tooltip text="Подсказка"><button type="button">X</button></Tooltip>);
    const btn = screen.getByRole('button', { name: 'X' });
    fireEvent.mouseEnter(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Toolbar — role=toolbar, имя, стрелки водят фокус (один таб-стоп)', () => {
  it('один таб-стоп, ←/→/Home/End двигают фокус', async () => {
    const { container } = render(
      <Toolbar label="Действия над выделенными">
        <IconButton icon="funnel" label="Фильтр" />
        <IconButton icon="cycle" label="Порядок" />
        <IconButton icon="trash-can" label="Удалить" />
      </Toolbar>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Действия над выделенными' });
    const [a, b, c] = screen.getAllByRole('button');
    expect([a, b, c].map(x => x.tabIndex)).toEqual([0, -1, -1]);
    a.focus();
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b);
    expect([a, b, c].map(x => x.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(bar, { key: 'End' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(bar, { key: 'Home' });
    expect(document.activeElement).toBe(a);
    expect(await axeViolations(container)).toEqual([]);
  });
});
