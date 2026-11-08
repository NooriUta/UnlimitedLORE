// Сторож границы «модель данных ↔ поведенческая модель» (требование владелицы
// 08.11.2026: «и отдельный тест, что модель данных не пробивает поведенческой»).
//
// Разделение её же словами: «модель — это общий контракт, а web-next —
// поведенческая модель». Значит всё, что приезжает с сервера по /lore/model,
// обязано быть данными: подписи, иконки, виды полей, колонки, виды рёбер.
// Поведение — вердикт, хуки привязки и сохранения, команды палитры, отрисовка
// обзора и вкладок — живёт в приложении и в модель не уезжает.
//
// Почему сторож, а не договорённость: функция, просочившаяся в модель, не
// падает — она тихо работает у одного приложения и отсутствует у другого, а
// kit мы отдаём наружу (K-08) и запускаем без сборки (K-13).
import { describe, expect, it } from 'vitest';
import { assertDataOnly, findFunctions, BEHAVIOUR_STAYS_IN_APP } from './dataOnly';

/** Похоже на то, что отдаст /lore/model: только данные. */
const MODEL_PAYLOAD = {
  version: 'm-12',
  types: {
    sprint: {
      label: 'Спринт',
      icon: 'sprint',
      fields: { title: { source: 'prop', kind: 'text', editable: true } },
      edges: { tasks: { edge: 'HAS_TASK', dir: 'out', uml: 'composition', manageable: false } },
    },
  },
  surfaces: { passport: { sprint: { sections: ['props', 'tasks'] } }, list: { sprint: { columns: ['id', 'title'] } } },
  dict: { work_class: [{ code: 'enb', title: 'Enabler', color: 'var(--inf)' }] },
};

describe('S4 · модель данных не пробивает поведенческой', () => {
  it('документ модели из JSON проходит: в нём нет ни одной функции', () => {
    const fromWire: unknown = JSON.parse(JSON.stringify(MODEL_PAYLOAD));
    expect(findFunctions(fromWire)).toEqual([]);
    expect(() => assertDataOnly(fromWire, '/lore/model')).not.toThrow();
  });

  it('функция внутри модели ловится и называется путём, а не «где-то»', () => {
    const sneaky = { ...MODEL_PAYLOAD, types: { sprint: { ...MODEL_PAYLOAD.types.sprint, overview: () => 'обзор' } } };
    expect(findFunctions(sneaky)).toEqual(['types.sprint.overview']);
    expect(() => assertDataOnly(sneaky, '/lore/model')).toThrow(/types\.sprint\.overview/);
  });

  it('находит несколько пробоев сразу и перечисляет все', () => {
    const sneaky = {
      types: { sprint: { verdict: () => 1 } },
      surfaces: { passport: { sprint: { render: () => null } } },
    };
    expect(findFunctions(sneaky).sort()).toEqual(['surfaces.passport.sprint.render', 'types.sprint.verdict']);
  });

  it('ловит функцию внутри массива — путь с индексом', () => {
    expect(findFunctions({ dict: { work_class: [{ code: 'enb', run: () => 0 }] } })).toEqual(['dict.work_class[0].run']);
  });

  it('пустое, null и примитивы — это данные, а не пробой', () => {
    expect(findFunctions(null)).toEqual([]);
    expect(findFunctions({ a: null, b: 0, c: '', d: false, e: [], f: {} })).toEqual([]);
  });

  it('перечень поведенческих ключей зафиксирован — чтобы список не разъехался с ADR', () => {
    expect([...BEHAVIOUR_STAYS_IN_APP].sort()).toEqual(
      ['hooks', 'overview', 'palette', 'render', 'run', 'tabs', 'verdict'],
    );
  });

  it('поведенческий ключ со значением-данными тоже пробой: решает имя, а не тип значения', () => {
    // «verdict: "ok"» выглядит безобидно, но это уже договор о поведении,
    // а договор о поведении в общий контракт не едет.
    expect(findFunctions({ types: { adr: { verdict: 'ok' } } })).toEqual(['types.adr.verdict']);
  });
});
