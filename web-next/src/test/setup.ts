// Общая подготовка тестов web-next (S4-00d). globals у vitest выключены, и
// @testing-library/react сам не снимает отрисованное между тестами — без
// cleanup узлы прошлых тестов копились бы в document.body, и axe видел бы
// чужую разметку. В node-тестах (без DOM) — ничего не делаем.
import { afterEach } from 'vitest';
import { installKitVocabulary } from '../kitVocabulary';

// Слова LORE поверх нейтральных строк kit (K-14) — как при старте приложения.
installKitVocabulary();

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
