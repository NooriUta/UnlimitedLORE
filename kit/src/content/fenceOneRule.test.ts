// Одно правило «где блок кода» на чтение и на правку
// (SPRINT_UXR_S10_SEIDR_KIT/K-13, остаток; правило владелицы «частный фикс
// обобщать до правила»).
//
// 10.11 чтение (MartProse) получило правило CommonMark через
// diagramFence.ts: фенс из обратных кавычек не может содержать их в
// информационной строке — «```mermaid` в прозе» это текст с инлайн-кодом, а не
// блок. Путь ПРАВКИ (normalizeMarkdown — по нему сверяется круг «MD → TipTap →
// MD») распознавал фенс своей регуляркой и считал такую строку началом блока:
// всё ниже неё до конца тела выпадало из нормализации, и сверка круга врала.
import { describe, expect, it } from 'vitest';
import { normalizeMarkdown } from './markdownRoundTrip';
import { fenceCloses, fenceOpening } from './diagramFence';

describe('K-13 · фенс распознаётся одним правилом на чтении и на правке', () => {
  it('строка прозы с инлайн-кодом — не фенс: пустые строки ниже схлопываются', () => {
    const md = '```mermaid` упомянут в тексте\n\n\n\nдальше текст';
    expect(normalizeMarkdown(md)).toBe('```mermaid` упомянут в тексте\n\nдальше текст');
  });

  it('положительный контроль: настоящий фенс — внутри пустые строки сохраняются', () => {
    const md = '```json\n{\n\n\n}\n```\n\n\n\nтекст';
    expect(normalizeMarkdown(md)).toBe('```json\n{\n\n\n}\n```\n\nтекст');
  });

  it('общие функции фенса: открытие, порода и длина закрытия', () => {
    expect(fenceOpening('```mermaid')?.lang).toBe('mermaid');
    expect(fenceOpening('    ```x')).toBeNull();
    expect(fenceOpening('```a`b')).toBeNull();
    expect(fenceCloses('````', '```')).toBe(true);
    expect(fenceCloses('~~~', '```')).toBe(false);
    expect(fenceCloses('``', '```')).toBe(false);
  });
});
