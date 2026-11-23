// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES, шаг 2 (kit): генератор конфига из модели
// проверяется на модели, СНЯТОЙ с живого сервера (shared/fixtures/model.json,
// snapshot.mjs на тестовой базе), а не на модели, которую помнит автор теста.
// Сервер поменял форму модели — падает этот тест в том же PR.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel } from './loadModel';
import { configFromModel } from './configFromModel';

const MODEL = join(__dirname, '..', '..', 'fixtures', 'model.json') // снимок живой модели LORE (из UnlimitedLORE shared/fixtures, 22.11.2026);
const raw = (): unknown => JSON.parse(readFileSync(MODEL, 'utf8'));

describe('CT-KIT-FIXTURES: модель с живого сервера', () => {
  it('разбирается загрузчиком kit без ошибки', async () => {
    const res = await loadModel(async () => raw());
    expect(res.state, res.state === 'error' ? String(res.error) : '').toBe('ok');
  });

  it.each(['task', 'sprint', 'adr'])('у типа %s есть статусы с категорией', async kind => {
    const res = await loadModel(async () => raw());
    if (res.state !== 'ok' || !res.model) throw new Error('модель не разобрана');
    // Ключ блока статусов в документе — ТИП записи (statuses.task), имя словаря лежит внутри.
    const cfg = configFromModel(res.model, { statusDict: kind });
    const items = cfg.statuses;
    expect(items.length, cfg.notes.statuses.join('; ')).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.code, 'статья без кода').toBeTruthy();
      expect(it.category, `${it.code}: без категории`).toBeTruthy();
    }
    expect(Object.keys(cfg.kinds ?? {}), `тип ${kind} не дошёл до конфига: ${cfg.notes.kinds.join('; ')}`).toContain(kind);
  });

  it('словарь задач на базе с нуля полон: оговорки «нет в справочнике» нет (V90)', async () => {
    const res = await loadModel(async () => raw());
    if (res.state !== 'ok' || !res.model) throw new Error('модель не разобрана');
    const warnings = (raw() as { warnings?: string[] }).warnings ?? [];
    expect(warnings.filter(w => /^(task|sprint)_status: .*нет в справочнике/.test(w))).toEqual([]);
  });
});
