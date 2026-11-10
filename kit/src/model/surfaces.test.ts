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
// здесь стоит сторож: у элемента ровно шесть названных ключей, любой лишний —
// назван строкой. Так «данные, а не отрисовка» проверяется, а не доказывается
// в переписке.
//
// ПАСПОРТА v3, 10.11.2026 (D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11). Контракт
// поменялся в двух местах, и оба — про то, КТО решает:
//  1) мест осталось ДВА: `own` (своя вкладка) и `content` (блоком в хвосте
//     текста). `more` УБРАН: «что не влезло» — вопрос ШИРИНЫ ЭКРАНА, а модель
//     про ширину ничего не знает и знать не может. Решает kit по месту: первые
//     по `order` в ряд, остальное под «Ещё» (shell/tabRow.ts). Поэтому `more`
//     здесь не «устаревшее значение, которое мы ещё принимаем», а ОШИБКА: приди
//     он из модели молча принятым, у человека снова появилось бы второе
//     решение о его экране, принятое сервером вслепую.
//  2) появилась ГРУППА: несколько разделов рисуются ОДНОЙ вкладкой с подписью
//     группы, внутри — подзаголовками. Это данные (какие разделы родственны), а
//     не форма (как их склеить).
import { describe, expect, it } from 'vitest';
import { SECTION_KEYS, applySections, gluedSections, passportSections, sectionGroups, unknownSections } from './surfaces';

const sprint = {
  decided: true,
  sections: [
    { key: 'tasks', source: 'part', ref: 'tasks', order: 1, slot: 'own' },
    { key: 'content', source: 'body', ref: null, order: 2, slot: 'own' },
    { key: 'phases', source: 'part', ref: 'phases', order: 3, slot: 'own' },
    { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 4, slot: 'content' },
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

  it('мест ровно два: своя вкладка и блок в хвосте текста', () => {
    const r = passportSections(model({ sprint }), 'sprint');
    expect(r.sections.filter(s => s.slot === 'content').map(s => s.key)).toEqual(['deps']);
    expect(r.sections.filter(s => s.slot === 'own').map(s => s.key)).toEqual(['tasks', 'content', 'phases']);
  });

  it('`slot: more` — ОШИБКА, а не молча принятое прошлое значение', () => {
    // Паспорта v3: «что не влезло» решает ширина экрана, а не сервер. Приняв
    // `more` молча, мы вернули бы ВТОРОЕ решение о чужом экране — принятое
    // вслепую, без знания ширины. Поэтому отказ: расхождение версий надо
    // увидеть, а не унаследовать.
    const old = { decided: true, sections: [{ ...sprint.sections[0], slot: 'more' }] };
    expect(() => passportSections(model({ sprint: old }), 'sprint')).toThrow(/slot/);
    expect(() => passportSections(model({ sprint: old }), 'sprint')).toThrow(/more/);
  });

  it('у типа нет записи — порядок НЕ решён, и это сказано, а не угадано', () => {
    const r = passportSections(model({ sprint }), 'adr');
    expect(r.decided).toBe(false);
    expect(r.sections).toEqual([]);
  });

  it('`surfaces` нет вовсе (сервер старее) — тоже «не решён», без ошибки', () => {
    expect(passportSections({}, 'sprint')).toEqual({ decided: false, sections: [], notes: [] });
    expect(passportSections(null, 'sprint')).toEqual({ decided: false, sections: [], notes: [] });
  });

  it('`decided: false` у типа — перечень игнорируется, порядок за приложением', () => {
    // Сервер прямо говорит «я не решал». Притворяться, что решал, нельзя.
    const r = passportSections(model({ sprint: { decided: false, sections: sprint.sections } }), 'sprint');
    expect(r.decided).toBe(false);
    expect(r.sections).toEqual([]);
  });
});

describe('сторож формы: данные, а не отрисовка', () => {
  it('положительный контроль: шесть законных ключей названы, включая `group`', () => {
    expect([...SECTION_KEYS].sort()).toEqual(['key', 'order', 'ref', 'slot', 'source', 'group'].sort());
  });

  it('`group` — законный ключ, а не «лишний»: он данные, как и остальные пять', () => {
    // До паспортов v3 сторож писал на `group` «лишние ключи … не прочитаны», то
    // есть модель говорила «эти разделы родственны», а клиент это ИГНОРИРОВАЛ,
    // сообщив об этом строкой, которую никто не читает.
    const withGroup = {
      decided: true,
      sections: [{ ...sprint.sections[0], group: { key: 'work', label: 'Работа' } }],
    };
    const r = passportSections(model({ sprint: withGroup }), 'sprint');
    expect(r.notes).toEqual([]);
    expect(r.sections[0].group).toEqual({ key: 'work', label: 'Работа' });
  });

  // ОСЛАБЛЕНО 09.11 по CJM, и это не смягчение требований, а исправление
  // вреда. Сначала лишний ключ отказывал ЦЕЛИКОМ. Серверная сессия проверила
  // условие по пути человека: добавь сервер безобидное поле — и клиент
  // потеряет ВЕСЬ порядок разделов, показав умолчание. Технически честно, а
  // человеку хуже, чем принять лишнее и сказать о нём строкой.
  //
  // Молчаливое игнорирование по-прежнему запрещено: оно спрятало бы попытку
  // положить в модель отрисовку. Поэтому исход один — принять и НАЗВАТЬ.
  it.each(['component', 'render', 'icon', 'label', 'tabs'])('лишний ключ «%s» — принят и НАЗВАН, порядок не потерян', extra => {
    const bad = { decided: true, sections: [{ ...sprint.sections[0], [extra]: 'x' }] };
    const r = passportSections(model({ sprint: bad }), 'sprint');
    expect(r.decided).toBe(true);
    expect(r.sections.map(s => s.key)).toEqual(['tasks']);
    expect(r.notes.join(' ')).toContain(extra);
    expect(r.notes.join(' ')).toMatch(/не прочитаны/);
  });

  it('отказ ОСТАЛСЯ там, где продолжение соврёт о структуре', () => {
    // Неизвестный slot и source: непонятно даже, куда девать раздел, и любое
    // решение за сервера показало бы неправду. Это условие 1 в части, которую
    // серверная сессия просила не ослаблять.
    const badSlot = { decided: true, sections: [{ ...sprint.sections[0], slot: 'sidebar' }] };
    const badSource = { decided: true, sections: [{ ...sprint.sections[0], source: 'widget' }] };
    expect(() => passportSections(model({ sprint: badSlot }), 'sprint')).toThrow(/slot/);
    expect(() => passportSections(model({ sprint: badSource }), 'sprint')).toThrow(/source/);
  });

  it('`group` без подписи — отказ: вкладка группы рисуется ЕЮ, и подменять её нечем', () => {
    // Та же граница, что у `slot`: продолжение соврало бы о структуре. Группа
    // без подписи дала бы безымянную вкладку, а подставить вместо неё ключ
    // раздела значило бы выдать служебное имя за человеческое.
    for (const bad of [{ key: 'work' }, { label: 'Работа' }, { key: 'work', label: '' }, 'work', 42]) {
      const doc = { decided: true, sections: [{ ...sprint.sections[0], group: bad }] };
      expect(() => passportSections(model({ sprint: doc }), 'sprint')).toThrow(/group/);
    }
  });

  it('`group` у раздела «в хвосте текста» — отказ: в конце текста групп не бывает', () => {
    // Условие серверной сессии дословно. Группа — это ОДНА ВКЛАДКА на несколько
    // разделов; у раздела без вкладки её складывать некуда, и молча уронить
    // группу значило бы потерять связь разделов без следа.
    const doc = {
      decided: true,
      sections: [{ ...sprint.sections[3], group: { key: 'work', label: 'Работа' } }],
    };
    expect(() => passportSections(model({ sprint: doc }), 'sprint')).toThrow(/group/);
  });

  it('`group` нет вовсе — это `null`, а не отказ: старый сервер шестого ключа не присылает', () => {
    const r = passportSections(model({ sprint }), 'sprint');
    expect(r.sections.map(s => s.group)).toEqual([null, null, null, null]);
  });

  it('раздел назван моделью, а у записи его нет — тоже сказано словами', () => {
    // Условие 5. Молчание означало бы: модель говорит «есть раздел», человек
    // его не видит, и никто не знает почему. Отказ тоже вреден — остальной
    // порядок верен.
    const order = passportSections(model({ sprint }), 'sprint');
    const notes = unknownSections([{ id: 'tasks' }], order);
    expect(notes.join(' ')).toMatch(/которых у записи нет/);
    expect(notes.join(' ')).toContain('content');
    expect(unknownSections([{ id: 'tasks' }, { id: 'content' }, { id: 'phases' }, { id: 'deps' }], order)).toEqual([]);
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
    { id: 'phases', label: 'Фазы' },
    { id: 'graph', label: 'Граф' },
  ];
  const order = passportSections(model({ sprint }), 'sprint');

  it('положительный контроль: порядок не решён — список не меняется вовсе', () => {
    expect(applySections(items, { decided: false, sections: [], notes: [] })).toEqual(items);
    expect(applySections(items)).toEqual(items);
  });

  it('названные моделью идут первыми, в её порядке', () => {
    const r = applySections(items, order);
    // tasks (1) → content/нет в списке → phases (3); затем остальное.
    expect(r.map(i => i.id)).toEqual(['tasks', 'phases', 'overview', 'graph']);
  });

  it('ВТОРОСТЕПЕННОСТЬ НЕ СТАВИТСЯ ВОВСЕ: модель про ширину экрана не знает', () => {
    // Паспорта v3: `more` убран, и вместе с ним — право модели решать, что
    // спрятать. applySections теперь только УПОРЯДОЧИВАЕТ. Если бы он
    // продолжал ставить `secondary`, у ряда вкладок было бы два хозяина: модель
    // прячет вслепую, kit прячет по ширине, и кто победил — зависело бы от
    // порядка строк в коде.
    const r = applySections(items, order);
    expect(r.every(i => i.secondary === undefined)).toBe(true);
  });

  it('ЧЕГО МОДЕЛЬ НЕ НАЗЫВАЛА — не прячется и остаётся как было', () => {
    // Граф, журнал, история — вкладки конструктора; модель о них не говорит.
    const r = applySections(items, order);
    expect(r.map(i => i.id)).toContain('graph');
    expect(r.map(i => i.id)).toContain('overview');
    // И их взаимный порядок прежний.
    expect(r.slice(2).map(i => i.id)).toEqual(['overview', 'graph']);
  });

  it('исходный массив не портится — функция чистая', () => {
    const copy = items.map(i => ({ ...i }));
    applySections(items, order);
    expect(items).toEqual(copy);
  });
});

describe('второе место: «в конце контента» — не вкладка вовсе', () => {
  // Повод — слова владелицы 09.11: «раньше блокирует и зависит был как
  // подраздел контента… вариант как пример адр в конце решения были списком и
  // это cjm работы просел и подтвердил». Булева мало: «под Ещё» и «в конце
  // контента» — РАЗНЫЕ МЕСТА, а не разная видимость.
  const withGlue = {
    decided: true,
    sections: [
      { key: 'tasks', source: 'part', ref: 'tasks', order: 1, slot: 'own' },
      { key: 'content', source: 'body', ref: null, order: 2, slot: 'own' },
      { key: 'deps', source: 'relation', ref: 'DEPENDS_ON:out', order: 3, slot: 'content' },
      { key: 'blocks', source: 'relation', ref: 'DEPENDS_ON:in', order: 4, slot: 'content' },
      { key: 'phases', source: 'part', ref: 'phases', order: 5, slot: 'own' },
    ],
  };
  const order = passportSections(model({ sprint: withGlue }), 'sprint');
  const items: { id: string; label: string; secondary?: boolean }[] = [
    { id: 'content', label: 'Текст' },
    { id: 'tasks', label: 'Задачи' },
    { id: 'deps', label: 'Зависит от' },
    { id: 'blocks', label: 'Блокирует' },
    { id: 'phases', label: 'Фазы' },
    { id: 'graph', label: 'Граф' },
  ];

  it('положительный контроль: два места разобраны', () => {
    expect(order.sections.map(s => s.slot)).toEqual(['own', 'own', 'content', 'content', 'own']);
  });

  it('вклеенные разделы УХОДЯТ из ряда вкладок вовсе', () => {
    const r = applySections(items, order);
    expect(r.map(i => i.id)).not.toContain('deps');
    expect(r.map(i => i.id)).not.toContain('blocks');
  });

  it('вклеенный не остаётся вкладкой ни в каком виде — иначе показался бы дважды', () => {
    const r = applySections(items, order);
    expect(r.map(i => i.id)).toEqual(['tasks', 'content', 'phases', 'graph']);
    // И ни одна вкладка не помечена второстепенной: прятать по ширине — работа
    // ряда вкладок, а не модели.
    expect(r.some(i => i.secondary)).toBe(false);
  });

  it('порядок ряда: своё по модели, затем незнакомое моделью', () => {
    const r = applySections(items, order);
    expect(r.map(i => i.id)).toEqual(['tasks', 'content', 'phases', 'graph']);
  });

  it('gluedSections отдаёт вклеенные в порядке модели', () => {
    expect(gluedSections(order).map(s => s.key)).toEqual(['deps', 'blocks']);
  });

  it('порядок не решён — вклеивать нечего, и ряд не тронут', () => {
    expect(gluedSections({ decided: false, sections: [], notes: [] })).toEqual([]);
    expect(gluedSections()).toEqual([]);
    expect(applySections(items, { decided: false, sections: [], notes: [] })).toEqual(items);
  });

  it('у вклеенного есть `ref` — по нему приложение и знает, что рисовать', () => {
    expect(gluedSections(order).map(s => s.ref)).toEqual(['DEPENDS_ON:out', 'DEPENDS_ON:in']);
  });
});

describe('порядок спринта с ПРОДА — ровно то, что просила владелица (CJM 09.11.2026)', () => {
  // Фрагмент, который серверная сессия выписала из своего кода
  // (`LorePassportSurface.build()`), слово в слово: у спринта пять разделов, у
  // двух из них slot content, у фаз — more.
  //
  // Проверка нужна потому, что на проде v1.17.7 порядок НЕ применился, и надо
  // было отделить «клиент не умеет» от «клиент не получил». Этот тест говорит:
  // получив такой документ, клиент раскладывает ровно так, как она просила —
  // «Спринт: первое, как ни странно, задачи, потом уже контент, а зависимости
  // и прочее можно скрыть под море».
  const PROD_SPRINT = {
    decided: true,
    sections: [
      { key: 'tasks', source: 'relation', ref: 'PART_OF:in', order: 1, slot: 'own' },
      { key: 'content', source: 'body', ref: null, order: 2, slot: 'own' },
      { key: 'dependsOn', source: 'relation', ref: 'DEPENDS_ON:out', order: 3, slot: 'content' },
      { key: 'blocks', source: 'relation', ref: 'DEPENDS_ON:in', order: 4, slot: 'content' },
      { key: 'phases', source: 'relation', ref: 'IN_PHASE:in', order: 5, slot: 'own' },
    ],
  };
  const model = { surfaces: { partial: true, passport: { sprint: PROD_SPRINT } } };
  const order = passportSections(model, 'sprint');

  /** Вкладки, как их строит паспорт: контент, задачи, связи, плюс чужая. */
  const items = [
    { id: 'content' }, { id: 'tasks' }, { id: 'dependsOn' }, { id: 'blocks' },
    { id: 'phases' }, { id: 'journal' },
  ];

  it('положительный контроль: документ принят, порядок решён', () => {
    expect(order.decided).toBe(true);
    expect(order.notes).toEqual([]);
  });

  it('ЗАДАЧИ ПЕРВЫМИ, потом контент — ровно просьба владелицы', () => {
    const out = applySections(items, order);
    expect(out.map(i => i.id).slice(0, 2)).toEqual(['tasks', 'content']);
  });

  it('зависимости уходят из ряда вкладок ВОВСЕ — иначе показались бы дважды', () => {
    const out = applySections(items, order);
    expect(out.map(i => i.id)).not.toContain('dependsOn');
    expect(out.map(i => i.id)).not.toContain('blocks');
    // И они же — в списке вклеиваемых в хвост тела, в порядке модели.
    expect(gluedSections(order).map(s => s.key)).toEqual(['dependsOn', 'blocks']);
  });

  it('фазы остаются вкладкой: прячет их ширина экрана, а не модель', () => {
    const out = applySections(items, order);
    expect(out.map(i => i.id)).toContain('phases');
    expect(out.find(i => i.id === 'phases')).toEqual({ id: 'phases' });
  });

  it('раздел, которого в модели нет, остаётся на месте и не прячется', () => {
    const out = applySections(items, order);
    expect(out.map(i => i.id)).toContain('journal');
  });
});

describe('группа: несколько разделов — ОДНА вкладка (паспорта v3, 10.11.2026)', () => {
  // Шестой ключ `group`: `{key, label}` либо `null`. Разделы одной группы идут
  // подряд и рисуются одной вкладкой с подписью группы; внутри — подзаголовки
  // по разделам, счётчик вкладки — СУММА счётчиков разделов.
  //
  // Почему это данные: «какие разделы родственны» знает тот, кто описал тип.
  // Почему это НЕ одна вкладка «от kit»: склеить что попало конструктор не
  // может — он не знает, что родственно, а что просто рядом по порядку.
  const grouped = {
    decided: true,
    sections: [
      { key: 'content', source: 'body', ref: null, order: 1, slot: 'own', group: null },
      { key: 'dependsOn', source: 'relation', ref: 'DEPENDS_ON:out', order: 2, slot: 'own', group: { key: 'ties', label: 'Связи' } },
      { key: 'blocks', source: 'relation', ref: 'DEPENDS_ON:in', order: 3, slot: 'own', group: { key: 'ties', label: 'Связи' } },
      { key: 'phases', source: 'relation', ref: 'IN_PHASE:in', order: 4, slot: 'own', group: null },
    ],
  };
  const order = passportSections(model({ sprint: grouped }), 'sprint');

  it('положительный контроль: документ принят целиком, без замечаний', () => {
    expect(order.decided).toBe(true);
    expect(order.notes).toEqual([]);
  });

  it('группа отдаётся ОДНИМ прогоном со своими разделами в порядке модели', () => {
    expect(sectionGroups(order)).toEqual([
      { group: { key: 'ties', label: 'Связи' }, keys: ['dependsOn', 'blocks'] },
    ]);
  });

  it('разделы без группы в прогоны не попадают — они сами себе вкладки', () => {
    expect(sectionGroups(order).flatMap(g => g.keys)).not.toContain('content');
    expect(sectionGroups(order).flatMap(g => g.keys)).not.toContain('phases');
  });

  it('порядок не решён — групп нет, и это не «нет групп», а «нечего группировать»', () => {
    expect(sectionGroups({ decided: false, sections: [], notes: [] })).toEqual([]);
    expect(sectionGroups()).toEqual([]);
  });

  it('разделы одной группы ОБЯЗАНЫ идти подряд — иначе отказ, а не тихая склейка', () => {
    // Склеивание идёт по соседству в порядке модели: это единственный способ
    // не перетасовать ряд. Разорви группу чужим разделом — и либо чужой
    // уедет внутрь группы, либо группа распадётся на две вкладки с одной
    // подписью. Оба исхода — неправда о структуре, поэтому отказ.
    const torn = {
      decided: true,
      sections: [
        { key: 'dependsOn', source: 'relation', ref: 'A', order: 1, slot: 'own', group: { key: 'ties', label: 'Связи' } },
        { key: 'phases', source: 'relation', ref: 'B', order: 2, slot: 'own', group: null },
        { key: 'blocks', source: 'relation', ref: 'C', order: 3, slot: 'own', group: { key: 'ties', label: 'Связи' } },
      ],
    };
    expect(() => passportSections(model({ sprint: torn }), 'sprint')).toThrow(/ties/);
  });

  it('у одной группы одна подпись: разошлись — отказ, иначе вкладка названа наугад', () => {
    const twoFaced = {
      decided: true,
      sections: [
        { key: 'dependsOn', source: 'relation', ref: 'A', order: 1, slot: 'own', group: { key: 'ties', label: 'Связи' } },
        { key: 'blocks', source: 'relation', ref: 'C', order: 2, slot: 'own', group: { key: 'ties', label: 'Зависимости' } },
      ],
    };
    expect(() => passportSections(model({ sprint: twoFaced }), 'sprint')).toThrow(/ties/);
  });

  it('группа не меняет порядок: applySections по-прежнему даёт разделы по `order`', () => {
    // Склейка в одну вкладку — дело того, кто рисует ряд (у него есть подписи и
    // счётчики). Здесь важно другое: разделы группы вышли СОСЕДЯМИ, иначе
    // склеивать по соседству было бы нельзя.
    const out = applySections(
      [{ id: 'phases' }, { id: 'blocks' }, { id: 'content' }, { id: 'dependsOn' }, { id: 'journal' }],
      order,
    );
    expect(out.map(i => i.id)).toEqual(['content', 'dependsOn', 'blocks', 'phases', 'journal']);
  });
});
