// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES, шаг 2: разбор клиента против ЖИВЫХ
// ответов сервера, а не против формы, которую помнит автор теста.
//
// Фикстуры в shared/fixtures/ сняты скриптом shared/fixtures/snapshot.mjs с
// бэкенда на тестовой базе (записи с префиксом TEST). Здесь они проходят через
// те же разборщики, что работают в приложении: модель → статусы, циклы типов,
// порядок паспорта; паспорт записи → LoreRecord1. Сервер поменял форму —
// падает этот тест, в том же PR, что и серверный контракт (CT-MODEL/CT-RECORD).
//
// Повод — liveRecord.ts: разбор графа шёл «по несуществующему контракту», и
// узлы получали undefined вместо кодов. Ручная фикстура совпадает с тем, что
// думает автор; снятая — с тем, что сервер отдаёт.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchLoreRecord } from './liveRecord';
import { fetchModelStatuses } from '../shell/useModelStatuses';
import { menuFromModel } from '../shell/v2Config';
import { fetchTypeStatuses } from '../record/passportStatuses';
import { fetchPassportOrder } from '../record/passportOrder';

const FIXTURES = join(__dirname, '..', '..', '..', 'shared', 'fixtures');
const load = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

interface IndexEntry { name: string; path: string; status: number; file: string }
const index = load('index') as { fixtures: IndexEntry[] };
const pathOf = (name: string): string => {
  const e = index.fixtures.find(f => f.name === name);
  if (!e) throw new Error(`в shared/fixtures/index.json нет снимка «${name}» — снимите его snapshot.mjs`);
  return e.path;
};

/** Сеть, которая отвечает снятыми ответами по их путям; чужой путь — 404 словами. */
const fixtureFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const hit = index.fixtures.find(f => f.path === url || f.path.split('?')[0] === url);
  if (!hit) return new Response(JSON.stringify({ error: 'NO_FIXTURE', path: url }), { status: 404 });
  return new Response(readFileSync(join(FIXTURES, hit.file), 'utf8'), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

describe('CT-KIT-FIXTURES: снимки сервера проходят разбор клиента', () => {
  it('каждый снимок снят с кодом 200 и лежит рядом', () => {
    expect(index.fixtures.length).toBeGreaterThan(0);
    for (const f of index.fixtures) {
      expect(f.status, `${f.name}: снят не 200`).toBe(200);
      expect(() => load(f.file.replace(/\.json$/, '')), `${f.name}: файла нет`).not.toThrow();
    }
  });

  // Найдено этим тестом 14.11.2026: на базе, поднятой с нуля миграциями, в
  // task_status были только waiting/review/uat/failed — 10 базовых кодов на проде
  // внесли руками. Закрыто сидом V90 (StatusDictCoreSeed); фикстуры сняты после него.
  it('модель: словарь статусов задач читается без причин «не смогли»', async () => {
    const r = await fetchModelStatuses({ fetchImpl: fixtureFetch, url: pathOf('model') });
    expect(r.items.length, `статусов нет: ${r.notes.join('; ')}`).toBeGreaterThan(0);
    expect(r.notes.filter(n => /недоступна|не прочитана/.test(n))).toEqual([]);
    for (const it of r.items) expect(it.code, 'статья без кода').toBeTruthy();
  });

  it('модель: меню (surfaces.nav) приходит и разбирается', async () => {
    const r = await fetchModelStatuses({ fetchImpl: fixtureFetch, url: pathOf('model') });
    // K5-MODEL-NAV-EDGE-LABELS: документ уходит в kit (navFromModel через menuFromModel) как есть.
    expect(menuFromModel('ru', r.model).length, `меню из модели пустое: ${r.notes.join('; ')}`).toBeGreaterThan(0);
  });

  it.each(['sprint', 'task', 'adr'])('модель: цикл статусов типа %s есть', async type => {
    const r = await fetchTypeStatuses(type, { fetchImpl: fixtureFetch, url: pathOf('model') });
    expect(r.items.length, `${type}: ${r.notes.join('; ')}`).toBeGreaterThan(0);
  });

  it.each(['sprint', 'task', 'adr'])('модель: порядок паспорта %s решён сервером', async type => {
    const r = await fetchPassportOrder(type, { fetchImpl: fixtureFetch, url: pathOf('model') });
    expect(r.notes.filter(n => /порядок выбрал клиент|не решал/.test(n)), `${type}: ${r.notes.join('; ')}`).toEqual([]);
  });

  const records: [string, string][] = [['sprint', 'record-sprint'], ['task', 'record-task'], ['adr', 'record-adr']];
  it.each(records)('паспорт %s: ни одного undefined в кодах и связях', async (type, name) => {
    const path = pathOf(name);
    const id = decodeURIComponent(path.slice(`/lore/record/${type}/`.length));
    const rec = await fetchLoreRecord(type, id, { fetchImpl: fixtureFetch, now: () => '2026-11-14T00:00:00.000Z' });
    expect(rec.record.type).toBe(type);
    expect(rec.record.id).toBe(id);
    expect(rec.record.title, 'заголовок потерялся при разборе').toBeTruthy();
    const json = JSON.stringify(rec);
    expect(json.includes('"undefined"'), 'строка "undefined" в разобранном паспорте').toBe(false);
    for (const r of rec.schema.relations ?? []) expect(r.key, 'связь без ключа').toBeTruthy();
  });
});
