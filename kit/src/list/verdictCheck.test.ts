// SPRINT_UXR_S13_KIT4/K4-VERDICT-FILTER — фильтр списка по коду проверки вердикта.
//
// Фильтр «Качество» знал только «есть провалы / всё ок». Рабочий список вида «170 тем без квиза»
// открыть было нельзя: клик из сводки вёл в раздел целиком. Теперь проверка — в адресе
// (lck=fail:quiz), подпись — текст проверки, а число в сводке обязано совпасть с «Показано N».
import { describe, expect, it } from 'vitest';
import type { KitRecord, KitVerdict } from '../core/contract';
import { applyCheck, checkTitle, countChecks, parseCheck, readListState, writeListState, DEFAULT_LIST_STATE } from './listModel';

const rec = (id: string): KitRecord => ({ id, kind: 'topic', title: id, status: '', fields: {} });
const RECORDS = ['t1', 't2', 't3', 't4', 't5'].map(rec);
const V: Record<string, KitVerdict | undefined> = {
  t1: { score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [] },
  t2: { score: 1, max: 2, failed: ['quiz'], hints: [{ code: 'art', message: 'нет рисунка' }] },
  t3: { score: 2, max: 2, failed: [], hints: [{ code: 'art', message: 'нет рисунка' }] },
  t4: { score: 2, max: 2, failed: [], hints: [], unknown: [{ code: 'pack', message: 'пак не прочитан' }] },
  t5: undefined,
};
const verdictOf = (r: KitRecord) => V[r.id];

describe('K4-VERDICT-FILTER · разбор условия', () => {
  it('«fail:quiz», «hint:art», «unknown:pack» — вид и код', () => {
    expect(parseCheck('fail:quiz')).toEqual({ kind: 'fail', code: 'quiz' });
    expect(parseCheck('hint:art')).toEqual({ kind: 'hint', code: 'art' });
    expect(parseCheck('unknown:pack')).toEqual({ kind: 'unknown', code: 'pack' });
  });

  it('код может содержать двоеточие — режется по первому', () => {
    expect(parseCheck('fail:rule:combat')).toEqual({ kind: 'fail', code: 'rule:combat' });
  });

  it('мусор в адресе — условия нет, а не падение и не «пустой список»', () => {
    for (const s of ['', 'quiz', 'ok:quiz', 'fail:', null, undefined]) expect(parseCheck(s), String(s)).toBeNull();
  });
});

describe('K4-VERDICT-FILTER · отбор записей', () => {
  it('положительный контроль: без условия — все записи', () => {
    expect(applyCheck(RECORDS, null, verdictOf)).toHaveLength(5);
  });

  it('провал по коду — и статьёй с текстом, и прежней формой строкой', () => {
    expect(applyCheck(RECORDS, parseCheck('fail:quiz'), verdictOf).map(r => r.id)).toEqual(['t1', 't2']);
  });

  it('подсказка и «не смогли проверить» — свои списки, провал в них не попадает', () => {
    expect(applyCheck(RECORDS, parseCheck('hint:art'), verdictOf).map(r => r.id)).toEqual(['t2', 't3']);
    expect(applyCheck(RECORDS, parseCheck('unknown:pack'), verdictOf).map(r => r.id)).toEqual(['t4']);
  });

  it('запись без вердикта под условие не попадает', () => {
    expect(applyCheck(RECORDS, parseCheck('fail:quiz'), verdictOf).some(r => r.id === 't5')).toBe(false);
  });

  it('сбой расчёта вердикта у записи не роняет список: запись под условие не попадает', () => {
    const boom = (r: KitRecord) => { if (r.id === 't1') throw new Error('сбой'); return V[r.id]; };
    expect(applyCheck(RECORDS, parseCheck('fail:quiz'), boom).map(r => r.id)).toEqual(['t2']);
  });
});

describe('K4-VERDICT-FILTER · подпись и счёт', () => {
  it('подпись — текст проверки, а не код', () => {
    expect(checkTitle(RECORDS, parseCheck('fail:quiz'), verdictOf)).toBe('нет квиза по руне темы');
  });

  it('текста нет ни у одной записи — подписью остаётся код', () => {
    expect(checkTitle(RECORDS, parseCheck('fail:nope'), verdictOf)).toBe('nope');
  });

  it('счёт по проверкам: число в сводке равно числу записей под тем же условием', () => {
    const counts = countChecks(RECORDS, verdictOf);
    const quiz = counts.find(c => c.kind === 'fail' && c.code === 'quiz')!;
    expect(quiz).toMatchObject({ n: 2, title: 'нет квиза по руне темы' });
    for (const c of counts) expect(applyCheck(RECORDS, c, verdictOf), `${c.kind}:${c.code}`).toHaveLength(c.n);
  });

  it('счёт упорядочен: провалы, подсказки, «не смогли проверить»; внутри — по убыванию', () => {
    expect(countChecks(RECORDS, verdictOf).map(c => `${c.kind}:${c.code}`)).toEqual(['fail:quiz', 'hint:art', 'unknown:pack']);
  });
});

describe('K4-VERDICT-FILTER · условие в адресе', () => {
  it('туда и обратно: lck=fail:quiz', () => {
    const url = writeListState({ ...DEFAULT_LIST_STATE, check: 'fail:quiz' });
    expect(url.lck).toBe('fail:quiz');
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(url)) if (v !== null) p.set(k, v);
    expect(readListState(p).check).toBe('fail:quiz');
  });

  it('условия нет — ключа в адресе нет', () => {
    expect(writeListState(DEFAULT_LIST_STATE).lck).toBeNull();
  });

  it('битое условие из адреса не сохраняется в состоянии', () => {
    expect(readListState(new URLSearchParams('lck=quiz')).check ?? null).toBeNull();
  });
});
