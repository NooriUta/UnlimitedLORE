// @vitest-environment jsdom
// Панель «Вид» и обои (SPRINT_UXR_S15_KIT6; владелица 21.11.2026: «доделай», пункт 3 — «Панель «Вид» и обои с
// узорами»). Обои — фото приложения или своя картинка, асимметрия (слева/центр/справа), затемнение; узоры — из
// мобилки miniLORE: перелив четырьмя пятнами палитры по кругу из восьми точек, плотные шестерёнки, паркет.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ViewPanel, WallpaperFrame, meshPoints, parquetTile, denseGearsTile, wallpaperLayer, readWallpaper, writeWallpaper } from '.';

afterEach(() => { cleanup(); localStorage.clear(); for (const a of ['data-mode', 'data-theme', 'data-font']) document.documentElement.removeAttribute(a); });

describe('обои: слой и хранение', () => {
  it('нет картинки — нет слоя; асимметрия — позиция; затемнение в 0..0.9', () => {
    expect(wallpaperLayer({ src: null, pos: 'center', dim: 0.5 })).toBeNull();
    expect(wallpaperLayer({ src: '/a.jpg', pos: 'left', dim: 2 })).toEqual({ backgroundImage: 'url("/a.jpg")', backgroundPosition: '15% 50%', dim: 0.9 });
  });
  it('выбор хранится под ключом приложения', () => {
    writeWallpaper('app', { src: '/b.jpg', pos: 'right', dim: 0.4, skin: 'none' });
    expect(readWallpaper('app').src).toBe('/b.jpg');
    expect(readWallpaper('other').src).toBeNull();
  });
  it('WallpaperFrame рисует картинку под содержимым', () => {
    writeWallpaper('app', { src: '/b.jpg', pos: 'right', dim: 0.4, skin: 'none' });
    const { container } = render(<WallpaperFrame storageKey="app"><p>плитки</p></WallpaperFrame>);
    expect((container.querySelector('.sk-wall__photo') as HTMLElement).style.backgroundImage).toContain('/b.jpg');
    expect(screen.getByText('плитки')).toBeTruthy();
  });
  it('узор — слой перелива с узором; без картинки', () => {
    writeWallpaper('app', { src: null, pos: 'right', dim: 0.4, skin: 'parquet' });
    const { container } = render(<WallpaperFrame storageKey="app"><p>x</p></WallpaperFrame>);
    expect(container.querySelector('.sk-wall__skin')).toBeTruthy();
    expect(container.querySelector('pattern')).toBeTruthy();
  });
});

describe('узоры из мобилки', () => {
  it('перелив: четыре пятна, фаза 8 = фаза 0', () => {
    expect(meshPoints(0)).toEqual([[0.80, 0.10], [0.35, 0.25], [0.20, 0.90], [0.65, 0.75]]);
    expect(meshPoints(8)).toEqual(meshPoints(0));
  });
  it('плитки детерминированы', () => {
    expect(parquetTile()).toBe(parquetTile());
    expect(denseGearsTile().length).toBeGreaterThan(1000);
  });
});

describe('Пара шрифтов (как в мобилке miniLORE)', () => {
  it('выбор пары ставит data-font на корень и запоминается; шрифты — переменными, не зашиты', () => {
    render(<ViewPanel storageKey="app" />);
    fireEvent.click(screen.getByRole('button', { name: /Только IBM Plex Mono|IBM Plex Mono only/ }));
    expect(document.documentElement.getAttribute('data-font')).toBe('mono');
    expect(JSON.parse(localStorage.getItem('app.view') ?? '{}').font).toBe('mono');
    fireEvent.click(screen.getByRole('button', { name: /контрастная пара|contrast pair/ }));
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
  });
});

describe('ViewPanel', () => {
  it('режим светлый/тёмный ставит атрибут корня и запоминается', () => {
    render(<ViewPanel storageKey="app" />);
    fireEvent.click(screen.getByRole('button', { name: /светл|light/i }));
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    expect(JSON.parse(localStorage.getItem('app.view') ?? '{}').mode).toBe('light');
  });
  it('обои — фото приложения как варианты выбора', () => {
    render(<ViewPanel storageKey="app" photos={[{ id: 'kitchen', src: '/k.jpg', label: 'Кухня' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Кухня' }));
    expect(readWallpaper('app').src).toBe('/k.jpg');
  });
});
