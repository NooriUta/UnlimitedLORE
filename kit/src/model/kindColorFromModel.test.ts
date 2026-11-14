// K4-MENTION-LOOK (SPRINT_UXR_S13_KIT4): цвет вида приходит из модели —
// `types.<тип>.color` = ИМЯ токена темы (сервер, PR #1212), а не hex. Генератор
// kit переводит его в цвет вида (KindConfig.color), которым окрашены упоминания
// записей этого вида. null у типа — честное «канона цвета нет»: вид нейтральный.
import { describe, expect, it } from 'vitest';
import { configFromModel } from './configFromModel';
import { parseModel } from './loadModel';

const typeOf = (color: unknown) => ({ type: 'x', label: 'Икс', icon: 'cog', color, fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head', visibility: 'visible' }] });
const kindsOf = (types: Record<string, unknown>) =>
  configFromModel(parseModel({ format: 'model/0', version: 'v1', types }), { statusDict: 'none' });

describe('configFromModel: цвет вида из модели', () => {
  it('имя токена → var(--имя)', () => {
    expect(kindsOf({ a: typeOf('type-adrs') }).kinds.a.color).toBe('var(--type-adrs)');
  });
  it('токен var(--…) — как есть', () => {
    expect(kindsOf({ a: typeOf('var(--type-adrs)') }).kinds.a.color).toBe('var(--type-adrs)');
  });
  it('null — цвета нет и замечания нет: канона цвета у типа нет честно', () => {
    const r = kindsOf({ a: typeOf(null) });
    expect(r.kinds.a.color).toBeUndefined();
    expect(r.notes.kinds.join(' ')).not.toMatch(/цвет/);
  });
  it('сырой hex — не токен: цвета нет, причина словами', () => {
    const r = kindsOf({ a: typeOf('#B48EAD') });
    expect(r.kinds.a.color).toBeUndefined();
    expect(r.notes.kinds.join(' ')).toMatch(/цвет «#B48EAD» не токен/);
  });
});
