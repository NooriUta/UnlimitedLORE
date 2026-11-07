// Общая подготовка тестов web-next (S4-00d). globals у vitest выключены, и
// @testing-library/react сам не снимает отрисованное между тестами — без
// cleanup узлы прошлых тестов копились бы в document.body, и axe видел бы
// чужую разметку. В node-тестах (без DOM) — ничего не делаем.
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
