// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02 — меню аватара в оболочке kit и общий
// «сегментный» выбор для строк личных настроек. Сами настройки и их хранение —
// у приложения (web-next, контракт S2); kit даёт кнопку-аватар с листом,
// слот в шапке KitShell, ряд «подпись + сегменты» и атрибуты корня под
// размер текста и цветные полоски.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import {
  AvatarMenu, KitShell, SettingRow, Segmented, avatarInitials, createSafeStorage, displayAttrs, applyDisplay,
  registerGameIcons, KitLangProvider, TEXT_SIZES,
} from '../index';
import type { KitConfig } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: { groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты' }] }] },
  kinds: {},
  statuses: { items: [] },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w;
}

describe('avatarInitials', () => {
  it('две буквы из имени и фамилии, одна — из логина, заглавные', () => {
    expect(avatarInitials('Ольга Летописец')).toBe('ОЛ');
    expect(avatarInitials('omiloreadmin')).toBe('O');
    expect(avatarInitials('  anna  maria  lind ')).toBe('AM');
  });
  it('пустое имя — пустые инициалы (кнопка рисует иконку, а не «?»)', () => {
    expect(avatarInitials('')).toBe('');
    expect(avatarInitials(undefined)).toBe('');
  });
});

describe('AvatarMenu — кнопка-аватар открывает лист личного', () => {
  it('кнопка: инициалы, имя в aria-label, aria-haspopup=dialog; лист закрыт', () => {
    render(<AvatarMenu name="Ольга Летописец"><p>содержимое</p></AvatarMenu>);
    const btn = screen.getByRole('button', { name: /Ольга Летописец/ });
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toContain('ОЛ');
    expect(btn.className).toMatch(/\bsk-avatar\b/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('клик открывает диалог с шапкой (имя, подпись) и содержимым; Esc закрывает и возвращает фокус', () => {
    const onOpenChange = vi.fn();
    render(
      <AvatarMenu name="Ольга Летописец" subtitle="владелица · owner" onOpenChange={onOpenChange}>
        <button type="button">пункт</button>
      </AvatarMenu>,
    );
    const btn = screen.getByRole('button', { name: /Ольга Летописец/ });
    btn.focus();
    fireEvent.click(btn);
    const dlg = screen.getByRole('dialog', { name: 'Личные настройки' });
    expect(within(dlg).getByText('Ольга Летописец')).toBeTruthy();
    expect(within(dlg).getByText('владелица · owner')).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: 'пункт' })).toBeTruthy();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(btn);
  });

  it('без имени — иконка и честное имя «Пользователь не опознан», а не пустая кнопка', () => {
    render(<AvatarMenu><p>x</p></AvatarMenu>);
    const btn = screen.getByRole('button', { name: /Пользователь не опознан/ });
    expect(btn.querySelector('.sk-avatar__initials')).toBeNull();
  });

  it('en: подписи из словаря kit', () => {
    render(<KitLangProvider lang="en"><AvatarMenu name="Olga"><p>x</p></AvatarMenu></KitLangProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Olga/ }));
    expect(screen.getByRole('dialog', { name: 'Personal settings' })).toBeTruthy();
  });

  it('axe: открытый лист без нарушений', async () => {
    render(
      <AvatarMenu name="Ольга Летописец">
        <SettingRow label="Плотность">
          <Segmented label="Плотность" value="compact" options={[{ value: 'compact', label: 'компактно' }, { value: 'comfortable', label: 'просторно' }]} onChange={() => {}} />
        </SettingRow>
      </AvatarMenu>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ольга/ }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Segmented — выбор одного из нескольких', () => {
  const OPTS = [{ value: 'sm', label: 'мельче' }, { value: 'md', label: 'обычный' }, { value: 'lg', label: 'крупнее' }] as const;

  it('role=group с именем, кнопки с aria-pressed по значению', () => {
    render(<Segmented label="Размер текста" value="md" options={OPTS} onChange={() => {}} />);
    const grp = screen.getByRole('group', { name: 'Размер текста' });
    const btns = within(grp).getAllByRole('button');
    expect(btns.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(btns[1].className).toMatch(/\bis-on\b/);
  });

  it('клик по другому значению зовёт onChange, по текущему — нет', () => {
    const onChange = vi.fn();
    render(<Segmented label="Размер текста" value="md" options={OPTS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'обычный' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'крупнее' }));
    expect(onChange).toHaveBeenCalledWith('lg');
  });

  it('disabled — все кнопки недоступны (идёт сохранение)', () => {
    render(<Segmented label="Размер текста" value="md" options={OPTS} onChange={() => {}} disabled />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SettingRow — подпись, подсказка, управление', () => {
  it('подпись и подсказка видны; управление внутри строки', () => {
    render(<SettingRow label="Цветные полоски" hint="статусы на досках"><button type="button">вкл</button></SettingRow>);
    const row = screen.getByText('Цветные полоски').closest('.sk-setting')!;
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('статусы на досках')).toBeTruthy();
    expect(within(row as HTMLElement).getByRole('button', { name: 'вкл' })).toBeTruthy();
  });
});

describe('KitShell — слот аккаунта в шапке', () => {
  it('account рисуется в шапке оболочки (header), справа от модулей', () => {
    const mem = new Map<string, string>();
    const storage = createSafeStorage(() => ({
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); },
    }) as unknown as Storage);
    const { container } = render(
      <KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false} account={<AvatarMenu name="Ольга Летописец"><p>x</p></AvatarMenu>} />,
    );
    const top = container.querySelector('.sk-shell__top')!;
    const acc = top.querySelector('.sk-shell__account');
    expect(acc).toBeTruthy();
    expect(within(acc as HTMLElement).getByRole('button', { name: /Ольга Летописец/ })).toBeTruthy();
  });
});

describe('displayAttrs — размер текста и полоски на корне', () => {
  it('умолчания (md, полоски вкл) — атрибуты сняты', () => {
    expect(displayAttrs({ textSize: 'md', stripes: true })).toEqual({ 'data-text-size': null, 'data-stripes': null });
  });
  it('мельче/крупнее и полоски выкл — атрибуты стоят', () => {
    expect(displayAttrs({ textSize: 'lg', stripes: false })).toEqual({ 'data-text-size': 'lg', 'data-stripes': 'off' });
    expect(displayAttrs({ textSize: 'sm', stripes: true })['data-text-size']).toBe('sm');
  });
  it('applyDisplay ставит и снимает атрибуты элемента', () => {
    const el = document.createElement('div');
    applyDisplay(el, { textSize: 'lg', stripes: false });
    expect(el.getAttribute('data-text-size')).toBe('lg');
    expect(el.getAttribute('data-stripes')).toBe('off');
    applyDisplay(el, { textSize: 'md', stripes: true });
    expect(el.hasAttribute('data-text-size')).toBe(false);
    expect(el.hasAttribute('data-stripes')).toBe(false);
  });
  it('TEXT_SIZES — sm, md, lg, xl; md — умолчание', () => {
    // xl добавлен 09.11.2026 по словам владелицы: «у меня 4к и все мелкое»,
    // а шкала заканчивалась на lg. Значение не новое для системы — боевой
    // сервер личных настроек его уже знал (контракт S2), и v2 показывал
    // умолчание вместо выбранного. Шкала и её порядок — textSizeXl.test.ts.
    expect(TEXT_SIZES).toEqual(['sm', 'md', 'lg', 'xl']);
  });
});

describe('seidr.css — правила под размер текста и полоски', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles', 'seidr.css'), 'utf8');
  it('мельче и крупнее переопределяют шкалу --fs-* целиком, а не один размер', () => {
    for (const size of ['sm', 'lg']) {
      const block = css.match(new RegExp(`\\[data-text-size='${size}'\\]\\s*\\{([^}]*)\\}`));
      expect(block, `нет блока [data-text-size='${size}']`).toBeTruthy();
      for (const step of ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl']) {
        expect(block![1]).toContain(step);
      }
    }
  });
  it('полоски выкл гасят цветную кромку колонок доски', () => {
    expect(css).toMatch(/\[data-stripes='off'\]\s*\.sk-board__col\s*\{/);
  });
});
