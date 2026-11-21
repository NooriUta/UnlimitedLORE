#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Проба доступа к базам переезда.
//   1) источник отвечает: число записей по типам первого объекта (только SELECT);
//   2) приёмник есть; с ключом --create-dst — создаётся, если его нет.
// Учётки берутся из файла доступа (MIG_ENV_FILE); значения секретов не печатаются.
import { loadEnv, summary, dstUrl } from './env.mjs';
import { connectVerdict } from './probe-verdict.mjs';

const env = loadEnv();
const auth = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const SRC = auth(env.MIG_SRC_USER, env.MIG_SRC_PASSWORD), DST = auth(env.MIG_DST_USER, env.MIG_DST_PASSWORD);

async function call(method, path, authz, body, base = env.MIG_DB_URL) {
  let res;
  try {
    res = await fetch(base + path, { method, headers: { Authorization: authz, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  } catch (e) { return { ok: false, status: 0, text: 'сеть: ' + (e.cause?.code || e.name) }; }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { ok: res.ok, status: res.status, json, text: text.slice(0, 300) };
}
const sql = (db, authz, command) => call('POST', `/api/v1/query/${db}`, authz, { language: 'sql', command });

const out = { env: summary(env) };
const dbs = await call('GET', '/api/v1/databases', SRC);
out.databases = dbs.ok ? dbs.json.result : { отказ: dbs.status, text: dbs.text };

out.source = {};
for (const T of ['KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist']) {
  const r = await sql(env.MIG_SRC_DB, SRC, `SELECT count(*) AS n FROM ${T}`);
  out.source[T] = r.ok ? r.json.result[0].n : { отказ: r.status, text: r.text };
}

// Приёмник может жить на другом сервере (MIG_DST_URL): список баз приёмника — с его сервера.
const D = dstUrl(env);
const dstDbs = D === env.MIG_DB_URL ? dbs : await call('GET', '/api/v1/databases', DST, undefined, D);
const dstList = dstDbs.ok ? dstDbs.json.result : null;
if (D !== env.MIG_DB_URL) out.dstServer = dstList || { отказ: dstDbs.status, text: dstDbs.text };
const have = Array.isArray(dstList) && dstList.includes(env.MIG_DST_DB);
out.dst = { exists: have };
if (!have && process.argv.includes('--create-dst') && Array.isArray(dstList)) {
  const c = await call('POST', '/api/v1/server', DST, { command: `create database ${env.MIG_DST_DB}` }, D);
  out.dst.created = c.ok ? true : { отказ: c.status, text: c.text };
  if (c.ok) { const again = await call('GET', '/api/v1/databases', DST, undefined, D); out.dst.exists = again.ok && again.json.result.includes(env.MIG_DST_DB); }
}
if (out.dst.exists) { const r = await call('POST', `/api/v1/query/${env.MIG_DST_DB}`, DST, { language: 'sql', command: 'SELECT count(*) AS n FROM schema:types' }, D); out.dst.types = r.ok ? r.json.result[0].n : { отказ: r.status, text: r.text }; }
console.log(JSON.stringify(out, null, 2));
// MIG-04: просили создать приёмник, а его нет — отказ с причиной, а не код 0 (probe-verdict.mjs).
const verdict = connectVerdict(out, { createDst: process.argv.includes('--create-dst') });
if (!verdict.ok) { console.error(verdict.reason); process.exitCode = 1; }
