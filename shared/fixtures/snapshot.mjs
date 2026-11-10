#!/usr/bin/env node
// SPRINT_UXR_S11_TEST_OPT/CT-KIT-FIXTURES — снимает живые ответы сервера LORE
// (/lore/model, /lore/record/<type>/<id>, ключевые срезы) в shared/fixtures/,
// чтобы тесты kit и web-next читали форму, которую сервер действительно отдаёт,
// а не ту, что помнит автор ручной фикстуры.
//
// Запуск (из корня репозитория; бэкенд поднят локально):
//   node shared/fixtures/snapshot.mjs                        # docker compose, http://127.0.0.1:9100
//   node shared/fixtures/snapshot.mjs --base http://localhost:8081   # Quarkus dev/test
//   node shared/fixtures/snapshot.mjs --only model,record-adr --set adr_id=ADR-LORE-048
//   node shared/fixtures/snapshot.mjs --dry-run              # только план, без сети
//
// Адрес — --base или LORE_FIXTURES_BASE; по умолчанию локальный тестовый
// бэкенд, не прод. Не локальный адрес — только явным --allow-remote.
// Токен — только из окружения LORE_FIXTURES_TOKEN, его задаёт человек; без
// токена идёт dev-роль X-Seer-Role (LORE_FIXTURES_ROLE, по умолчанию admin) —
// так отвечает локальный бэкенд с выключенным входом. Скрипт ничего не читает,
// кроме manifest.json, и не пишет ответ, в котором нашёлся токен/Bearer/JWT.
//
// Обновление: поднять локальный бэкенд на тестовой базе → запустить скрипт →
// посмотреть git diff shared/fixtures → закоммитить вместе с правкой формы.
// Не 200 — фикстура НЕ перезаписывается, код выхода 1: «не смогли снять» ≠ «пусто».
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  parseArgs, baseError, headersFor, fillPath, pickValue, planTargets,
  fixtureFile, serialize, secretLeak, buildIndex,
} from './snapshot-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env);
  const bad = baseError(opts);
  if (bad) throw new Error(bad);
  const manifestPath = join(here, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plan = planTargets(manifest, opts);
  const outDir = resolve(opts.out ?? here);
  const values = { ...opts.sets };
  const bodies = {};
  const results = [];
  let failed = 0;

  console.log(`снимаю ${plan.length} ответов с ${opts.base} (${opts.token ? 'токен из окружения' : `dev-роль ${opts.role}`}) → ${outDir}`);
  for (const t of plan) {
    for (const [, k] of t.path.matchAll(/\{([a-z_]+)\}/g)) {
      const p = manifest.picks?.[k];
      if (values[k] == null && p && bodies[p.from]) values[k] = pickValue(bodies[p.from], p.field);
    }
    let path;
    try {
      path = fillPath(t.path, values);
    } catch (e) {
      console.error(`✗ ${t.name}: ${e.message} — задайте --set или снимите источник`);
      results.push({ name: t.name, path: t.path, status: null });
      failed++;
      continue;
    }
    if (opts.dryRun) { console.log(`· ${t.name}  GET ${path}`); continue; }
    let status = null;
    try {
      const res = await fetch(opts.base + path, { headers: headersFor(opts) });
      status = res.status;
      const text = await res.text();
      if (status !== 200) throw new Error(`HTTP ${status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text);
      const out = serialize(body);
      const leak = secretLeak(out, opts.token);
      if (leak) throw new Error(`${leak} — не записано`);
      bodies[t.name] = body;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, fixtureFile(t.name)), out);
      results.push({ name: t.name, path, status, file: fixtureFile(t.name) });
      console.log(`✓ ${t.name}  ${path}`);
    } catch (e) {
      console.error(`✗ ${t.name}  ${path}: ${e.message}`);
      results.push({ name: t.name, path, status });
      failed++;
    }
  }
  if (opts.dryRun) return 0;
  // Индекс пишется только за полный прогон: снимок части набора не должен
  // выдавать себя за весь набор.
  if (!opts.only && failed === 0)
    writeFileSync(join(outDir, 'index.json'), serialize(buildIndex(results, opts, new Date().toISOString())));
  console.log(failed ? `снято с ошибками: ${failed} из ${plan.length} — фикстуры с ошибкой не тронуты`
    : `готово: ${plan.length}; проверьте git diff shared/fixtures`);
  return failed ? 1 : 0;
}

main().then(code => process.exit(code), e => { console.error(e.message); process.exit(2); });
