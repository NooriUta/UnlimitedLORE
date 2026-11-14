// @vitest-environment jsdom
// SPRINT_VIZ_EMBED/EMB-L2 — рамка встроенного графика в kit (перенос v1
// VolvaEmbedFrame для v2). Честные состояния вместо пустой рамки: «не
// настроено» (и что настроить), «недоступна», «нет прав», «загрузка», плюс
// «нужен выбор» от приложения. Рамка — sandbox, без referrer; высота — по
// сообщению metabase.frame только с origin подписанного адреса и только от
// своего фрейма.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EmbedChartFrame, KitLangProvider } from '../index';

const SIGNED = 'https://volva.example.org/embed/question/eyJ.payload.sig';
const ru = (ui: React.ReactElement) => render(<KitLangProvider lang="ru">{ui}</KitLangProvider>);

describe('EmbedChartFrame: честные состояния', () => {
  it('загрузка — role=status, не пустая рамка', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="График" state={{ kind: 'loading' }} />);
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('не настроено — словами, с подсказкой приложения, что настроить', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="График"
      state={{ kind: 'not_configured', hint: 'Нужен ключ подписи на бэкенде', detail: 'NOT_CONFIGURED' }} />);
    const box = container.querySelector('[data-embed-state="not_configured"]');
    expect(box).not.toBeNull();
    expect(box!.textContent).toMatch(/Встраивание Völva не настроено/);
    expect(box!.textContent).toContain('Нужен ключ подписи на бэкенде');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('недоступна — тревога (role=alert) с причиной и «Повторить»', () => {
    let retried = 0;
    const { container } = ru(<EmbedChartFrame source="Völva" title="График"
      state={{ kind: 'unavailable', detail: 'HTTP 502' }} onRetry={() => { retried++; }} />);
    const box = container.querySelector('[data-embed-state="unavailable"]')!;
    expect(box.querySelector('[role="alert"]')).not.toBeNull();
    expect(box.textContent).toMatch(/Völva недоступна/);
    expect(box.textContent).toContain('HTTP 502');
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(retried).toBe(1);
  });

  it('нет прав (403) — не «пусто» и не «ошибка»', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="График"
      state={{ kind: 'forbidden', reason: 'проект X вне ваших проектов' }} />);
    const box = container.querySelector('[data-embed-state="forbidden"]')!;
    expect(box.querySelector('[data-state="forbidden"]')).not.toBeNull();
    expect(box.textContent).toMatch(/Нет прав/);
    expect(box.textContent).toContain('проект X вне ваших проектов');
  });

  it('нужен выбор — заголовок и подсказка приложения', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="График"
      state={{ kind: 'needs', title: 'Выберите проект', hint: 'График запирается по проекту' }} />);
    const box = container.querySelector('[data-embed-state="needs"]')!;
    expect(box.textContent).toContain('Выберите проект');
    expect(box.textContent).toContain('График запирается по проекту');
  });

  it('адрес не http(s) — ошибка, рамки нет', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="График" state={{ kind: 'ready', signedUrl: 'javascript:alert(1)' }} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-embed-state="unavailable"]')).not.toBeNull();
  });
});

describe('EmbedChartFrame: рамка', () => {
  it('sandbox без top-navigation и попапов, no-referrer, тема transparent и язык в hash', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="Таймлайн спринтов" state={{ kind: 'ready', signedUrl: SIGNED }} />);
    const f = container.querySelector('iframe')!;
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(f.getAttribute('title')).toBe('Таймлайн спринтов');
    const src = f.getAttribute('src')!;
    expect(src.startsWith(SIGNED + '#')).toBe(true);
    const h = new URLSearchParams(src.split('#')[1]);
    expect(h.get('theme')).toBe('transparent');
    expect(h.get('locale')).toBe('ru');
  });

  it('палитра страницы — в hash; смена data-theme перестраивает адрес', async () => {
    document.documentElement.setAttribute('data-theme', 'lichen');
    const { container } = ru(<EmbedChartFrame source="Völva" title="t" state={{ kind: 'ready', signedUrl: SIGNED }} />);
    expect(container.querySelector('iframe')!.getAttribute('src')).toContain('palette=lichen');
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'slate');
      document.documentElement.setAttribute('data-mode', 'light');
      await new Promise(r => setTimeout(r, 0));
    });
    const src = container.querySelector('iframe')!.getAttribute('src')!;
    expect(src).toContain('palette=slate');
    expect(src).toContain('mode=light');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-mode');
  });

  it('высота — только от своего фрейма и с origin подписанного адреса', () => {
    const { container } = ru(<EmbedChartFrame source="Völva" title="t" minHeight={200} state={{ kind: 'ready', signedUrl: SIGNED }} />);
    const f = container.querySelector('iframe')!;
    const fire = (origin: string, source: MessageEventSource | null, height: number) => act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin, source, data: { metabase: { type: 'frame', frame: { height } } } }));
    });
    expect(f.style.height).toBe('200px');
    fire('https://evil.example', f.contentWindow, 900);
    expect(f.style.height).toBe('200px');
    fire('https://volva.example.org', window, 900);   // чужой источник с правильным origin
    expect(f.style.height).toBe('200px');
    fire('https://volva.example.org', f.contentWindow, 640);
    expect(f.style.height).toBe('640px');
    fire('https://volva.example.org', f.contentWindow, 50);  // меньше минимума — минимум
    expect(f.style.height).toBe('200px');
  });

  // Приёмка препрода 14.11.2026 (f6d60691): хост Völva не отвечает — в рамке висела страница
  // браузера «недоступна», своего состояния у LORE не было и через 20 с. Живая встройка шлёт
  // metabase.frame каждые 100 мс (VE-5); нет ни одного сообщения за срок — «не ответила».
  describe('встройка не ответила', () => {
    afterEach(() => { vi.useRealTimers(); });
    const frameMsg = (f: HTMLIFrameElement) => act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://volva.example.org', source: f.contentWindow, data: { metabase: { type: 'frame', frame: { height: 300 } } } }));
    });

    it('нет metabase.frame за срок — «Völva не ответила» с «Повторить», рамки нет', () => {
      vi.useFakeTimers();
      let retried = 0;
      const { container } = ru(<EmbedChartFrame source="Völva" title="t" answerTimeoutMs={5000}
        state={{ kind: 'ready', signedUrl: SIGNED }} onRetry={() => { retried++; }} />);
      expect(container.querySelector('iframe')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(5001); });
      const box = container.querySelector('[data-embed-state="silent"]')!;
      expect(box).not.toBeNull();
      expect(box.textContent).toMatch(/Völva не ответила/);
      expect(container.querySelector('iframe')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
      expect(retried).toBe(1);
      expect(container.querySelector('iframe')).not.toBeNull();
    });

    it('сообщение пришло вовремя — рамка остаётся и после срока', () => {
      vi.useFakeTimers();
      const { container } = ru(<EmbedChartFrame source="Völva" title="t" answerTimeoutMs={5000} state={{ kind: 'ready', signedUrl: SIGNED }} />);
      frameMsg(container.querySelector('iframe')!);
      act(() => { vi.advanceTimersByTime(10000); });
      expect(container.querySelector('[data-embed-state="ready"] iframe')).not.toBeNull();
    });
  });
});
