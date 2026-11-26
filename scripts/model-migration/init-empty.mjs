// MIG-01 · `lore-migrate init-empty --env <файл доступа>` — пустая база LORE из модели для свежей установки.
// Решение: «схема и база собираются заново из нормализованной модели». Путь тот же, что у переноса — создать приёмник,
// transfer (схема из модели, отметка LoreModelSchema, ряды, справочники из правил), edges (связи модели) — но источника
// нет: читать нечего (empty-source.mjs), записей ноль. Шаги V на такой базе не запускаются: сервер узнаёт её по отметке
// и стартует с lore.migrate=false. Связи модели заводятся видом и без данных — их пишет код сервера на пустой базе.
import fs from 'node:fs';
import { transfer, keptEdges } from './transfer.mjs';
import { transferEdges } from './transfer-edges.mjs';
import { withEmptySource } from './empty-source.mjs';
import { RULES } from './resources.mjs';

/**
 * Справочники сервера (KnowDictEntry — их читают срез dictionary и статусы /lore/model) из правил переноса: на базе
 * переноса они приходят из источника, на свежей — из тех же правил (коды, подписи ru/en, иконки, порядок). Статусы
 * задач и спринтов в правилах — один словарь plan_status; сервер читает их как task_status и sprint_status.
 */
const SERVER_DICT_ALIASES = { plan_status: ['plan_status', 'task_status', 'sprint_status'] };
export function dictEntriesFromRules(rules = RULES) {
  const out = [];
  for (const [dict, d] of Object.entries(rules.dictionaries)) {
    for (const name of SERVER_DICT_ALIASES[dict] || [dict]) {
      d.codes.forEach((c, i) => out.push({
        dict_type: name, code: c.code, label_ru: (c.labels && c.labels.ru) || c.code, label_en: (c.labels && c.labels.en) || null,
        icon: c.icon ?? null, color: c.color ?? null, sort_order: (i + 1) * 10, is_active: true,
      }));
    }
  }
  return out;
}

/** Виды связей карты (keep) без данных — те, которых ещё нет в приёмнике; код сервера пишет в них на пустой базе. */
async function createModelEdges(db) {
  const have = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  const created = [];
  for (const e of keptEdges()) {
    if (have.has(e)) continue;
    await db.dstCommand(`CREATE EDGE TYPE ${e} IF NOT EXISTS`);
    created.push(e);
  }
  return created;
}

/** Пустая база из модели в приёмнике db (источник не читается). Возвращает итог: ok, записей, связей, проблемы. */
export async function initEmpty(db, { log = console.log } = {}) {
  const src = withEmptySource(db);
  const problems = [];
  const t = await transfer(src, { decisions: [] }, { freshInstall: true, log });
  const records = Object.values((t.stages && t.stages.write && t.stages.write.records) || {}).reduce((a, n) => a + n, 0);
  // Связи модели без данных — видом ДО шага связей: его подшаги читают виды связей приёмника (ожидающие ссылки читают
  // DEPENDS_ON — ryzenai 21.11.2026: «Type with name 'DEPENDS_ON' was not found»). Шаг связей пересоздаёт только виды,
  // в которые пишет; на пустой базе таких нет.
  const created = await createModelEdges(db);
  // момент снимка нужен связям без своего момента — на пустой базе их нет; постоянное значение держит детерминизм
  const e = await transferEdges(src, { log, freshInstall: true, at: '1970-01-01T00:00:00.000Z' });
  // Сверка шага связей на пустой базе: правила охвата гейтов (qg_scope) называют гейты прода поимённо — на пустой базе
  // их нет по построению («rule_gate_missing»), это не сбой. Любой другой несошедшийся раздел — сбой.
  if (e && e.ok === false) {
    for (const [k, v] of Object.entries(e)) {
      if (!v || typeof v !== 'object' || v.ok !== false) continue;
      const onlyMissingGates = k === 'qg_scope' && Array.isArray(v.problems) && v.problems.every(p => p.kind === 'rule_gate_missing');
      if (!onlyMissingGates) problems.push('шаг связей: не сошёлся раздел ' + k);
    }
    if (!Object.values(e).some(v => v && typeof v === 'object' && v.ok === false) && e.ok === false) problems.push('шаг связей: сверка не сошлась');
  }
  // после шага связей — те виды, которые он не завёл и не оставил (повторно ничего не создаётся)
  created.push(...await createModelEdges(db));
  // справочники сервера — из правил (на пустой базе KnowDictEntry пуст: записей источника нет)
  const dicts = dictEntriesFromRules();
  for (const row of dicts) await db.dstCommand('INSERT INTO KnowDictEntry CONTENT :c', { c: row });
  log('пустая база из модели: записей', records, '· статей справочников', dicts.length, '· связей модели заведено без данных', created.length);
  return { ok: problems.length === 0, records, dict_entries: dicts.length, edge_types_created: created, problems, transfer: t, edges: e };
}

const LAUNCHED = process.argv[1] === 'init-empty';
if (LAUNCHED) {
  const { connect } = await import('./db.mjs');
  const db = connect();
  const report = await initEmpty(db);
  const o = process.argv.indexOf('--out');
  if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify({ ok: report.ok, records: report.records, edge_types_created: report.edge_types_created, problems: report.problems }, null, 1));
  if (!report.ok) console.error('пустая база не собрана: ' + report.problems.join('; '));
  process.exit(report.ok ? 0 : 1);
}
