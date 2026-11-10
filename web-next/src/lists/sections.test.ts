// Восемь оставшихся разделов v2: источник, разбор строки, честные оговорки
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Формы строк взяты не из головы: каждая — из живой выдачи своего среза
// (замер 09.11), вплоть до мусора, который там реально лежит: `null` в списке
// спринтов вехи, пустой статус у спеки, статус задачи в поле статуса решения.
// Тест на выдуманной форме проверяет мою фантазию, а не разбор — это урок графа
// (S5-10: заглушка разбирала несуществующий контракт).
import { describe, expect, it } from 'vitest';
import { colKey, matchFilter } from '@seidr/kit';
import { LIST_SCREENS, type ListScreenDef } from './screens';
import {
  componentRecord, decisionRecord, featureRecord, milestoneRecord,
  questionRecord, releaseRecord, specRecord, techRecord,
} from './records';

/**
 * Строки среза `use_cases` — РОВНО его столбцы (сверено по
 * `backend/.../LoreSlices.java`, `slice("use_cases", …)`): `uc_id, title,
 * status, goal_level, rigor, priority, parent_uc_id, date_created, shipped_at,
 * component_ids, projects, parent_uc_ids, uc_total, task_count`. Вехи, тел и
 * числа готовых детей (`uc_shipped`) среди них НЕТ — поэтому их нет и здесь,
 * иначе тест проверял бы мою фантазию, а не разбор.
 *
 * Значения — из живой выдачи 10.11 (`features` и `use_cases_of_feature`):
 * у корня FEAT-VP-FIT свои компонент и проект есть, у детей
 * FEAT-LORE-HONEST — ни того, ни другого (5 из 5), только наследованные.
 */
const UC_ROW_ROOT: Record<string, unknown> = {
  uc_id: 'FEAT-VP-FIT', title: 'Фича', status: 'shipped',
  goal_level: 'kite', rigor: 'fully-dressed', priority: null, parent_uc_id: null,
  date_created: '2026-07-23', shipped_at: '2026-07-23',
  component_ids: ['FORSETI'], projects: ['NooriUta/UnlimitedLORE'], parent_uc_ids: [],
  uc_total: 5, task_count: 0,
};

const UC_ROW_CHILD: Record<string, unknown> = {
  uc_id: 'UC-HONEST-SCAN', title: 'Сценарий', status: 'shipped',
  goal_level: 'sea-level', rigor: 'fully-dressed', priority: 'high',
  parent_uc_id: 'FEAT-LORE-HONEST', date_created: '2026-08-01', shipped_at: '2026-08-10',
  component_ids: [], projects: [], parent_uc_ids: ['FEAT-LORE-HONEST'],
  uc_total: 0, task_count: 3,
};

describe('разделы v2: источник выбран и назван', () => {
  it.each([
    ['decisions', 'decisions'],
    ['specs', 'specs'],
    ['milestones', 'milestones'],
    ['releases', 'releases'],
    ['components', 'components'],
    ['tech', 'tech_registry'],
    // S4-V2-SECTIONS, «US разделом»: `use_cases`, а НЕ `features`. Второй по
    // построению режет выдачу до корней шкалы целей (`goal_level IN
    // ['cloud','kite']`) — на 10.11 это 8 строк при 31 вложенном сценарии
    // только у них, то есть раздел показывал пятую часть корпуса.
    ['features', 'use_cases'],
  ] as const)('раздел %s читает срез %s', (id, slice) => {
    expect(LIST_SCREENS[id].slice).toBe(slice);
  });

  /**
   * `open_questions` — синоним на переход, и он ОБМАНЫВАЕТ именем: отдаёт все
   * вопросы, а не только открытые (замер: 182 закрытых из 262). В решении
   * D-2026-LORE-QUESTIONS-SLICE-RENAME названа ровно эта беда — «потребители
   * читали закрытые как открытые». Сторож держит канонное имя.
   */
  it('вопросы читают `questions`, а НЕ синоним `open_questions`', () => {
    expect(LIST_SCREENS.questions.slice).toBe('questions');
  });

  /**
   * ПРАВИЛО, а не случай: оговорка живёт ровно столько, сколько живёт её
   * причина. Обрезку до корней снял срез `use_cases` (все уровни шкалы), и
   * оговорка про уровни стала неправдой — «показаны только верхние» при
   * выдаче всех уровней хуже молчания: человек решит, что остального нет.
   */
  it('оговорка фич больше не говорит про обрезку до корней — обрезки нет', () => {
    expect(LIST_SCREENS.features.note).not.toMatch(/cloud|kite/i);
    expect(LIST_SCREENS.features.note).not.toMatch(/верхн/i);
  });

  /**
   * Но срез и правда отдаёт НЕ ВСЁ — другое: компонент и проект только СВОИ.
   * Замер 10.11 по FEAT-LORE-HONEST: у 5 из 5 вложенных сценариев
   * `component_ids` и `projects` пусты, а `inherited_projects` заполнен —
   * привязка наследуется от фичи, и `use_cases` наследованного не отдаёт.
   * Без слов пустая «Компонент»/«Проект» у 31 строки прочтётся как «не
   * привязано», а это «привязано у родителя».
   */
  it('у фич оговорка про НАСТОЯЩУЮ причину: свои компонент и проект, не наследованные', () => {
    expect(LIST_SCREENS.features.note).toBeTruthy();
    expect(LIST_SCREENS.features.note).toMatch(/наследу/i);
    expect(LIST_SCREENS.features.note).toMatch(/компонент/i);
    expect(LIST_SCREENS.features.note).toMatch(/проект/i);
  });

  it('разделы без оговорки её и не имеют — пустая строка была бы шумом', () => {
    for (const id of ['decisions', 'specs', 'questions', 'milestones', 'releases', 'components', 'tech'] as const) {
      // Через общий тип описателя: у `as const`-записей без `note` свойства в
      // типе нет вовсе, и обращение к нему тогда не компилируется.
      expect((LIST_SCREENS[id] as ListScreenDef).note, id).toBeUndefined();
    }
  });
});

describe('разбор строк: формы из живой выдачи', () => {
  it('решение: статус своей оси, компонент и родительский ADR', () => {
    const r = decisionRecord({
      decision_id: 'D-2026-LORE-X', title: 'Решение', date_created: '2026-11-01',
      status_raw: 'accepted', component_id: 'FORSETI', components: ['FORSETI', 'OMILORE'],
      projects: ['NooriUta/UnlimitedLORE'], tags: [], parent_adr: 'ADR-LORE-048',
    });
    expect(r.kind).toBe('decision');
    expect(r.status).toBe('accepted');
    expect(r.fields.adr).toBe('ADR-LORE-048');
    // Многозначное осталось списком, а не склеилось в «FORSETI, OMILORE».
    expect(r.fields.components).toEqual(['FORSETI', 'OMILORE']);
    expect(r.updated_at).toBe('2026-11-01');
  });

  it('спека: пустой статус — «неизвестно», тело в строку не попало', () => {
    const r = specRecord({
      spec_id: 'SPEC-MINILORE-PHONE-API', title: 'API телефона', file_path: 'docs/spec.md',
      component_id: 'MINILORE_APP', version: '3', summary: 'длинная аннотация ревизии',
      status: null, projects: ['AIDA/miniLORE'],
    });
    expect(r.status).toBe('unknown');
    expect(r.fields.version).toBe('3');
    expect(Object.keys(r.fields)).not.toContain('summary');
  });

  it('вопрос: тело НЕ переносится — 576 КБ на 262 строки', () => {
    const r = questionRecord({
      question_id: 'OQ-027', title: 'Вопрос', body_md: 'очень длинное тело вопроса',
      status: 'open', component_id: 'OMILORE', components: ['OMILORE'], due_date: null,
      priority: 'normal', owner: 'omiloreadmin', opened_date: '2026-07-17',
      gating_tasks: ['SPRINT_X/A-1'], raised_adr: ['ADR-LORE-032'], projects: [],
    });
    expect(r.status).toBe('open');
    expect(Object.keys(r.fields)).not.toContain('body_md');
    expect(r.fields.gates).toEqual(['SPRINT_X/A-1']);
    expect(r.fields.owner).toBe('omiloreadmin');
  });

  it('веха: статуса НЕТ, а null среди спринтов отброшен', () => {
    const r = milestoneRecord({
      milestone_id: 'M-PRODUCT-UI', label: 'Продуктовый слой', week: null,
      date_display: 'июль 2026 (закрыта)', priority: 'low', goal_md: 'длинная цель',
      direct_sprint_ids: [null], products: ['OMILORE'],
    });
    expect(r.title).toBe('Продуктовый слой');
    expect(r.status).toBe('');
    // Веха без спринтов: в данных это массив из одного null.
    expect(r.fields.sprints).toEqual([]);
    expect(Object.keys(r.fields)).not.toContain('goal_md');
  });

  it('веха со спринтами: список сохранён целиком', () => {
    const r = milestoneRecord({
      milestone_id: 'M-LORE-CLIENT-SAFE', label: 'O1', week: 0,
      direct_sprint_ids: ['SPRINT_A', 'SPRINT_B', null], products: ['OMILORE'], priority: 'high',
    });
    expect(r.fields.sprints).toEqual(['SPRINT_A', 'SPRINT_B']);
    expect(r.fields.week).toBe(0);
  });

  it('релиз: код — деловой ключ, статуса НЕТ', () => {
    const r = releaseRecord({
      release_id: 'r1', release_uid: 'unlimitedlore-v1.17.4', git_tag: 'v1.17.4',
      version: '1.17.4', week: 29, type: 'release', release_date: '2026-11-08',
      is_current: true, description_md: 'длинное описание', git_project: 'AIDA/UnlimitedLORE',
      projects: ['AIDA/UnlimitedLORE'], sprint_count: 3, pr_count: 11,
    });
    expect(r.id).toBe('unlimitedlore-v1.17.4');
    expect(r.title).toBe('v1.17.4');
    expect(r.status).toBe('');
    expect(r.fields.current).toBe(true);
    expect(r.fields.prs).toBe(11);
    expect(Object.keys(r.fields)).not.toContain('description_md');
  });

  it('компонент: статуса НЕТ, своя иконка перенесена полем', () => {
    const r = componentRecord({
      component_id: 'FORSETI', full_name: 'Forseti', area: 'LORE', parent_id: null,
      game_icon: 'scales', owner: 'arharaga', team: null,
      children: ['FORSETI_UI'], tech: ['TECH-REACT'], git_projects: ['NooriUta/UnlimitedLORE'],
      adr_count: 12, spec_count: 3,
    });
    expect(r.status).toBe('');
    expect(r.title).toBe('Forseti');
    expect(r.fields.icon).toBe('scales');
    expect(r.fields.adrs).toBe(12);
  });

  it('технология: статуса НЕТ, тело спеки не перенесено', () => {
    const r = techRecord({
      spec_id: 'SPEC-TECH-REACT', tech_name: 'React', version: '19.1.0',
      content_md: 'длинное тело спеки', checked_at: '2026-11-01T00:00:00Z', component_id: 'FORSETI',
    });
    expect(r.title).toBe('React');
    expect(r.status).toBe('');
    expect(r.fields.version).toBe('19.1.0');
    expect(Object.keys(r.fields)).not.toContain('content_md');
    expect(r.updated_at).toBe('2026-11-01T00:00:00Z');
  });

  it('фича: числа сценариев и задач — готовыми числами среза, без догрузки', () => {
    const r = featureRecord(UC_ROW_ROOT);
    expect(r.status).toBe('shipped');
    expect(r.fields.ucs).toBe(5);
    expect(r.fields.tasks).toBe(0);
    expect(Object.keys(r.fields)).not.toContain('body_md');
  });

  it('фича без чисел сценариев: поля нет вовсе — «—», а не «0»', () => {
    const r = featureRecord({ uc_id: 'FEAT-X', title: 'Фича', status: 'active', uc_total: null, task_count: null });
    expect(Object.keys(r.fields)).not.toContain('ucs');
    expect(Object.keys(r.fields)).not.toContain('tasks');
  });

  /**
   * ПРАВИЛО: «не прислали» ≠ «пусто». Столбца `milestone_id` в срезе
   * `use_cases` нет вовсе (сверено по `LoreSlices.java`), и подставить вместо
   * него пустую строку — значит УТВЕРЖДАТЬ «вехи нет» про каждую запись.
   * Цена утверждения уже была посчитана: быстрый фильтр «Без вехи» на таком
   * поле совпадает со ВСЕЙ выдачей (kit: '' совпадает с отсутствующим).
   */
  it('столбца, которого в срезе нет, маппер не выдумывает: поля нет, а не пусто', () => {
    const r = featureRecord(UC_ROW_CHILD);
    expect(Object.keys(r.fields)).not.toContain('milestone');
  });

  it('столбец прислали пустым — это ответ «пусто», и поле есть', () => {
    const r = featureRecord({ ...UC_ROW_CHILD, milestone_id: null });
    expect(r.fields.milestone).toBe('');
  });

  /**
   * Родитель — РЕБРОМ `DECOMPOSES_INTO`, а плоское `parent_uc_id` рядом с ним
   * денормализация (так сказано у самого слайса и так устроен паспорт:
   * `ref("parent", …, "DECOMPOSES_INTO", "in", …)`). Читать только плоское
   * поле значит терять родителя там, где денормализацию не записали.
   */
  it('родитель сценария берётся из ребра, плоское поле — только подстановка', () => {
    const byEdge = featureRecord({ ...UC_ROW_CHILD, parent_uc_id: null, parent_uc_ids: ['FEAT-LORE-HONEST'] });
    expect(byEdge.fields.parent).toEqual(['FEAT-LORE-HONEST']);
    const byFlat = featureRecord({ ...UC_ROW_CHILD, parent_uc_id: 'FEAT-LORE-HONEST', parent_uc_ids: [] });
    expect(byFlat.fields.parent).toBe('FEAT-LORE-HONEST');
  });

  /**
   * ПРАВИЛО раздела: всё, на что он смотрит — колонка, фасет, разрез, быстрый
   * фильтр — должно быть полем, которое маппер КЛАДЁТ на строках своего среза.
   * Иначе колонка пустая, фасет без значений, а быстрый фильтр «без X»
   * отвечает «все» — и ни одно из этих мест не скажет, что оно смотрит в
   * никуда.
   */
  it('раздел фич не смотрит ни на одно поле, которого маппер не кладёт', () => {
    const cfg = LIST_SCREENS.features.config('ru');
    const own = new Set(['id', 'title', 'status', 'kind', 'updated_at']);
    const refs = [
      ...(cfg.list?.filters ?? []),
      ...(cfg.list?.groupings ?? []),
      ...(cfg.list?.columns ?? []),
      ...(cfg.list?.quick ?? []).flatMap(q => Object.keys(q.filter)),
    ];
    // По ОБЕИМ формам строки: у корня и у вложенного сценария заполнено разное,
    // и поле, которое есть только у одной из них, раздел тоже вправе показывать.
    const placed = new Set([
      ...Object.keys(featureRecord(UC_ROW_ROOT).fields),
      ...Object.keys(featureRecord(UC_ROW_CHILD).fields),
    ]);
    for (const ref of refs) {
      const key = colKey(ref).replace(/^fields\./, '');
      if (own.has(key)) continue;
      expect([...placed], ref).toContain(key);
    }
  });

  /**
   * «Сценариев x/y» снято НЕ по вкусу: `uc_shipped` (готовых детей) в срезе
   * `use_cases` нет, а прогресс без второго числа — колонка прочерков.
   * Колонка прогресса здесь была бы обещанием подсчёта, которого нет.
   */
  it('колонка прогресса снята: срез не отдаёт числа готовых сценариев', () => {
    const cols = LIST_SCREENS.features.config('ru').list?.columns ?? [];
    expect(cols.find(c => c.startsWith('progress:'))).toBeUndefined();
    expect(cols).toContain('ucs');
  });

  /**
   * Переход в паспорт. Список открывает запись своим `id` (ListScreen →
   * `/lore/record/feature/<id>`), а тип паспорта у раздела — `feature`, то есть
   * KnowUseCase ЛЮБОГО уровня (так заведён тип на сервере). Значит ключом
   * обязан быть `uc_id` и у вложенного сценария тоже — иначе щелчок по US уйдёт
   * в 404, и это будет выглядеть как «записи нет».
   */
  it('в паспорт уходит uc_id — и у фичи, и у вложенного сценария', () => {
    expect(featureRecord(UC_ROW_ROOT).id).toBe('FEAT-VP-FIT');
    expect(featureRecord(UC_ROW_CHILD).id).toBe('UC-HONEST-SCAN');
    expect(featureRecord(UC_ROW_CHILD).kind).toBe('feature');
  });

  /** Быстрый фильтр, совпадающий со всей выдачей, — не фильтр, а обман. */
  it('быстрые фильтры фич что-то отбирают, а не отвечают «все»', () => {
    const quick = LIST_SCREENS.features.config('ru').list?.quick ?? [];
    expect(quick.length).toBeGreaterThan(0);
    const pool = [featureRecord(UC_ROW_ROOT), featureRecord(UC_ROW_CHILD)];
    for (const q of quick) {
      const hit = pool.filter(r => matchFilter(r, q.filter));
      expect(hit.length, `${q.id}: совпало со всей выдачей`).toBeLessThan(pool.length);
    }
  });
});
