// SPRINT_LORE_MODEL_AS_CONFIG/MC-06 — данные экрана «Модель»: дифф правки и откат версии.
//
// Дифф считается по ВСЕЙ модели, а не по тому, что экран успел нарисовать: иначе откат к старой
// версии показал бы только видимые на экране поля, а изменил бы всё. Откат — новая версия с
// содержимым старой: тот же PUT /lore/model/config, сначала dry_run, причина обязательна.
import { describe, expect, it, vi } from 'vitest';
import {
  modelDiff, moveField, rollbackRequest, saveModel, setAudience, setFieldProp, modelHygiene,
  parseSchema, typeList, type ModelDoc,
  fieldLangMissing, moveFieldTo, movePassport, passportSlots, setFieldProps, setReadOnly, setTypeColor, setTypeProp,
} from './model';

const DOC: ModelDoc = {
  format: 'lore-model/1',
  types: [
    { type: 'product', label: 'Продукт', icon: 'bullseye', fields: [
      { key: 'title', label: 'Название', kind: 'text', group: 'head', required: true },
      { key: 'code', label: 'Код', kind: 'text', group: 'head' },
      { key: 'kind', label: 'Вид', kind: 'text', group: 'props', editable: true },
    ] },
    { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head' }] },
  ],
  child_only: [{ type: 'phase', label: 'Фаза', fields: [] }],
  nav: [
    { id: 'work', labelKey: 'shell.grp.work', items: [{ section: 'sprint' }] },
    { id: 'product', labelKey: 'shell.grp.product', items: [{ section: 'product' }] },
    { id: 'personal', labelKey: 'shell.grp.personal', items: [] },
  ],
  audience: { product: 'everywhere', sprint: 'everywhere', machine: 'admin' },
};

describe('модель: дифф правки', () => {
  it('без правок — дифф пуст (положительный контроль)', () => {
    expect(modelDiff(DOC, structuredClone(DOC))).toEqual([]);
  });

  it('подпись поля — одна строка «было → стало» по пути типа и ключа', () => {
    const next = setFieldProp(DOC, 'product', 'title', 'label', 'Имя продукта');
    expect(modelDiff(DOC, next)).toEqual([{ path: 'types[product].fields[title].label', from: 'Название', to: 'Имя продукта' }]);
  });

  it('правка не трогает исходник (иначе «Сбросить» нечем)', () => {
    setFieldProp(DOC, 'product', 'title', 'label', 'X');
    expect((DOC.types as { fields: { label: string }[] }[])[0].fields[0].label).toBe('Название');
  });

  it('группа и видимость — разные строки', () => {
    const next = setAudience(setFieldProp(DOC, 'product', 'kind', 'group', 'head'), 'machine', 'everywhere');
    expect(modelDiff(DOC, next)).toEqual([
      { path: 'types[product].fields[kind].group', from: 'props', to: 'head' },
      { path: 'audience.machine', from: 'admin', to: 'everywhere' },
    ]);
  });

  it('порядок полей — строка порядка, а не «удалено + добавлено»', () => {
    const next = moveField(DOC, 'product', 'kind', -1);
    expect(modelDiff(DOC, next)).toEqual([{ path: 'types[product].fields[order]', from: 'title, code, kind', to: 'title, kind, code' }]);
  });

  it('сдвиг за край — без изменений', () => {
    expect(modelDiff(DOC, moveField(DOC, 'product', 'title', -1))).toEqual([]);
  });

  it('поле у типа child_only правится так же', () => {
    const d = structuredClone(DOC);
    (d.child_only as { fields: unknown[] }[])[0].fields = [{ key: 'title', label: 'Название', kind: 'text', group: 'head' }];
    expect(modelDiff(d, setFieldProp(d, 'phase', 'title', 'label', 'Имя'))).toEqual([
      { path: 'child_only[phase].fields[title].label', from: 'Название', to: 'Имя' },
    ]);
  });

  it('добавленное и снятое значение названы, а не потеряны', () => {
    const a = { audience: { a: 'everywhere' } };
    const b = { audience: { b: 'admin' } };
    expect(modelDiff(a, b)).toEqual([
      { path: 'audience.a', from: 'everywhere', to: '' },
      { path: 'audience.b', from: '', to: 'admin' },
    ]);
  });
});

describe('модель: откат версии', () => {
  const OLD = JSON.stringify(setFieldProp(DOC, 'product', 'title', 'label', 'Старое имя'));

  it('откат — новая версия с содержимым старой: тело = старая версия, блокировка по hash, сначала dry_run', () => {
    const req = rollbackRequest(OLD, 'h-cur', { when: '13.11 18:02', why: 'вернуть подпись' }, true);
    expect(req).toEqual({ content: OLD, expected_hash: 'h-cur', dry_run: true, reason: 'откат к версии 13.11 18:02: вернуть подпись' });
  });

  it('применение отката без причины не собирается', () => {
    expect(() => rollbackRequest(OLD, 'h-cur', { when: '13.11', why: '  ' }, false)).toThrow(/причин/);
  });

  it('дифф отката — что вернётся по сравнению с действующей', () => {
    expect(modelDiff(DOC, JSON.parse(OLD))).toEqual([{ path: 'types[product].fields[title].label', from: 'Название', to: 'Старое имя' }]);
  });
});

describe('модель: ответы PUT /lore/model/config', () => {
  const answer = (status: number, body: unknown) => vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

  it('422 — причины словами сервера', async () => {
    const f = answer(422, { error: 'MODEL_INCONSISTENT', problems: ['product.title: поле названия обязано быть в группе head'], written: false });
    await expect(saveModel({ content: '{}', dry_run: true }, f)).resolves.toEqual({
      kind: 'inconsistent', problems: ['product.title: поле названия обязано быть в группе head'],
    });
  });

  it('409 — чужая версия, правки не теряются', async () => {
    const f = answer(409, { error: 'CONFLICT', current_hash: 'h2' });
    await expect(saveModel({ content: '{}', dry_run: false, reason: 'x' }, f)).resolves.toEqual({ kind: 'conflict', currentHash: 'h2' });
  });

  it('200 dry_run — согласовано, ничего не записано', async () => {
    const f = answer(200, { ok: true, dry_run: true, hash: 'h2', hash_before: 'h1', changed: true, types_changed: ['product'] });
    await expect(saveModel({ content: '{}', dry_run: true }, f)).resolves.toEqual({
      kind: 'ok', dryRun: true, hash: 'h2', changed: true, typesChanged: ['product'],
    });
  });

  it('403 — ошибка, а не «согласовано»', async () => {
    const f = answer(403, { error: 'HUMAN_ONLY', detail: 'агентам — только чтение' });
    await expect(saveModel({ content: '{}', dry_run: true }, f)).rejects.toMatchObject({ status: 403 });
  });

  it('тело уходит PUT-ом с dry_run', async () => {
    const f = answer(200, { ok: true, dry_run: true, hash: 'h', changed: false, types_changed: [] });
    await saveModel({ content: '{"a":1}', dry_run: true }, f);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/lore/model/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ content: '{"a":1}', dry_run: true });
  });
});

describe('модель: гигиена и список типов', () => {
  it('типы сгруппированы по меню; тип вне меню — в «прочее», child_only — тоже в списке', () => {
    expect(typeList(DOC)).toEqual([
      { group: 'work', labelKey: 'shell.grp.work', types: ['sprint'] },
      { group: 'product', labelKey: 'shell.grp.product', types: ['product'] },
      { group: null, labelKey: null, types: ['phase'] },
    ]);
  });

  it('схема не прочиталась — «не смогли проверить» с причиной, а не пустой список', () => {
    const rows = modelHygiene(DOC, { types: null, reason: 'missing: types' }, { seedDrift: false, warning: null });
    expect(rows.find(r => r.kind === 'unverified')).toMatchObject({ where: 'schema', detail: 'missing: types' });
  });

  it('пустая группа меню, DRIFTED, свойство без поля модели и правимое поле без свойства схемы', () => {
    const schema = parseSchema({ types: { product: { fields: [
      { key: 'title', property: 'label_ru', property_type: 'STRING', source: 'CONFIRMS' },
      { key: 'code', property: 'code', property_type: 'STRING', source: 'CONFIRMS' },
      { key: 'kind', property: null, property_type: null, source: 'SUPPLIES' },
    ], unclassified: ['legacy_note'] } } });
    const rows = modelHygiene(DOC, schema, { seedDrift: true, warning: null });
    expect(rows.map(r => `${r.kind}:${r.where}`).sort()).toEqual([
      'drifted:config', 'emptyNav:nav.personal', 'unclassified:product.legacy_note', 'undeclared:product.kind',
    ]);
  });
});

// ── v4 прототипа (9ed3c814): экран правки поля, тексты RU/EN/PL, настройки типа, раскладка паспорта ──

describe('модель v4: правка поля целиком', () => {
  it('патч поля — строки диффа по каждому ключу; пустое снимает ключ (кодек модели пустое не хранит)', () => {
    const next = setFieldProps(DOC, 'product', 'code', { labelEn: 'Code', definition: 'Короткий шифр', group: 'props' });
    expect(modelDiff(DOC, next)).toEqual([
      { path: 'types[product].fields[code].group', from: 'head', to: 'props' },
      { path: 'types[product].fields[code].labelEn', from: '', to: 'Code' },
      { path: 'types[product].fields[code].definition', from: '', to: 'Короткий шифр' },
    ]);
    const back = setFieldProps(next, 'product', 'code', { labelEn: '', definition: '  ', group: 'head' });
    expect(modelDiff(DOC, back)).toEqual([]);
  });

  it('флаг false снимается, true ставится', () => {
    const on = setFieldProps(DOC, 'product', 'code', { multi: true });
    expect(modelDiff(DOC, on)).toEqual([{ path: 'types[product].fields[code].multi', from: '', to: 'true' }]);
    expect(modelDiff(DOC, setFieldProps(on, 'product', 'code', { multi: false }))).toEqual([]);
  });

  it('перестановка перетаскиванием (из i в j)', () => {
    expect(modelDiff(DOC, moveFieldTo(DOC, 'product', 0, 2))).toEqual([
      { path: 'types[product].fields[order]', from: 'title, code, kind', to: 'code, kind, title' },
    ]);
  });

  it('нет перевода — по языку: русский текст есть, а перевода нет', () => {
    const f = { key: 'x', label: 'Икс', labelEn: 'X', definition: 'Опр', labelPl: 'X', definitionPl: 'Def' };
    expect(fieldLangMissing(f)).toEqual({ ru: false, en: true, pl: false });
  });
});

describe('модель v4: настройки типа и раскладка паспорта', () => {
  const D2: ModelDoc = {
    ...structuredClone(DOC),
    read_only: ['product'],
    type_color: { sprint: 'section-sprints' },
    no_type_color: ['product'],
    passport: { product: [{ key: 'components', slot: 'own' }, { key: 'features', slot: 'own' }, { key: 'pains', slot: 'own' }] },
  };

  it('подпись типа на трёх языках и иконка', () => {
    const next = setTypeProp(setTypeProp(D2, 'product', 'labelPl', 'Produkt'), 'product', 'icon', 'cubes');
    expect(modelDiff(D2, next)).toEqual([
      { path: 'types[product].icon', from: 'bullseye', to: 'cubes' },
      { path: 'types[product].labelPl', from: '', to: 'Produkt' },
    ]);
  });

  it('read_only — список типов, отсортирован', () => {
    expect(setReadOnly(D2, 'sprint', true).read_only).toEqual(['product', 'sprint']);
    expect(setReadOnly(D2, 'product', false).read_only).toEqual([]);
  });

  it('цвет типа: задан — из no_type_color уходит; снят — туда возвращается', () => {
    const on = setTypeColor(D2, 'product', 'section-rbjg');
    expect(on.type_color).toEqual({ sprint: 'section-sprints', product: 'section-rbjg' });
    expect(on.no_type_color).toEqual([]);
    const off = setTypeColor(D2, 'sprint', null);
    expect(off.type_color).toEqual({});
    expect(off.no_type_color).toEqual(['product', 'sprint']);
  });

  it('раскладка паспорта: перестановка — строка порядка', () => {
    expect(passportSlots(D2, 'product').map(s => s.key)).toEqual(['components', 'features', 'pains']);
    expect(modelDiff(D2, movePassport(D2, 'product', 2, 0))).toEqual([
      { path: 'passport.product[order]', from: 'components, features, pains', to: 'pains, components, features' },
    ]);
  });
});
