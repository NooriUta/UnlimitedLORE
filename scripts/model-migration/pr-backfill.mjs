#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · Шаг после переноса «Дотянуть данные PR».
// Перенос копирует KnowPR как есть, а в источнике около половины PR — только ключ (мерж до #1641, task_link rel=pr,
// release_link при сбое обогащения): смоук RFD2-MD05 «PR без заголовка: 547 из 1093». Дотягивает СЕРВЕР —
// POST /lore/admin/pr-backfill (только super-admin): у него мост Forgejo и его токен; здесь секретов нет.
// Шаг ходит порциями до done и складывает отчёт: сколько дотянуто, сколько пропущено и почему. Повтор — 0 изменений.
//
// Запуск (после замены базы и старта бэкенда на ней):
//   lore-migrate pr-backfill --url <адрес бэкенда LORE> [--limit 200] [--dry-run] [--out отчёт.json]
// Токен — из переменной LORE_TOKEN (Bearer, учётка с ролью superadmin). Без неё шлётся заголовок роли — так
// отвечает только установка с выключенным входом; с включённым сервер откажет 401/403, и шаг покраснеет.
import fs from 'node:fs';

/** Заголовки доступа: токен — Bearer; без токена — роль заголовком (установка с выключенным входом). */
export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : { 'X-Seer-Role': 'superadmin' };
}

const MAX_PORTIONS = 1000;

/** Порции до done; ok:false — сервер отказал или ответ не похож на отчёт (с причиной). */
export async function backfillPrs({ url, token = '', limit = 200, dryRun = false, fetch = globalThis.fetch }) {
  const base = String(url || '').replace(/\/+$/, '');
  const r = { ok: true, dry_run: dryRun, portions: 0, scanned: 0, updated: 0, would_update: 0, unchanged: 0, skipped: 0, missed: 0, skipped_by_reason: {} };
  let after = '';
  for (;;) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (after) q.set('after', after);
    if (dryRun) q.set('dry_run', 'true');
    let status, text;
    try {
      const resp = await fetch(`${base}/lore/admin/pr-backfill?${q}`, { method: 'POST', headers: { Accept: 'application/json', ...authHeaders(token) } });
      status = resp.status;
      text = await resp.text();
    } catch (e) {
      return { ...r, ok: false, error: `бэкенд ${base} не ответил: ${e.message}` };
    }
    let p = null;
    try { p = JSON.parse(text); } catch { /* ниже */ }
    if (status !== 200 || !p || typeof p.scanned !== 'number') {
      const why = p && (p.detail || p.message || p.error) ? `${p.error || ''} ${p.detail || p.message || ''}`.trim() : String(text || '').slice(0, 200);
      const hint = status === 401 || status === 403 ? ' — нужен токен учётки с ролью superadmin в LORE_TOKEN' : '';
      return { ...r, ok: false, error: `сервер ответил ${status}: ${why}${hint}` };
    }
    r.portions++;
    r.scanned += p.scanned;
    r.updated += p.updated || 0;
    r.would_update += p.would_update || 0;
    r.unchanged += p.unchanged || 0;
    r.skipped += p.skipped || 0;
    r.missed += p.missed || 0;
    for (const [code, g] of Object.entries(p.skipped_by_reason || {})) {
      const t = r.skipped_by_reason[code] || (r.skipped_by_reason[code] = { count: 0, reason: g.reason, examples: [] });
      t.count += g.count || 0;
      for (const e of g.examples || []) if (t.examples.length < 5) t.examples.push(e);
    }
    if (p.done) return r;
    if (!p.next_after || p.next_after === after) return { ...r, ok: false, error: 'сервер не сдвинул курсор порции — остановлено, чтобы не крутиться' };
    if (r.portions >= MAX_PORTIONS) return { ...r, ok: false, error: `больше ${MAX_PORTIONS} порций — остановлено` };
    after = p.next_after;
  }
}

/** Сводка одной строкой и причины пропусков списком. */
export function summary(r) {
  const head = r.dry_run
    ? `PR: просмотрено ${r.scanned}, дотянулось бы ${r.would_update}, без изменений ${r.unchanged}, пропущено ${r.skipped} (пробный прогон)`
    : `PR: просмотрено ${r.scanned}, дотянуто ${r.updated}, без изменений ${r.unchanged}, пропущено ${r.skipped} (из них запись не легла: ${r.missed})`;
  const why = Object.entries(r.skipped_by_reason).map(([c, g]) => `  ${c}: ${g.count} — ${g.reason} (напр. ${g.examples.join(', ')})`);
  return [head, ...why].join('\n');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg('--url');
  if (!url) { console.error('нужен --url <адрес бэкенда LORE>'); process.exitCode = 2; return; }
  const limit = Number(arg('--limit') || 200);
  const r = await backfillPrs({ url, token: process.env.LORE_TOKEN || '', limit, dryRun: process.argv.includes('--dry-run') });
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 1));
  if (!r.ok) { console.error(`дотяжка PR не выполнена: ${r.error}\n${summary(r)}`); process.exitCode = 1; return; }
  console.log(summary(r));
}

// Через установщик (cli.mjs подставляет argv[1] = имя команды) или напрямую.
if (process.argv[1] === 'pr-backfill' || /pr-backfill\.mjs$/.test(process.argv[1] || '')) await main();
