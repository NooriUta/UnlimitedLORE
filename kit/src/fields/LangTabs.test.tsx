// @vitest-environment jsdom
// LangTabs — тексты на нескольких языках (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Повод: замечание владелицы 18.11.2026 «нет экрана … локализации описания». Тексты поля и типа модели
// есть на RU/EN/PL; пустой перевод — не «пусто», а «нет перевода, показывается язык по умолчанию»,
// и это видно на самой вкладке языка, а не только внутри.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { LangTabs } from './LangTabs';

const LANGS = [{ id: 'ru', label: 'RU' }, { id: 'en', label: 'EN', missing: true }, { id: 'pl', label: 'PL' }];

describe('LangTabs', () => {
  it('вкладка на язык, выбранная — aria-selected; переключение зовёт onChange', () => {
    const onChange = vi.fn();
    render(<KitLangProvider lang="ru"><LangTabs label="Язык текстов" langs={LANGS} value="ru" onChange={onChange}>панель</LangTabs></KitLangProvider>);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent?.replace('•', '').trim())).toEqual(['RU', 'EN', 'PL']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[2]);
    expect(onChange).toHaveBeenCalledWith('pl');
    expect(screen.getByRole('tabpanel').textContent).toContain('панель');
  });

  it('язык без перевода помечен словами, а не только точкой', () => {
    render(<KitLangProvider lang="ru"><LangTabs label="Язык" langs={LANGS} value="ru" onChange={vi.fn()} /></KitLangProvider>);
    const en = screen.getByRole('tab', { name: /EN/ });
    expect(en.hasAttribute('data-missing')).toBe(true);
    expect(en.getAttribute('aria-label')).toContain('нет перевода');
  });

  it('стрелки двигают выбор по кругу', () => {
    const onChange = vi.fn();
    render(<KitLangProvider lang="ru"><LangTabs label="Язык" langs={LANGS} value="pl" onChange={onChange} /></KitLangProvider>);
    fireEvent.keyDown(screen.getByRole('tab', { name: /PL/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('ru');
    fireEvent.keyDown(screen.getByRole('tab', { name: /PL/ }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('en');
  });

  it('ключ локализации подписан', () => {
    render(<KitLangProvider lang="ru"><LangTabs label="Язык" langs={LANGS} value="ru" onChange={vi.fn()} i18nKey="pp.field.title" /></KitLangProvider>);
    expect(screen.getByText(/ключ локализации/).textContent).toContain('pp.field.title');
  });

  it('английская локаль', () => {
    render(<KitLangProvider lang="en"><LangTabs label="Lang" langs={LANGS} value="ru" onChange={vi.fn()} i18nKey="k" /></KitLangProvider>);
    expect(screen.getByRole('tab', { name: /EN/ }).getAttribute('aria-label')).toContain('no translation');
    expect(screen.getByText(/localization key/)).toBeTruthy();
  });
});
