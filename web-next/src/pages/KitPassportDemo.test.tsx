// @vitest-environment jsdom
// Витрина /kit, шаг 7 K5-PASSPORT-FROM-MODEL: паспорт из документа чужого приложения без своего
// рендера. Проверяется, что раскладка документа дошла до экрана: часть — вкладкой со счётом,
// ассоциация — вкладкой kit, свойство-флаг — словами.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { KitPassportDemo } from './KitPassportDemo';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('KitPassportDemo', () => {
  it('тропа: заголовок, часть «Свитки 3», ассоциация «Квизы», без ошибок', () => {
    render(<KitLangProvider lang="ru"><KitPassportDemo lang="ru" /></KitLangProvider>);
    const box = screen.getByTestId('kit-passport-demo');
    expect(box.textContent).toContain('Время — Непрерывность');
    const tabs = [...box.querySelectorAll('[role="tab"]')].map(t => t.textContent?.replace(/\s+/g, ' ').trim());
    expect(tabs.some(t => t?.startsWith('Свитки') && t.includes('3'))).toBe(true);
    expect(tabs.some(t => t?.includes('Квизы') || t?.includes('Зависимости'))).toBe(true);
    expect(box.querySelector('[role="alert"]')).toBeNull();
  });

  it('K5-EDGE-PROPS-COLUMNS: у квизов колонки свойств ребра, квиз на тропе дважды — две строки с разными значениями', () => {
    render(<KitLangProvider lang="ru"><KitPassportDemo lang="ru" /></KitLangProvider>);
    const box = screen.getByTestId('kit-passport-demo');
    const tab = [...box.querySelectorAll('[role="tab"]')].find(t => /Квизы|Зависимости/.test(t.textContent ?? ''))!;
    fireEvent.click(tab);
    const heads = [...box.querySelectorAll('th')].map(th => th.textContent ?? '');
    expect(heads.some(h => h.includes('Место на тропе'))).toBe(true);
    expect(heads.some(h => h.includes('Сторона'))).toBe(true);
    const rows = [...box.querySelectorAll('tbody tr[data-record-id="Q-1"]')].map(r => r.textContent ?? '');
    expect(rows.length).toBe(2);
    expect(rows.some(r => r.includes('0.15') && r.includes('A'))).toBe(true);
    expect(rows.some(r => r.includes('0.75') && r.includes('B'))).toBe(true);
  });
});
