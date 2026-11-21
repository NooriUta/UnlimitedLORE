// SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 — шаг переноса «Дотянуть данные PR»: вызывает серверную операцию
// POST /lore/admin/pr-backfill порциями до done, складывает отчёт; отказ сервера — громко, а не «0 дотянуто».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { backfillPrs, authHeaders, summary } from './pr-backfill.mjs';

/** Заглушка сервера: порции по курсору; calls — какие адреса и заголовки пришли. */
function fakeServer(portions, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) return { status, text: async () => JSON.stringify({ error: 'FORGEJO_NOT_CONFIGURED', detail: 'мост не сконфигурирован' }) };
    const after = new URL(url).searchParams.get('after') || '';
    const p = portions[after];
    return { status: 200, text: async () => JSON.stringify(p) };
  };
  return { fetch, calls };
}

const portion = (o) => ({ dry_run: false, scanned: 0, updated: 0, unchanged: 0, skipped: 0, skipped_by_reason: {}, items: [], done: true, ...o });

test('порции до done; счёт сведён, причины пропусков сложены', async () => {
  const { fetch, calls } = fakeServer({
    '': portion({ scanned: 2, updated: 1, skipped: 1, next_after: 'P/R#2', done: false,
      skipped_by_reason: { foreign_repo: { count: 1, reason: 'чужой git-хост github.com', examples: ['X/doc#3'] } } }),
    'P/R#2': portion({ scanned: 1, updated: 1, next_after: 'P/R#3', done: true }),
  });
  const r = await backfillPrs({ url: 'http://lore-backend:9100/', token: 't', limit: 2, fetch });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/lore/admin/pr-backfill');
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '2');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  assert.equal(r.ok, true);
  assert.equal(r.portions, 2);
  assert.equal(r.scanned, 3);
  assert.equal(r.updated, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.skipped_by_reason.foreign_repo.count, 1);
  assert.match(summary(r), /дотянуто 2/);
  assert.match(summary(r), /чужой git-хост github\.com/);
});

test('повтор: сервер говорит 0 изменений — шаг зелёный и так и пишет', async () => {
  const { fetch } = fakeServer({ '': portion({ scanned: 1, skipped: 1, done: true,
    skipped_by_reason: { not_found: { count: 1, reason: 'PR #9 нет (404)', examples: ['P/R#9'] } } }) });
  const r = await backfillPrs({ url: 'http://x', token: 't', fetch });
  assert.equal(r.ok, true);
  assert.equal(r.updated, 0);
  assert.match(summary(r), /дотянуто 0/);
});

test('отказ сервера (503 мост не сконфигурирован) — красный с причиной, не «0 дотянуто»', async () => {
  const { fetch } = fakeServer({}, 503);
  const r = await backfillPrs({ url: 'http://x', token: 't', fetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /503/);
  assert.match(r.error, /мост не сконфигурирован/);
});

test('без токена — заголовок роли super-admin (установка с выключенным входом); с токеном — только Bearer', () => {
  assert.deepEqual(authHeaders(''), { 'X-Seer-Role': 'superadmin' });
  assert.deepEqual(authHeaders('abc'), { Authorization: 'Bearer abc' });
});

test('пробный прогон передаёт dry_run и считает would_update', async () => {
  const { fetch, calls } = fakeServer({ '': portion({ dry_run: true, scanned: 1, would_update: 1, done: true }) });
  const r = await backfillPrs({ url: 'http://x', token: 't', dryRun: true, fetch });
  assert.equal(new URL(calls[0].url).searchParams.get('dry_run'), 'true');
  assert.equal(r.would_update, 1);
});

test('сервер не сдвигает курсор при неполной порции — шаг не крутится вечно', async () => {
  const { fetch } = fakeServer({ '': portion({ scanned: 2, next_after: '', done: false }) });
  const r = await backfillPrs({ url: 'http://x', token: 't', fetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /курсор/);
});

test('шаг в установщике: команда pr-backfill, без файла доступа к базам', async () => {
  const { COMMANDS } = await import('./cli.mjs');
  const c = COMMANDS.find(x => x.name === 'pr-backfill');
  assert.ok(c, 'команда есть');
  assert.equal(c.noEnv, true);
  assert.equal(c.write, false);
  const s = fs.readFileSync(new URL('./pr-backfill.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:child_process/.test(s));
});
