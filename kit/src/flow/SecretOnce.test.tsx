// @vitest-environment jsdom
// «Секрет один раз» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-SECRET-ONCE).
//
// Повод — два сценария прототипа админки сразу: UC-2 «дать человеку агента»
// (значение выдаётся один раз) и UC-6 «сменить секрет без простоя». Владелица
// 09.11.2026: «задачи по элементам новым [во] второй спринт разделом новым…
// по админ».
//
// Почему элементом kit, а не кодом экрана: ошибиться здесь можно ТИХО —
// достаточно один раз положить значение в состояние, которое уедет в
// хранилище, в адрес или в текст ошибки. Сделать правильно нужно один раз, с
// тестами, которые это и проверяют.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SecretOnce } from './SecretOnce';

const VALUE = 's3cr3t-value-ONLY-ONCE';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* в запертом браузере нечего чистить */ }
});

const reveal = () => screen.getByTestId('kit-secret-reveal');
const copy = () => screen.getByTestId('kit-secret-copy');

describe('K2-SECRET-ONCE · предупреждение раньше значения', () => {
  it('до нажатия значения на экране нет, а предупреждение есть', () => {
    render(<SecretOnce value={VALUE} label="Секрет" />);
    expect(screen.getByTestId('kit-secret-warn')).toBeTruthy();
    expect(document.body.textContent).not.toContain(VALUE);
  });

  it('после «Показать» значение видно', () => {
    render(<SecretOnce value={VALUE} label="Секрет" />);
    fireEvent.click(reveal());
    expect(screen.getByTestId('kit-secret-value').textContent).toBe(VALUE);
  });

  it('значения нет вовсе — сказано словами, кнопки показа нет', () => {
    render(<SecretOnce value={null} label="Секрет" />);
    expect(screen.getByTestId('kit-secret-none')).toBeTruthy();
    expect(screen.queryByTestId('kit-secret-reveal')).toBeNull();
  });
});

describe('K2-SECRET-ONCE · копирование и честный отказ буфера', () => {
  it('копирует значение в буфер', async () => {
    const writeText = vi.fn(async () => {});
    render(<SecretOnce value={VALUE} label="Секрет" clipboard={{ writeText }} />);
    fireEvent.click(reveal());
    fireEvent.click(copy());
    expect(writeText).toHaveBeenCalledWith(VALUE);
    expect(await screen.findByTestId('kit-secret-copied')).toBeTruthy();
  });

  it('буфера нет (нет https, запрет политики) — отказ НАЗВАН, а не проглочен', async () => {
    render(<SecretOnce value={VALUE} label="Секрет" clipboard={null} />);
    fireEvent.click(reveal());
    fireEvent.click(copy());
    const err = await screen.findByTestId('kit-secret-copyfail');
    expect(err.textContent?.trim()).not.toBe('');
  });

  it('буфер отказал — в тексте отказа НЕТ самого значения', async () => {
    const writeText = vi.fn(async () => { throw new Error(`отказ при записи ${VALUE}`); });
    render(<SecretOnce value={VALUE} label="Секрет" clipboard={{ writeText }} />);
    fireEvent.click(reveal());
    fireEvent.click(copy());
    const err = await screen.findByTestId('kit-secret-copyfail');
    expect(err.textContent, 'значение просочилось в текст ошибки').not.toContain(VALUE);
  });
});

describe('K2-SECRET-ONCE · значение никуда не утекает', () => {
  it('ни в localStorage, ни в sessionStorage, ни в адрес', () => {
    render(<SecretOnce value={VALUE} label="Секрет" />);
    fireEvent.click(reveal());
    const all = [
      ...Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`),
      ...Object.keys(sessionStorage).map(k => `${k}=${sessionStorage.getItem(k)}`),
      window.location.href,
    ].join('|');
    expect(all).not.toContain(VALUE);
  });

  it('исходник не трогает хранилища, адрес и журнал — проверка по коду, а не обещанием в комментарии', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/SecretOnce.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'history.', 'location.', 'console.']) {
      expect(code, `элемент секрета обращается к ${api} — значение может утечь`).not.toContain(api);
    }
  });
});

describe('K2-SECRET-ONCE · показать второй раз нельзя', () => {
  it('после «Скрыть» значения нет и повторный показ отказан с причиной', () => {
    render(<SecretOnce value={VALUE} label="Секрет" />);
    fireEvent.click(reveal());
    fireEvent.click(screen.getByTestId('kit-secret-hide'));
    expect(document.body.textContent).not.toContain(VALUE);
    expect(screen.queryByTestId('kit-secret-reveal')).toBeNull();
    expect(screen.getByTestId('kit-secret-spent').textContent?.trim()).not.toBe('');
  });

  it('«Скрыть» зовёт onClose — приложение чистит значение у себя', () => {
    const onClose = vi.fn();
    render(<SecretOnce value={VALUE} label="Секрет" onClose={onClose} />);
    fireEvent.click(reveal());
    fireEvent.click(screen.getByTestId('kit-secret-hide'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('новое значение (новый выпуск) показывается снова — «нельзя» только про старое', () => {
    const { rerender } = render(<SecretOnce value={VALUE} label="Секрет" />);
    fireEvent.click(reveal());
    fireEvent.click(screen.getByTestId('kit-secret-hide'));
    rerender(<SecretOnce value="новый-секрет" label="Секрет" />);
    expect(screen.getByTestId('kit-secret-warn')).toBeTruthy();
    fireEvent.click(reveal());
    expect(screen.getByTestId('kit-secret-value').textContent).toBe('новый-секрет');
  });
});

describe('K2-SECRET-ONCE · граница K-14', () => {
  it('в элементе нет предметных имён: что за секрет — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/SecretOnce.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['агент', 'keycloak', 'forgejo', 'пароль', 'токен', 'проект']) {
      expect(code.toLowerCase(), `в коде встречается «${word}» — это знание приложения`).not.toContain(word);
    }
  });

  it('подпись значения приходит от приложения и видна', () => {
    render(<SecretOnce value={VALUE} label="Секрет клиента" />);
    expect(screen.getByText('Секрет клиента')).toBeTruthy();
  });
});
