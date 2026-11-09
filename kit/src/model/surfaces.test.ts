// Порядок разделов паспорта приходит данными, а не кодом
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, просьба владелицы 09.11.2026).
//
// Её слова: «ты должен определять порядок например Спринт первое как ни
// странно задачи потом уже контент потом еще что-то а зависимости и прочее
// можно скрыть под море и сделать настройкой».
//
// ПОЧЕМУ ЭТО `surfaces`, А НЕ `types`. Я сначала попросил у сервера
// `types[t].tabs` — и серверная сессия отказала, справедливо, двумя доводами,
// которые я проверил по коду:
//   1. у меня же в `model/dataOnly.ts` в `BEHAVIOUR_STAYS_IN_APP` стоит
//      `tabs`, и проверка идёт на ЛЮБОЙ глубине: `types.sprint.tabs` уронил бы
//      `assertDataOnly` на всю модель;
//   2. D-2026-LORE-MODEL-TYPES-VS-SURFACES: в `types` — свойства типа, а
//      интерфейсный выбор — в `surfaces`. Порядок разделов и «что под Ещё» —
//      ровно умолчание поверхности.
// То есть я попросил то, что сам запретил. Форма ниже — её, не моя.
//
// И почему `sections`, а не `tabs` под другим именем: «вкладка» называет
// КОНТРОЛ, а на телефоне это свёртка или нижний лист. Список РАЗДЕЛОВ говорит
// что и в каком порядке, но не как. Чтобы это не осталось словесной разницей,
// здесь стоит сторож: у элемента ровно пять ключей, любой лишний — отказ. Так
// «данные, а не отрисовка» проверяется, а не доказывается в переписке.
import { describe, expect, it } from 'vitest';
import { SECTION_KEYS, applySections, passportSections } from './surfaces';

const sprint = {
  decided: true,
  sections: [
    { key: 'tasks', source: 'part', ref: 'tasks', order: 1, default_visible: true },
    { key: 'content', source: 'body', ref: null, order: 2, default_visible: true },
    { key: 'phases', source: 'part', ref: 'phases', order: 3, default_visible: false },
    { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 4, default_visible: false },
  ],
};

const model = (passport: unknown) => ({ surfaces: { partial: true, passport } });

describe('passportSections: порядок и видимость из модели', () => {
  it('положительный контроль: разделы приходят в порядке `order`', () => {
    const r = passportSections(model({ sprint }), 'sprint');
    expect(r.decided).toBe(true);
    expect(r.sections.map(s => s.key)).toEqual(['tasks', 'content', 'phases', 'deps']);
  });

  it('порядок берётся из `order`, а не из порядка в массиве', () => {
    const shuffled = { decided: true, sections: [...sprint.sections].reverse() };
    const r = passportSections(model({ sprint: shuffled }), 'sprint');
    expect(r.sections.map(s => s.key)).toEqual(['tasks', 'content', 'phases', 'deps']);
  });

  it('`default_visible: false` — редкий раздел, под «Ещё»', () => {
    const r = passportSections(model({ sprint }), 'sprint');
    expect(r.sections.filter(s => !s.visible).map(s => s.key)).toEqual(['phases', 'deps']);
  });

  it('у типа нет записи — порядок НЕ решён, и это сказано, а не угадано', () => {
    const r = passportSections(model({ sprint }), 'adr');
    expect(r.decided).toBe(false);
    expect(r.sections).toEqual([]);
  });

  it('`surfaces` нет вовсе (сервер старее) — тоже «не решён», без ошибки', () => {
    expect(passportSections({}, 'sprint')).toEqual({ decided: false, sections: [] });
    expect(passportSections(null, 'sprint')).toEqual({ decided: false, sections: [] });
  });

  it('`decided: false` у типа — перечень игнорируется, порядок за приложением', () => {
    // Сервер прямо говорит «я не решал». Притворяться, что решал, нельзя.
    const r = passportSections(model({ sprint: { decided: false, sections: sprint.sections } }), 'sprint');
    expect(r.decided).toBe(false);
    expect(r.sections).toEqual([]);
  });
});

describe('сторож формы: данные, а не отрисовка', () => {
  it('положительный контроль: пять законных ключей названы', () => {
    expect([...SECTION_KEYS].sort()).toEqual(['default_visible', 'key', 'order', 'ref', 'source'].sort());
  });

  it.each(['component', 'render', 'icon', 'label', 'tabs'])('лишний ключ «%s» — отказ целиком, а не тихое игнорирование', extra => {
    const bad = { decided: true, sections: [{ ...sprint.sections[0], [extra]: 'x' }] };
    expect(() => passportSections(model({ sprint: bad }), 'sprint')).toThrow(/лишн/i);
  });

  it('неизвестный `source` — отказ: трёх источников достаточно, четвёртый надо обсуждать', () => {
    const bad = { decided: true, sections: [{ ...sprint.sections[0], source: 'widget' }] };
    expect(() => passportSections(model({ sprint: bad }), 'sprint')).toThrow(/source/i);
  });

  it('`order` не целое — отказ: по дробному порядку сортировка молча разъедется', () => {
    const bad = { decided: true, sections: [{ ...sprint.sections[0], order: 1.5 }] };
    expect(() => passportSections(model({ sprint: bad }), 'sprint')).toThrow(/order/i);
  });

  it('повторяющийся `key` — отказ: два раздела с одним ключом дали бы одну вкладку', () => {
    const bad = { decided: true, sections: [sprint.sections[0], { ...sprint.sections[1], key: 'tasks' }] };
    expect(() => passportSections(model({ sprint: bad }), 'sprint')).toThrow(/tasks/);
  });

  it('`ref` у `body` может быть null — тело паспорта одно на все разделы', () => {
    const r = passportSections(model({ sprint }), 'sprint');
    expect(r.sections.find(s => s.source === 'body')?.ref).toBeNull();
  });
});

describe('applySections: порядок применяется, незнакомое не прячется', () => {
  const items: { id: string; label: string; secondary?: boolean }[] = [
    { id: 'overview', label: 'Текст' },
    { id: 'tasks', label: 'Задачи' },
    { id: 'deps', label: 'Зависит от' },
    { id: 'graph', label: 'Граф' },
  ];
  const order = passportSections(model({ sprint }), 'sprint');

  it('положительный контроль: порядок не решён — список не меняется вовсе', () => {
    expect(applySections(items, { decided: false, sections: [] })).toEqual(items);
    expect(applySections(items)).toEqual(items);
  });

  it('названные моделью идут первыми, в её порядке', () => {
    const r = applySections(items, order);
    // tasks (1) → content/нет в списке → phases/нет → deps (4); затем остальное.
    expect(r.map(i => i.id)).toEqual(['tasks', 'deps', 'overview', 'graph']);
  });

  it('невидимое по модели помечается `secondary`, видимое — нет', () => {
    const r = applySections(items, order);
    expect(r.find(i => i.id === 'tasks')?.secondary).toBe(false);
    expect(r.find(i => i.id === 'deps')?.secondary).toBe(true);
  });

  it('ЧЕГО МОДЕЛЬ НЕ НАЗЫВАЛА — не прячется и остаётся как было', () => {
    // Граф, журнал, история — вкладки конструктора; модель о них не говорит.
    const r = applySections(items, order);
    expect(r.find(i => i.id === 'graph')?.secondary).toBeUndefined();
    expect(r.find(i => i.id === 'overview')?.secondary).toBeUndefined();
    // И их взаимный порядок прежний.
    expect(r.slice(2).map(i => i.id)).toEqual(['overview', 'graph']);
  });

  it('исходный массив не портится — функция чистая', () => {
    const copy = items.map(i => ({ ...i }));
    applySections(items, order);
    expect(items).toEqual(copy);
  });
});
