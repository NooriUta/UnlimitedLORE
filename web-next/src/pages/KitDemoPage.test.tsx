// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-03 — демо kit на фикстурах: /kit/demo/lore и
// /kit/demo/datawanderers рисуют listView из пакета @seidr/kit без правки kit.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { routeOf } from '../App';
import KitDemoPage from './KitDemoPage';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('маршруты демо kit', () => {
  it('/kit/demo/lore и /kit/demo/datawanderers (с хвостовым «/» тоже)', () => {
    expect(routeOf('/kit/demo/lore')).toBe('kit-demo-lore');
    expect(routeOf('/kit/demo/datawanderers/')).toBe('kit-demo-datawanderers');
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/kit/demo/nope')).toBe('home');
  });
});

describe('демо-страницы', () => {
  it('«Дата-странники»: честное «Показано 181 из 240» из meta.truncated', () => {
    render(<KitDemoPage which="datawanderers" urlState={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Дата-странники');
    expect(screen.getByTestId('kit-list-shown').textContent).toContain('Показано 181 из 240');
  });

  it('LORE: полная выдача', () => {
    render(<KitDemoPage which="lore" urlState={false} />);
    expect(screen.getByTestId('kit-list-shown').textContent).toBe('Показано 260 из 260');
  });
});
