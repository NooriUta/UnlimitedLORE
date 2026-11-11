// У каждого типа своя статусная ось, и читается она СВОИМ словарём
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Повод — не рассуждение: сторож `statusCanon.test.ts` поймал меня на том, что
// статус решения я читал наивной склейкой слов (`normStatus`). Сторож писался
// про ось плана, но прав оказался шире: `shared/lore-statuses.json` объявляет
// словарь НА КАЖДУЮ ось, и склейка обходила их все.
//
// Здесь проверяется три вещи, и каждая однажды ломалась в этом проекте:
//   1. копия словарей в клиенте совпадает с shared (тот же приём, что у оси
//      плана в sprints.test.tsx: образ не видит shared/, поэтому копия);
//   2. значение ВНЕ своей оси становится «unknown», а не подгоняется под
//      похожий код — иначе грязь в данных замазывается;
//   3. оси не путаются между собой: статус решения не читается как статус
//      плана и наоборот.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DECISION_STATUSES, FEATURE_STATUSES, QUESTION_STATUSES, SPEC_STATUSES,
  axisStatusOf, decisionStatusOf, featureStatusOf, questionStatusOf, specStatusOf,
} from './axisStatus';
import { planStatusOf } from '../sprints/taskStatus';
import { decisionRecord, featureRecord, questionRecord, specRecord } from './records';

/** shared/lore-statuses.json — источник истины для объявленных осей. */
const shared = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'shared', 'lore-statuses.json'), 'utf8'),
) as Record<string, string[]>;

describe('статусные оси неплановых типов', () => {
  it('положительный контроль: shared прочитан и содержит объявленные оси', () => {
    expect(Array.isArray(shared.decisionStatuses)).toBe(true);
    expect(Array.isArray(shared.specStatuses)).toBe(true);
    expect(shared.decisionStatuses.length).toBeGreaterThan(0);
  });

  it('копия словаря решений совпадает с shared', () => {
    expect([...DECISION_STATUSES].sort()).toEqual([...shared.decisionStatuses].sort());
  });

  it('копия словаря спек совпадает с shared', () => {
    expect([...SPEC_STATUSES].sort()).toEqual([...shared.specStatuses].sort());
  });

  // S4-V2-SECTIONS, серверная часть: словари вопросов и фич появились в shared
  // (раньше жили только в коде записи) — копия сверяется с ними, как у решений и спек.
  it('копия словаря вопросов совпадает с shared', () => {
    expect(Array.isArray(shared.questionStatuses)).toBe(true);
    expect([...QUESTION_STATUSES].sort()).toEqual([...shared.questionStatuses].sort());
  });

  it('копия словаря фич совпадает с shared', () => {
    expect(Array.isArray(shared.featureStatuses)).toBe(true);
    expect([...FEATURE_STATUSES].sort()).toEqual([...shared.featureStatuses].sort());
  });

  it.each([
    ['accepted', 'accepted'],
    ['ACCEPTED', 'accepted'],
    ['  fixed  ', 'fixed'],
    ['superseded', 'superseded'],
  ])('решение: «%s» → «%s»', (raw, code) => {
    expect(decisionStatusOf(raw)).toBe(code);
  });

  it('решение: статус ВНЕ оси — «unknown», а не похожий код', () => {
    // Оба случая настоящие, из замера корпуса 09.11: 2 строки «rejected» и одна
    // «🚫 CANCELLED» — статус ЗАДАЧИ в поле статуса решения.
    expect(decisionStatusOf('rejected')).toBe('unknown');
    expect(decisionStatusOf('🚫 CANCELLED')).toBe('unknown');
  });

  it('решение: пусто и не-строка — «unknown» (46 строк корпуса без статуса)', () => {
    expect(decisionStatusOf(null)).toBe('unknown');
    expect(decisionStatusOf('')).toBe('unknown');
    expect(decisionStatusOf(7)).toBe('unknown');
  });

  it('спека: пустой статус — «unknown» (353 строки из 390)', () => {
    expect(specStatusOf(null)).toBe('unknown');
    expect(specStatusOf('proposed')).toBe('proposed');
  });

  it.each([...QUESTION_STATUSES])('вопрос: «%s» — свой код', code => {
    expect(questionStatusOf(code)).toBe(code);
  });

  it.each([...FEATURE_STATUSES])('фича: «%s» — свой код', code => {
    expect(featureStatusOf(code)).toBe(code);
  });

  it('оси не путаются: статус плана не читается как статус решения', () => {
    expect(decisionStatusOf('in_progress')).toBe('unknown');
    expect(decisionStatusOf('ready_for_deploy')).toBe('unknown');
    // И наоборот: «accepted» — не статус плана.
    expect(planStatusOf('accepted')).toBe('unknown');
  });

  it('похожесть не считается: ни маркера, ни совпадения по началу слова', () => {
    expect(axisStatusOf('accepted with changes', DECISION_STATUSES)).toBe('unknown');
    expect(axisStatusOf('✅ accepted', DECISION_STATUSES)).toBe('unknown');
  });

  it('мапперы берут статус своей осью, а не чужой', () => {
    expect(decisionRecord({ decision_id: 'D-1', title: 'd', status_raw: 'accepted' }).status).toBe('accepted');
    expect(decisionRecord({ decision_id: 'D-2', title: 'd', status_raw: 'rejected' }).status).toBe('unknown');
    expect(specRecord({ spec_id: 'S-1', title: 's', status: null }).status).toBe('unknown');
    expect(questionRecord({ question_id: 'Q-1', title: 'q', status: 'closed' }).status).toBe('closed');
    expect(featureRecord({ uc_id: 'F-1', title: 'f', status: 'shipped' }).status).toBe('shipped');
  });
});

// S4-STATUS-AXIS-CONFIG, хвост 11.11: ось из модели доходила до КОНФИГА списка,
// но не до ЧТЕНИЯ строки — маппер сверял статус с перечнем в коде, и статус,
// объявленный сервером в цикле типа, становился «вне словаря».
describe('S4-STATUS-AXIS-CONFIG · маппер читает статус по оси модели', () => {
  it('код из оси модели остаётся своим, даже если перечень в коде его не знает', () => {
    expect(decisionRecord({ decision_id: 'D', status_raw: 'rejected' }, { statusCodes: ['accepted', 'rejected'] }).status).toBe('rejected');
    expect(specRecord({ spec_id: 'S', status: 'draft' }, { statusCodes: ['draft'] }).status).toBe('draft');
    expect(questionRecord({ question_id: 'Q', status: 'parked' }, { statusCodes: ['parked'] }).status).toBe('parked');
    expect(featureRecord({ uc_id: 'F', status: 'paused' }, { statusCodes: ['paused'] }).status).toBe('paused');
  });

  it('вне оси модели — «вне словаря», даже если код есть в перечне клиента', () => {
    expect(decisionRecord({ decision_id: 'D', status_raw: 'done' }, { statusCodes: ['accepted'] }).status).toBe('unknown');
  });

  it('оси модели нет (пусто) — перечень в коде, как раньше', () => {
    expect(decisionRecord({ decision_id: 'D', status_raw: 'accepted' }, { statusCodes: [] }).status).toBe('accepted');
    expect(decisionRecord({ decision_id: 'D', status_raw: 'rejected' }).status).toBe('unknown');
  });
});
