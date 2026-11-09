// Восемь оставшихся разделов v2: источник, разбор строки, честные оговорки
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Формы строк взяты не из головы: каждая — из живой выдачи своего среза
// (замер 09.11), вплоть до мусора, который там реально лежит: `null` в списке
// спринтов вехи, пустой статус у спеки, статус задачи в поле статуса решения.
// Тест на выдуманной форме проверяет мою фантазию, а не разбор — это урок графа
// (S5-10: заглушка разбирала несуществующий контракт).
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS, type ListScreenDef } from './screens';
import {
  componentRecord, decisionRecord, featureRecord, milestoneRecord,
  questionRecord, releaseRecord, specRecord, techRecord,
} from './records';

describe('разделы v2: источник выбран и назван', () => {
  it.each([
    ['decisions', 'decisions'],
    ['specs', 'specs'],
    ['milestones', 'milestones'],
    ['releases', 'releases'],
    ['components', 'components'],
    ['tech', 'tech_registry'],
    ['features', 'features'],
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

  /** Срез фич режет выдачу до корней шкалы целей — об этом сказано словами. */
  it('у фич есть оговорка про уровни целей, иначе «8 из 8» соврёт', () => {
    expect(LIST_SCREENS.features.note).toBeTruthy();
    expect(LIST_SCREENS.features.note).toMatch(/cloud|kite|уровн/i);
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

  it('фича: прогресс сценариев — готовыми числами среза, без догрузки', () => {
    const r = featureRecord({
      uc_id: 'FEAT-VP-FIT', title: 'Фича', body_md: 'ценность', context_md: 'контекст',
      status: 'shipped', component_id: 'FORSETI', date_created: '2026-07-23',
      goal_level: 'kite', shipped_at: '2026-07-23', parent_uc_id: null,
      component_ids: ['FORSETI'], projects: [], uc_total: 5, uc_shipped: 5,
      milestone_id: 'M-PRODUCT-UI',
    });
    expect(r.status).toBe('shipped');
    expect(r.fields.ucs).toEqual({ done: 5, total: 5 });
    expect(Object.keys(r.fields)).not.toContain('body_md');
  });

  it('фича без чисел сценариев: поля нет вовсе — «—», а не «0/0»', () => {
    const r = featureRecord({ uc_id: 'FEAT-X', title: 'Фича', status: 'active', uc_total: null, uc_shipped: null });
    expect(Object.keys(r.fields)).not.toContain('ucs');
  });

  it('колонка прогресса фич названа тем же полем, что кладёт маппер', () => {
    const cols = LIST_SCREENS.features.config('ru').list?.columns ?? [];
    const progress = cols.find(c => c.startsWith('progress:'));
    expect(progress).toBe('progress:ucs');
    const r = featureRecord({ uc_id: 'F', title: 'f', status: 'active', uc_total: 2, uc_shipped: 1 });
    // Поле, на которое смотрит колонка, в записи есть — иначе колонка пустая.
    expect(r.fields[(progress as string).slice('progress:'.length)]).toEqual({ done: 1, total: 2 });
  });
});
