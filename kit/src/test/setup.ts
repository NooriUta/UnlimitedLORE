// Общая подготовка тестов kit. globals у vitest выключены, поэтому
// @testing-library/react сам не снимает отрисованное между тестами — без
// cleanup узлы прошлых тестов копятся в document.body, и axe/запросы по роли
// видят чужую разметку.
import { afterEach } from 'vitest';

// axe пробует canvas (оценка иконок), а jsdom его не реализует и сыплет в лог
// «Not implemented: getContext». Явный null — тот же исход без шума.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
