// Ждать выкатку ожидаемого коммита на стенд (E2E-STAND, автозапуск после push в preprod):
//
//   LORE_STAND_URL=… LORE_STAND_STORAGE_STATE=e2e/stand/.auth/stand.json \
//   LORE_STAND_EXPECT_COMMIT=<sha> [LORE_STAND_WAIT_MIN=40] npm run e2e:stand:wait
//
// /lore/version закрыт входом — берём access_token из сохранённого входа (автологин шагом раньше).
// Код выхода: 0 — стенд на нужном коммите; 1 — не дождались (стенд остался на другой сборке).
import { readFileSync } from 'node:fs';
import { deployState } from '../../src/standSmoke/waitDeploy.ts';
import { isForbiddenStandUrl } from '../../src/standSmoke/summary.ts';
import { storedAccessToken } from './tokens.ts';

const url = process.env.LORE_STAND_URL?.trim();
const expected = process.env.LORE_STAND_EXPECT_COMMIT?.trim() ?? '';
const stateFile = process.env.LORE_STAND_STORAGE_STATE?.trim();
const minutes = Number(process.env.LORE_STAND_WAIT_MIN ?? '40') || 40;
if (!url || isForbiddenStandUrl(url)) { console.error('LORE_STAND_URL не задан или это прод'); process.exit(1); }
if (!expected) { console.log('LORE_STAND_EXPECT_COMMIT не задан — не ждём'); process.exit(0); }
if (!stateFile) { console.error('LORE_STAND_STORAGE_STATE не задан — /lore/version без входа не прочитать'); process.exit(1); }

const token = storedAccessToken(JSON.parse(readFileSync(stateFile, 'utf8')));
if (!token) { console.error('в сохранённом входе нет access_token'); process.exit(1); }

const deadline = Date.now() + minutes * 60_000;
let last = 'нет ответа';
for (;;) {
  try {
    const res = await fetch(new URL('/lore/version', url), {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const st = deployState(res.status, body, expected);
    if (st.reached) { console.log(`стенд на ${expected.slice(0, 8)} — запускаем смоук`); process.exit(0); }
    last = `HTTP ${res.status}, коммит ${st.seen?.slice(0, 8) ?? '—'}`;
  } catch (e) {
    last = `стенд не ответил: ${(e as Error).message}`;
  }
  if (Date.now() > deadline) {
    console.error(`за ${minutes} мин стенд не дошёл до ${expected.slice(0, 8)} (последнее: ${last}) — выкатка не доехала или упала`);
    process.exit(1);
  }
  console.log(`ждём выкатку ${expected.slice(0, 8)}: ${last}`);
  await new Promise(r => setTimeout(r, 30_000));
}
