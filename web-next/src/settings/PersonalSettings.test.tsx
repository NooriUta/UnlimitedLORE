// SPRINT_UXR_S3_V2_INFRA/S3-07 — переключатель «новая навигация» в личных настройках v2.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../App';
import { NavSwitch } from './NavSwitch';
import { PersonalSettings } from './PersonalSettings';
import { MESSAGES } from '../i18n/messages';

describe('S3-07: переключатель «новая навигация»', () => {
  it('в v2 включён и подписан ru-строкой', () => {
    const html = renderToString(<NavSwitch lang="ru" targetUrl="https://lore.odal.seidrstudio.pro/" />);
    expect(html).toContain(MESSAGES.ru['settings.nav.label']);
    expect(html).toContain('checked');
    expect(html).toContain('data-nav-switch="v2"');
    expect(html).not.toContain('disabled');
  });

  it('en-подпись берётся из en-словаря', () => {
    const html = renderToString(<NavSwitch lang="en" targetUrl="https://lore.odal.seidrstudio.pro/" />);
    expect(html).toContain(MESSAGES.en['settings.nav.label']);
  });

  it('без адреса пары (localhost/IP) переключатель выключен и честно говорит почему', () => {
    const html = renderToString(<NavSwitch lang="ru" targetUrl={null} />);
    expect(html).toContain('disabled');
    expect(html).toContain(MESSAGES.ru['settings.nav.unavailable']);
  });

  it('личные настройки входят в оболочку v2', () => {
    const html = renderToString(<App />);
    expect(html).toContain('data-nav-switch="v2"');
  });
});

describe('S5-05: настройки режима чтения в личных настройках', () => {
  it('размер текста и «сворачивать меню при чтении» — блоком kit ReadingSettings', () => {
    const html = renderToString(<PersonalSettings lang="ru" />);
    expect(html).toContain('data-reading-settings');
    expect(html).toContain('Сворачивать меню при чтении');
    expect(html).toContain('Размер текста');
  });
});

describe('S3-07: словари ru/en v2 совпадают по ключам', () => {
  it('у каждого ключа есть обе локали и непустой текст', () => {
    const ru = Object.keys(MESSAGES.ru).sort();
    const en = Object.keys(MESSAGES.en).sort();
    expect(ru.length).toBeGreaterThan(0);
    expect(en).toEqual(ru);
    for (const k of ru) {
      expect(MESSAGES.ru[k as keyof typeof MESSAGES.ru].trim()).not.toBe('');
      expect(MESSAGES.en[k as keyof typeof MESSAGES.en].trim()).not.toBe('');
    }
  });
});
