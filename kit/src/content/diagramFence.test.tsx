// @vitest-environment jsdom
// Владелица 10.11.2026: «проблема с диаграммой mermaid осталась в 17.9» — на месте
// тела заметки нарисовано «mermaid: No diagram type detected matching given
// configuration for text: …», а дальше её собственный текст. То есть обычный текст
// примечания ушёл в mermaid.render() и превратился в сообщение библиотеки, которое
// закрыло содержимое.
//
// Здесь закреплены два правила, и они работают только вместе:
//   1. Текст, который НЕ объявлен диаграммой, никогда не отдаётся mermaid. Блок
//      объявлен диаграммой только по правилам CommonMark: фенс открывается с начала
//      строки (отступ ≤ 3), в информационной строке — ровно имя языка (без обратных
//      кавычек и не «mermaidjs»), закрывает его строка из одних кавычек. Упоминание
//      ```mermaid в прозе — это проза.
//   2. Если блок ДЕЙСТВИТЕЛЬНО объявлен диаграммой, а нарисовать не удалось, человек
//      видит оговорку «не удалось нарисовать» ВМЕСТЕ с исходником блока. «Не смогли
//      нарисовать» ≠ «пусто», содержимое не теряется, и сырое англоязычное сообщение
//      библиотеки не встаёт поверх содержимого — оно уходит в «техническую причину».
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// mermaid в jsdom не рисует: подменяем render отказом — проверяется НАШ фолбэк.
const MERMAID_MSG = 'No diagram type detected matching given configuration for text: Мой текст примечания';
vi.mock('mermaid', () => ({
  default: {
    registerLayoutLoaders: vi.fn(),
    initialize: vi.fn(),
    render: vi.fn(async () => { throw new Error(MERMAID_MSG); }),
  },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    importXML() { return Promise.reject(new Error('unparsable content detected')); }
    get() { return { zoom: () => {} }; }
    destroy() {}
  },
}));

// Провайдер языка берём напрямую из i18n, а не из общего barrel: barrel тянет
// все экраны kit, и тест разбора диаграмм не должен падать из-за чужого файла.
import { KitLangProvider } from '../i18n/lang';
import { MartProse, toSegments } from './MartProse';

const kinds = (md: string) => toSegments(md).map(s => s.kind);
const mermaidDefs = (md: string) =>
  toSegments(md).flatMap(s => (s.kind === 'mermaid' ? [s.def] : []));

describe('правило 1 · диаграммой считается только объявленный блок', () => {
  it('положительный контроль: настоящий блок с фронтматтером layout: elk — диаграмма, фронтматтер цел', () => {
    const md = 'Начало.\n\n```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart TB\n  A["запрос"] --> B["ответ"]\n```\n\nКонец.\n';
    expect(kinds(md)).toEqual(['html', 'mermaid', 'html']);
    expect(mermaidDefs(md)[0]).toBe('---\nconfig:\n  layout: elk\n---\nflowchart TB\n  A["запрос"] --> B["ответ"]');
  });

  it('упоминание ```mermaid внутри строки прозы не открывает диаграмму (ровно случай владелицы)', () => {
    const md = 'Правило: схема — всегда ```mermaid с layout: elk```.\n\n'
      + 'Мой текст примечания: проверено на телефоне, TB читается, LR нет.\n\n'
      + '```\nкод\n```\n';
    expect(kinds(md)).toEqual(['html']);
    expect(mermaidDefs(md)).toEqual([]);
    // Текст примечания остаётся читаемым текстом, а не «определением диаграммы».
    const first = toSegments(md)[0];
    expect(first.kind === 'html' ? first.html : '').toContain('Мой текст примечания');
  });

  it('фенс, открытый не с начала строки, диаграммой не считается', () => {
    const md = 'Смотри блок ```mermaid\nЭто обычный текст примечания без диаграммы.\n```\n';
    expect(mermaidDefs(md)).toEqual([]);
  });

  it('язык, который лишь начинается на mermaid (mermaidjs), — не диаграмма', () => {
    expect(mermaidDefs('```mermaidjs\nнет это не диаграмма\n```\n')).toEqual([]);
    expect(mermaidDefs('```mermaid-ish\nтоже нет\n```\n')).toEqual([]);
  });

  it('```mermaid внутри внешнего фенса — это код, его не отдают рендереру', () => {
    const md = '````\n```mermaid\nflowchart TB\n  A --> B\n```\n````\n';
    expect(mermaidDefs(md)).toEqual([]);
    expect(kinds(md)).toEqual(['html']);
  });

  it('обычный блок кода не рвёт поток и не превращается в диаграмму', () => {
    const md = 'A\n\n```json\n{"a":1}\n```\n\nB\n\n```mermaid\ngraph TD; a-->b\n```\n';
    expect(kinds(md)).toEqual(['html', 'mermaid']);
    expect(mermaidDefs(md)).toEqual(['graph TD; a-->b']);
  });

  it('блок с отступом внутри списка — диаграмма, отступ снят', () => {
    const md = '- пункт\n\n  ```mermaid\n  flowchart TB\n    A --> B\n  ```\n';
    expect(mermaidDefs(md)).toEqual(['flowchart TB\n  A --> B']);
  });
});

describe('правило 2 · «не удалось нарисовать» ≠ «пусто»', () => {
  const DEF = 'flowchart TB\n  A["запрос"] --> B["ответ"]';

  it('mermaid не разобрал объявленный блок: оговорка по-русски и исходник блока рядом', async () => {
    const { container } = render(<MartProse text={'```mermaid\n' + DEF + '\n```'} />);
    const box = await waitFor(() => {
      const el = container.querySelector('.sk-prose__diagram-err');
      expect(el).toBeTruthy();
      return el!;
    });
    // Оговорка — наша, человеческая.
    expect(box.querySelector('.sk-prose__diagram-err-why')!.textContent).toMatch(/не удалось/i);
    // Содержимое не потеряно: исходник блока виден как текст (не под закрытым details).
    const src = box.querySelector('.sk-prose__diagram-err-src')!;
    expect(src.textContent).toContain('A["запрос"] --> B["ответ"]');
    expect(src.closest('details')).toBeNull();
    // Сырое сообщение библиотеки — не заголовок плашки, а «техническая причина».
    expect(box.querySelector('.sk-prose__diagram-err-why')!.textContent).not.toContain('No diagram type detected');
    const tech = box.querySelector('details')!;
    expect(tech.textContent).toContain(MERMAID_MSG);
  });

  it('та же оговорка переведена (en) — подписи из локалей kit, не из библиотеки', async () => {
    const { container } = render(
      <KitLangProvider lang="en"><MartProse text={'```mermaid\n' + DEF + '\n```'} /></KitLangProvider>,
    );
    await waitFor(() => expect(container.querySelector('.sk-prose__diagram-err-why')).toBeTruthy());
    expect(container.querySelector('.sk-prose__diagram-err-why')!.textContent).toMatch(/could not|couldn't/i);
  });

  it('то же правило для bpmn: исходник блока не исчезает вместе с ошибкой', async () => {
    const xml = '<definitions>не разберётся</definitions>';
    const { container } = render(<MartProse text={'```bpmn\n' + xml + '\n```'} />);
    await waitFor(() => expect(container.querySelector('.sk-prose__diagram-err')).toBeTruthy());
    expect(container.querySelector('.sk-prose__diagram-err-src')!.textContent).toContain(xml);
    expect(container.querySelector('.sk-prose__diagram-err-why')!.textContent).toMatch(/не удалось/i);
  });
});
