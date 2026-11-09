// Разбор модели не теряет разделы `types` и `surfaces`
// (SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER — дефект, найден 09.11.2026).
//
// КАК НАШЁЛСЯ. Я подключал порядок разделов паспорта из
// `surfaces.passport.<type>.sections` (S4-29) и получал «модель порядка не
// задаёт» на документе, где порядок ЕСТЬ. Причина не в разборе surfaces, а
// раньше: `parseModel` собирал возвращаемый документ ПОИМЁННО — format,
// version, partial, missing, statuses_known, statuses, dictionaries, warnings —
// и `types` с `surfaces` в этот список не попали. Они появились позже
// (#958 и #1011), а загрузчик писался до них.
//
// ПОЧЕМУ ЭТО ХУЖЕ ОШИБКИ. Загрузчик не падал и не предупреждал: он возвращал
// «успешно разобранную» модель, в которой двух разделов просто нет. Потребитель
// видел пустоту и честно говорил «сервер не задаёт», хотя сервер задавал. То
// есть честное состояние показывалось про НЕПРАВДУ.
//
// Отдельно проверяется `modelSections`: у `types` и `surfaces` состояние
// считалось от литерала `{}`, поэтому «present» у них не получался НИКОГДА —
// раздел, присланный сервером, выглядел пустым.
import { describe, expect, it } from 'vitest';
import { modelSections, parseModel } from './loadModel';

const doc = {
  format: 'model/0',
  version: '2026-11-09T00:00:00Z',
  partial: true,
  missing: ['surfaces:list'],
  statuses_known: ['task'],
  statuses: { task: { entries: [] } },
  dictionaries: {},
  types: { sprint: { fields: [], relations: [] } },
  surfaces: { partial: true, passport: { sprint: { decided: true, sections: [] } } },
};

describe('parseModel: разделы модели не теряются', () => {
  it('положительный контроль: формат и версия разобраны', () => {
    const m = parseModel(doc);
    expect(m.format).toBe('model/0');
    expect(m.version).toBe('2026-11-09T00:00:00Z');
  });

  it('раздел `types` доходит до потребителя', () => {
    expect(parseModel(doc).types).toEqual(doc.types);
  });

  it('раздел `surfaces` доходит до потребителя', () => {
    expect(parseModel(doc).surfaces).toEqual(doc.surfaces);
  });

  it('разделов нет в документе — пустые объекты, а не undefined', () => {
    const bare = { format: 'model/0', version: 'v1' };
    expect(parseModel(bare).types).toEqual({});
    expect(parseModel(bare).surfaces).toEqual({});
  });

  it('состояние раздела считается по САМОМУ разделу, а не по пустому литералу', () => {
    const s = modelSections(parseModel(doc));
    expect(s.types).toBe('present');
    // `surfaces:list` в missing — это «списка поверхностей ещё нет», но сам
    // раздел пришёл. Проверяем именно то, что состояние берётся из данных.
    expect(['present', 'missing']).toContain(s.surfaces);
  });

  it('раздела нет вовсе — «пусто», и это не то же, что «не описан»', () => {
    const s = modelSections(parseModel({ format: 'model/0', version: 'v1' }));
    expect(s.types).toBe('empty');
  });
});
