// Общая подготовка тестов web-next (S4-00d). globals у vitest выключены, и
// @testing-library/react сам не снимает отрисованное между тестами — без
// cleanup узлы прошлых тестов копились бы в document.body, и axe видел бы
// чужую разметку. В node-тестах (без DOM) — ничего не делаем.
import { afterEach, beforeAll } from 'vitest';

// Слова LORE поверх нейтральных строк kit (K-14) — как при старте приложения.
// В beforeAll и динамическим импортом: статический импорт загрузил бы kit (а с ним
// mermaid) ДО vi.mock файла теста, и подмены перестали бы действовать.
beforeAll(async () => {
  (await import('../kitVocabulary')).installKitVocabulary();
});

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
