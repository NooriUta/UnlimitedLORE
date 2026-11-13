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

// jsdom не меряет раскладку: у Range и Text нет getClientRects/getBoundingClientRect,
// а focus() редактора TipTap прокручивает к каретке и зовёт их (prosemirror-view
// coordsAtPos). Заглушка жила копиями в двух файлах, файл без копии ронял CI
// необработанной ошибкой после конца теста (#1315, 13.11.2026). Одна на всех:
// пустые прямоугольники — тот же исход, что «ничего не видно». Сторож —
// src/test/layoutStubs.test.ts.
if (typeof Range !== 'undefined') {
  const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  for (const proto of [Range.prototype, Element.prototype, Text.prototype as unknown as Element]) {
    const p = proto as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
    if (typeof p.getClientRects !== 'function') p.getClientRects = noRects;
    if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = zeroRect;
  }
}

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
