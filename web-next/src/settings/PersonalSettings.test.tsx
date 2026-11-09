// SPRINT_UXR_S3_V2_INFRA/S3-07 — переключатель «новая навигация» в личных настройках v2.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../App';
import { NavSwitch } from './NavSwitch';
import { MESSAGES } from '../i18n/messages';
import { PersonalSettings } from './PersonalSettings';
import { DEFAULT_SETTINGS } from '../api/contracts/s2';

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

  it('раздел «Настройки» (S4-01, ?sec=settings) — переключатель навигации и витрина kit', () => {
    const win = {
      location: { pathname: '/', search: '?sec=settings', hash: '' },
      history: { pushState: () => {}, replaceState: () => {} },
    };
    const html = renderToString(<App path="/" win={win} />);
    expect(html).toContain('data-nav-switch="v2"');
    expect(html).toContain('href="/kit"');
  });

  // S4-02: личные настройки переехали под аватар в шапке — переключатель
  // навигации остаётся в их списке (и при сбое чтения остальных настроек).
  it('личные настройки входят в оболочку v2 — под аватаром, с переключателем навигации', () => {
    expect(renderToString(<App />)).toContain('sk-avatar');
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    for (const state of [ok, { status: 'error' as const, error: new Error('x') }]) {
      const html = renderToString(<PersonalSettings lang="ru" state={state} onChange={() => {}} navTargetUrl={null} />);
      expect(html).toContain('data-nav-switch="v2"');
    }
  });
});

describe('S5-14: про одно и то же в панели — ОДНА строка, а не две', () => {
  // Находка CJM на проде 09.11.2026: владелица видела «Меню при чтении записи:
  // не сворачивать» и тут же ниже включённую галочку «Сворачивать меню при
  // чтении» — два блока про одно, и оба мёртвые (блок kit настраивал
  // ReadingView, которого в v2 нет; строки контракта ложились атрибутами,
  // которые никто не читал). Прежний тест требовал ВТОРОЙ блок, то есть
  // закреплял саму поломку; теперь он требует его отсутствия.
  it('блока режима чтения из kit в панели нет', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    const html = renderToString(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(html).not.toContain('data-reading-settings');
    expect(html).not.toContain('Сворачивать меню при чтении');
  });

  it('про меню при чтении и про правую колонку осталось по одной строке', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    const html = renderToString(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    // Считаем ВИДИМЫЕ подписи: у переключателя та же строка идёт ещё и в
    // aria-label, и по простому поиску по тексту их было бы две на одну строку.
    const visible = (text: string) => html.match(new RegExp(`sk-setting__label[^>]*>${text}`, 'g'))?.length ?? 0;
    expect(visible('Меню при чтении записи')).toBe(1);
    expect(visible('Правая колонка записи')).toBe(1);
  });

  it('размер текста назван как общий для интерфейса — чтобы не путать с Aa чтения', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    const html = renderToString(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(html).toContain('Размер текста во всём интерфейсе');
    // И шаг «очень крупно» есть: «у меня 4к и все мелкое» (S4-16).
    expect(html).toContain('очень крупно');
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

// S5-14: сервер может хранить значение, которого в v2 нет (theme: system,
// text_size: xl). Показать умолчание и промолчать значило бы соврать о том,
// что выбрано, поэтому расхождение видно на экране настроек.
describe('S5-14: расхождение перевода настроек видно', () => {
  const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };

  it('предупреждение перевода печатается текстом', () => {
    const html = renderToString(
      <PersonalSettings lang="ru" state={{ ...ok, warnings: ['theme: сервер хранит «system», такого значения в v2 нет — показано умолчание'] }}
        onChange={() => {}} onRetry={() => {}} onOpenMemory={() => {}} navTargetUrl={null} />,
    );
    expect(html).toContain('system');
    expect(html).toContain('settings-warn');
  });

  it('расхождений нет — блока нет (пустой список не рисуем)', () => {
    const html = renderToString(
      <PersonalSettings lang="ru" state={{ ...ok, warnings: [] }}
        onChange={() => {}} onRetry={() => {}} onOpenMemory={() => {}} navTargetUrl={null} />,
    );
    expect(html).not.toContain('settings-warn');
  });
});
