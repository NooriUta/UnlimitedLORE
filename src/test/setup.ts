// S0-05: общий setup рендер-тестов (*.test.tsx, окружение jsdom — см. проект
// `render` в vite.config.ts). Юнит-тесты (*.test.ts) идут в node и сюда не заходят.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Настоящий i18n с обеими локалями: тест видит те же строки, что и пользователь,
// и пропавший ключ проявится текстом ключа, а не тихим дефолтом.
import '../i18n';

afterEach(() => cleanup());

// jsdom не реализует matchMedia (нужен Mantine и useIsNarrow) и ResizeObserver.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
