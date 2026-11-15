// SPRINT_UXR_POLISH_UAT_1113/PU-29: раздел показывает паспорт записи ЧУЖОГО вида (задача
// в «Спринтах»), когда вид назван в адресе (?okind=task). Без вида — паспорт вида экрана;
// неизвестный вид — тоже экран, а не пустота: адрес мог прийти руками или из старой ссылки.
import { describe, expect, it } from 'vitest';
import { passportTypeFor } from './ListScreen';

describe('passportTypeFor: вид паспорта открытой записи', () => {
  it('вид в адресе — паспорт этого вида', () => {
    expect(passportTypeFor('sprints', 'task')).toBe('task');
  });
  it('вида в адресе нет — паспорт вида экрана', () => {
    expect(passportTypeFor('sprints', null)).toBe('sprint');
  });
  it('неизвестный вид — паспорт вида экрана, а не пустота', () => {
    expect(passportTypeFor('sprints', 'nonsense')).toBe('sprint');
  });
});
