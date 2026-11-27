// SPRINT_LORE_ADMIN_POLISH/AP-06: логика отчёта «+ Новая» по типам (сценарий — e2e/stand/create.stand.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoverage, judgeCreateCell, modelTypesOf, renderCells, STAND_CREATE_TYPES, typeOutcome, type CreateProbe } from './createCoverage.ts';
import { CREATE_TYPES } from '../record/recordCreate.ts';

const probe = (over: Partial<CreateProbe> = {}): CreateProbe => ({
  account: 'test-admin', seerRole: 'admin', permStatus: 200, canCreate: true, buttonVisible: true,
  formOpened: true, saveBlocked: true, whyText: 'Не заполнено: Код, Название', ...over,
});

describe('STAND_CREATE_TYPES — копия CREATE_TYPES приложения', () => {
  it('совпадает: новая форма «+ Новая» попадает в прогон стенда', () => {
    expect([...STAND_CREATE_TYPES]).toEqual([...CREATE_TYPES]);
  });
});

describe('createCoverage: у какого типа есть путь создания в v2', () => {
  it('тип с формой — withPath, без формы — withoutPath, отсортировано и без повторов', () => {
    const c = createCoverage(['task', 'release', 'sprint', 'pain', 'task'], ['sprint', 'task']);
    expect(c.withPath).toEqual(['sprint', 'task']);
    expect(c.withoutPath).toEqual(['pain', 'release']);
  });

  it('блок create модели без формы в приложении — modelOnly (расхождение модели и UI)', () => {
    expect(createCoverage(['spec', 'doc'], ['spec'], ['spec', 'doc']).modelOnly).toEqual(['doc']);
  });

  it('на настоящих CREATE_TYPES: релиз — без пути, спринт и веха (AP-PASSPORT-EDIT, волна 2) — с путём', () => {
    const c = createCoverage(['sprint', 'release', 'milestone'], CREATE_TYPES);
    expect(c.withPath).toEqual(['milestone', 'sprint']);
    expect(c.withoutPath).toEqual(['release']);
  });
});

describe('modelTypesOf: типы из ответа /lore/model', () => {
  it('types — массив {type}, create — словарь', () => {
    expect(modelTypesOf({ types: [{ type: 'sprint' }, { type: 'adr' }, { nope: 1 }], create: { spec: {}, decision: {} } }))
      .toEqual({ types: ['sprint', 'adr'], create: ['spec', 'decision'] });
  });
  it('types — словарь по типу', () => {
    expect(modelTypesOf({ types: { task: {}, doc: {} } }).types).toEqual(['task', 'doc']);
  });
  it('мусор — пусто, не исключение', () => {
    expect(modelTypesOf(null)).toEqual({ types: [], create: [] });
  });
  it('файл модели репо: типы читаются, у каждого блока create есть тип', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const model = JSON.parse(readFileSync(resolve(here, '../../../shared/model/lore-model.json'), 'utf8'));
    const { types, create } = modelTypesOf(model);
    expect(types).toContain('sprint');
    expect(types.length).toBeGreaterThan(10);
    for (const t of create) expect(types).toContain(t);
  });
});

describe('judgeCreateCell: исход «тип × учётка»', () => {
  it('право есть, кнопка, форма, пустой черновик не сохраняется с причиной — PASS', () => {
    const c = judgeCreateCell(probe());
    expect(c.outcome).toBe('pass');
    expect(c.reason).toContain('Не заполнено');
  });

  it('права нет и кнопки нет — PASS (скрыто по роли), причина сервера в отчёте', () => {
    const c = judgeCreateCell(probe({ seerRole: 'viewer', canCreate: false, buttonVisible: false, permReason: 'нужна роль admin' }));
    expect(c).toMatchObject({ outcome: 'pass' });
    expect(c.reason).toContain('нужна роль admin');
  });

  it('право спросить не удалось — НЕ ВЫПОЛНЕН, а не PASS', () => {
    expect(judgeCreateCell(probe({ permStatus: null })).outcome).toBe('not-run');
    expect(judgeCreateCell(probe({ permStatus: 403 })).reason).toContain('403');
  });

  it('кнопка расходится с правом сервера — FAIL в обе стороны', () => {
    expect(judgeCreateCell(probe({ canCreate: true, buttonVisible: false })).outcome).toBe('fail');
    expect(judgeCreateCell(probe({ canCreate: false, buttonVisible: true })).outcome).toBe('fail');
  });

  it('viewer с правом создать — FAIL', () => {
    expect(judgeCreateCell(probe({ seerRole: 'viewer' })).reason).toMatch(/viewer/);
  });

  it('форма не открылась / пустое сохраняется / блок молчит — FAIL', () => {
    expect(judgeCreateCell(probe({ formOpened: false })).outcome).toBe('fail');
    expect(judgeCreateCell(probe({ saveBlocked: false })).outcome).toBe('fail');
    expect(judgeCreateCell(probe({ whyText: '  ' })).outcome).toBe('fail');
  });
});

describe('typeOutcome и renderCells', () => {
  const pass = { account: 'a', outcome: 'pass' as const, reason: 'ок' };
  const nr = { account: 'b', outcome: 'not-run' as const, reason: 'нет входа' };
  const fail = { account: 'c', outcome: 'fail' as const, reason: 'сломано' };
  it('хоть один FAIL — fail; все не выполнены — not-run; иначе pass', () => {
    expect(typeOutcome([pass, fail, nr])).toBe('fail');
    expect(typeOutcome([nr, nr])).toBe('not-run');
    expect(typeOutcome([pass, nr])).toBe('pass');
  });
  it('строка отчёта называет учётку и исход словами', () => {
    expect(renderCells([pass, nr])).toBe('a — PASS: ок; b — НЕ ВЫПОЛНЕН: нет входа');
  });

  // 1.18.3: у итога появился четвёртый вид — «не применимо» (среда не та). Ячейки покрытия его пока не
  // выдают, но тип общий с отчётом смоука: без ветки строка отчёта молча печатала бы undefined, а итог
  // «все не применимы» выдал бы себя за pass. Сторож держит обе дыры закрытыми.
  const na = { account: 'd', outcome: 'n/a' as const, reason: 'мастер только в установщике' };
  it('«не применимо» названо словами, а не undefined', () => {
    expect(renderCells([na])).toBe('d — НЕ ПРИМЕНИМО: мастер только в установщике');
  });
  it('все ячейки «не применимо» — итог n/a; вперемешку с «не выполнено» — not-run; с pass — pass', () => {
    expect(typeOutcome([na, na])).toBe('n/a');
    expect(typeOutcome([na, nr])).toBe('not-run');
    expect(typeOutcome([na, pass])).toBe('pass');
    expect(typeOutcome([na, fail])).toBe('fail');
  });
});
