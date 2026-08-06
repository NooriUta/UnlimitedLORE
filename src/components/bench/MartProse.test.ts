import { describe, it, expect, vi } from 'vitest';
import { toSegments } from './MartProse';

// Нет jsdom/@testing-library в этом репозитории (см. LoreVpCanvas.tsx) —
// проверяем именно разбор фенсов, не монтирование React-компонентов.
// `sanitizeMd` внутри дёргает DOMPurify.sanitize(), которому нужен реальный
// DOM — недоступен в node-окружении тестов. Мокаем тождественной функцией:
// предмет проверки здесь — РАЗБОР НА СЕГМЕНТЫ, не санитизация HTML (её и так
// не трогает эта правка — она про диаграммные фенсы, не про html-путь).
vi.mock('../lore/sanitizeHtml', () => ({
  sanitizeMd: (html: string) => html,
  sanitizeSvg: (svg: string) => svg,
}));
describe('toSegments (mermaid + bpmn fences)', () => {
  it('одна ```mermaid-секция даёт html/mermaid/пусто', () => {
    const segs = toSegments('до\n```mermaid\ngraph TD; A-->B\n```\nпосле');
    expect(segs.map(s => s.kind)).toEqual(['html', 'mermaid', 'html']);
    expect(segs[1]).toMatchObject({ kind: 'mermaid', def: 'graph TD; A-->B' });
  });

  it('одна ```bpmn-секция распознаётся отдельным видом', () => {
    const segs = toSegments('```bpmn\n<definitions/>\n```');
    expect(segs).toEqual([{ kind: 'bpmn', def: '<definitions/>' }]);
  });

  it('mermaid и bpmn вперемешку — порядок и виды не путаются', () => {
    const segs = toSegments(
      'intro\n```mermaid\nA\n```\nmiddle\n```bpmn\nB\n```\noutro',
    );
    expect(segs.map(s => s.kind)).toEqual(['html', 'mermaid', 'html', 'bpmn', 'html']);
  });

  it('bpmn-блок ПОСЛЕ последнего mermaid не проглатывается хвостом', () => {
    // Регресс, который ловит именно ОБЪЕДИНЁННЫЙ regex: раздельное сканирование
    // (сначала все ```mermaid, потом всё остальное как html) отдало бы этот
    // bpmn-фенс как сырой текст внутри HTML-хвоста после последнего совпадения.
    const segs = toSegments('```mermaid\nA\n```\n```bpmn\nB\n```');
    expect(segs.map(s => s.kind)).toEqual(['mermaid', 'bpmn']);
  });

  it('без фенсов — один html-сегмент', () => {
    const segs = toSegments('просто текст');
    expect(segs).toEqual([{ kind: 'html', html: expect.stringContaining('просто текст') }]);
  });

  it('пустой текст — пустой массив', () => {
    expect(toSegments('')).toEqual([]);
  });
});
