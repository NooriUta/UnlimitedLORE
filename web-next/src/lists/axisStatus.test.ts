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

  it('у вопросов и фич словаря в shared НЕТ — это пробел, а не ошибка теста', () => {
    // Если он там появится, тест обязан покраснеть: тогда копию надо сверять с
    // ним, а не держать перечень, снятый замером корпуса.
    expect(shared.questionStatuses, 'словарь вопросов появился в shared — сверьте копию с ним').toBeUndefined();
    expect(shared.featureStatuses, 'словарь фич появился в shared — сверьте копию с ним').toBeUndefined();
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
