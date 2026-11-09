// Декларативная часть конфига порождается из модели, а не пишется руками
// (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER, K-14).
//
// Повод — слова владелицы 09.11.2026, три подряд: «зачем тебе словарь статусов
// на своей стороне, если это задача уже конкретного приложения»; «я думала, для
// этого отдельный элемент модели будет, типа справочники статусов и workflow по
// объектам, присылать в kit»; «так заводите — завтра кто-нибудь будет на kit
// собирать своё приложение и?». И отдельно, тем же днём: «конкретика на её
// стороне, а не на стороне kit».
//
// ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО. Генератор живёт в kit, но НИЧЕГО не знает про LORE:
// он берёт документ и отдаёт части конфига. Какие статусы, какие типы, какие
// поля — говорит документ. Поэтому «Дата-странники» со своей моделью получат
// свой конфиг без правки конструктора, а это и есть защита от форка (K-10).
//
// ЧЕСТНЫЕ СОСТОЯНИЯ ЗДЕСЬ ВАЖНЕЕ УДОБСТВА. Каждый пропуск в документе
// называется строкой: нет раздела · нет словаря · статья без кода · цвет не
// токен · поле без вида. Молчаливое умолчание — худший исход: приложение
// выглядит настроенным по модели, а показывает своё.
import { describe, expect, it } from 'vitest';
import { configFromModel } from './configFromModel';
import { parseModel } from './loadModel';

const ICON = 'sprint';

const doc = {
  format: 'model/0',
  version: '2026-11-09T00:00:00Z',
  statuses_known: ['task'],
  statuses: {
    task: {
      entries: [
        { code: 'active', title: 'В работе', category: 'in_progress', icon: 'progression', color: 'var(--st-active)', order: 2 },
        { code: 'done', title: 'Готово', category: 'finished', icon: 'divided-spiral', color: 'var(--st-done)', order: 9 },
      ],
    },
  },
  types: {
    sprint: {
      type: 'sprint',
      label: 'Спринт',
      icon: ICON,
      fields: [
        { key: 'title', label: 'Название', kind: 'text', group: 'head', visibility: 'visible', display: { priority: 1, width: 'fill', overflow: 'ellipsis' } },
        { key: 'priority', label: 'Приоритет', kind: 'number', group: 'props', visibility: 'visible', display: { priority: 3, width: 's', overflow: 'none' } },
        { key: 'secret', label: 'Служебное', kind: 'text', group: 'props', visibility: 'internal', display: { priority: 4, width: 's', overflow: 'none' } },
      ],
      relations: [
        { key: 'tasks', label: 'Задачи', rel: 'PART_OF', dir: 'in', relation: 'composition', place: 'link_tab' },
        { key: 'project', label: 'Проект', rel: 'BELONGS_TO_PROJECT', dir: 'out', relation: 'attribute', place: 'field' },
      ],
    },
  },
};

const model = parseModel(doc);

describe('configFromModel: статусы приходят данными', () => {
  it('положительный контроль: статьи словаря стали статусами конфига', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.statuses.map(s => s.code)).toEqual(['active', 'done']);
    expect(r.statuses[0].title).toBe('В работе');
    expect(r.statuses[0].icon).toBe('progression');
  });

  it('порядок — из модели, а не из порядка ключей JSON', () => {
    const shuffled = { ...doc, statuses: { task: { entries: [...doc.statuses.task.entries].reverse() } } };
    const r = configFromModel(parseModel(shuffled), { statusDict: 'task' });
    expect(r.statuses.map(s => s.code)).toEqual(['active', 'done']);
  });

  it('категории шестизначной оси сводятся к четырём категориям контракта', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.statuses.find(s => s.code === 'active')?.category).toBe('active');
    expect(r.statuses.find(s => s.code === 'done')?.category).toBe('done');
  });

  it('нет раздела статусов — сказано словами, а не пустой словарь молча', () => {
    const r = configFromModel(parseModel({ format: 'model/0', version: 'v1' }), { statusDict: 'task' });
    expect(r.statuses).toEqual([]);
    expect(r.notes.statuses.join(' ')).toMatch(/нет раздела statuses/);
  });

  it('словаря с таким именем нет — названо имя, которое искали', () => {
    const r = configFromModel(model, { statusDict: 'adr_status' });
    expect(r.statuses).toEqual([]);
    expect(r.notes.statuses.join(' ')).toContain('adr_status');
  });

  it('статья без кода пропущена и названа', () => {
    const bad = { ...doc, statuses: { task: { entries: [{ title: 'Без кода' }] } } };
    const r = configFromModel(parseModel(bad), { statusDict: 'task' });
    expect(r.statuses).toEqual([]);
    expect(r.notes.statuses.join(' ')).toMatch(/без кода/);
  });

  it('цвет не токен — статус показан, но нейтральным, и это сказано', () => {
    const bad = { ...doc, statuses: { task: { entries: [{ code: 'x', title: 'X', category: 'in_progress', icon: ICON, color: '#ff0000' }] } } };
    const r = configFromModel(parseModel(bad), { statusDict: 'task' });
    // Статус НЕ выбрасывается: иначе запись осталась бы без чипа вовсе.
    expect(r.statuses.map(s => s.code)).toEqual(['x']);
    expect(r.statuses[0].color).toMatch(/^var\(--/);
    expect(r.notes.statuses.join(' ')).toMatch(/не токен/);
  });
});

describe('configFromModel: виды записей из типов модели', () => {
  it('положительный контроль: тип стал видом с названием и значком', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.kinds.sprint.title).toBe('Спринт');
    expect(r.kinds.sprint.icon).toBe(ICON);
  });

  it('служебные поля в вид НЕ попадают — их и сервер не показывает', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.kinds.sprint.fields?.map(f => f.key)).toEqual(['title', 'priority']);
  });

  it('вид поля модели переводится в тип поля конфига', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.kinds.sprint.fields?.find(f => f.key === 'priority')?.type).toBe('number');
  });

  it('связи с местом «вкладка» становятся связями вида, поля-связи — нет', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.kinds.sprint.relations?.map(x => x.key)).toEqual(['tasks']);
  });

  it('display доходит отдельной картой: он нужен колонкам, а не виду', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.display.sprint.title).toEqual({ priority: 1, width: 'fill', overflow: 'ellipsis' });
    // Служебное поле в карту не идёт: его не показывают.
    expect(r.display.sprint.secret).toBeUndefined();
  });

  it('раздела types нет — видов нет, и это названо', () => {
    const r = configFromModel(parseModel({ format: 'model/0', version: 'v1' }), { statusDict: 'task' });
    expect(r.kinds).toEqual({});
    expect(r.notes.kinds.join(' ')).toMatch(/нет раздела types/);
  });

  it('у поля нет вида — поле показано текстом, и это сказано', () => {
    const bad = {
      ...doc,
      types: { sprint: { label: 'С', icon: ICON, fields: [{ key: 'a', label: 'A', visibility: 'visible' }], relations: [] } },
    };
    const r = configFromModel(parseModel(bad), { statusDict: 'task' });
    expect(r.kinds.sprint.fields?.[0].type).toBe('text');
    expect(r.notes.kinds.join(' ')).toMatch(/вид поля/);
  });

  it('генератор НЕ знает ни одного имени из LORE — проверка грепом по исходнику', async () => {
    // Это и есть водораздел: предметные имена живут в документе, а не в коде
    // конструктора. Если здесь появится «sprint» или «task_status», чужое
    // приложение на kit получит словари LORE.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./configFromModel.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const name of ['sprint', 'task_status', 'adr', 'SPRINT_']) {
      expect(code, `в коде генератора найдено предметное имя «${name}»`).not.toContain(name);
    }
  });
});

describe('своя ось приложения: точка расширения вместо правки kit', () => {
  it('положительный контроль: без своей оси работает таблица по умолчанию', () => {
    const r = configFromModel(model, { statusDict: 'task' });
    expect(r.statuses.find(s => s.code === 'done')?.category).toBe('done');
  });

  it('приложение со своей осью переводит само, kit не правится', () => {
    // «Дата-странники» (K-08, пилот) придут со своими словами. Без этой точки
    // расширения им пришлось бы править конструктор — ровно та угроза форка,
    // под которую заведена K-10.
    const own = {
      ...doc,
      statuses: { task: { entries: [{ code: 'shipped', title: 'Отгружено', category: 'отгружено', icon: ICON, color: 'var(--st-done)' }] } },
    };
    const r = configFromModel(parseModel(own), {
      statusDict: 'task',
      categoryOf: raw => (raw === 'отгружено' ? 'done' : undefined),
    });
    expect(r.statuses[0].category).toBe('done');
    // И ни одной жалобы: категория переведена, а не угадана.
    expect(r.notes.statuses.filter(n => n.includes('категория'))).toEqual([]);
  });

  it('своя ось вернула undefined — работает умолчание, незнакомое названо', () => {
    const own = {
      ...doc,
      statuses: { task: { entries: [{ code: 'x', title: 'X', category: 'чужое', icon: ICON, color: 'var(--t3)' }] } },
    };
    const r = configFromModel(parseModel(own), { statusDict: 'task', categoryOf: () => undefined });
    expect(r.statuses[0].category).toBe('active');
    expect(r.notes.statuses.join(' ')).toMatch(/категория «чужое» неизвестна/);
  });
});

describe('перенесено из приложения вместе с генератором', () => {
  // Это утверждение жило в web-next (`statusesFromModel`), откуда разбор
  // переехал в kit. Переносится, а не теряется: оно про правило, а не про
  // реализацию — статус, который ЕСТЬ В ДАННЫХ, виден, даже если документ
  // помечает его «не из справочника». Прятать его значило бы показать запись
  // без чипа вовсе.
  it('статус вне справочника не прячется: он есть в данных, значит виден', () => {
    const odd = {
      ...doc,
      statuses: {
        task: {
          entries: [{ code: 'странный', title: 'Странный', category: 'in_progress', in_dictionary: false, color: null, icon: null }],
        },
      },
    };
    const r = configFromModel(parseModel(odd), { statusDict: 'task' });
    expect(r.statuses.map(s => s.code)).toContain('странный');
    // И при этом сказано, чего у него не хватает.
    expect(r.notes.statuses.join(' ')).toMatch(/цвет/);
    expect(r.notes.statuses.join(' ')).toMatch(/значок/);
  });
});
