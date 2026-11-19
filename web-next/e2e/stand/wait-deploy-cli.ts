// Ждать выкатку ожидаемого коммита на стенд (E2E-STAND, автозапуск после push в preprod):
//
//   LORE_STAND_URL=… LORE_STAND_STORAGE_STATE=e2e/stand/.auth/stand.json \
//   LORE_STAND_EXPECT_COMMIT=<sha> [LORE_STAND_WAIT_MIN=40] npm run e2e:stand:wait
//
// /lore/version закрыт входом — берём access_token из сохранённого входа (автологин шагом раньше).
// Код выхода: 0 — стенд на нужном коммите; 1 — не дождались (стенд остался на другой сборке).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { backendDeployExpected, deployState, docsOnlyChange, shouldRelogin } from '../../src/standSmoke/waitDeploy.ts';
import { parseStandAccounts } from './accounts.ts';
import { standLogin } from './login.ts';
import { isForbiddenStandUrl } from '../../src/standSmoke/summary.ts';
import { storedAccessToken } from './tokens.ts';

const url = process.env.LORE_STAND_URL?.trim();
const expected = process.env.LORE_STAND_EXPECT_COMMIT?.trim() ?? '';
const stateFile = process.env.LORE_STAND_STORAGE_STATE?.trim();
const minutes = Number(process.env.LORE_STAND_WAIT_MIN ?? '40') || 40;
if (!url || isForbiddenStandUrl(url)) { console.error('LORE_STAND_URL не задан или это прод'); process.exit(1); }
if (!expected) { console.log('LORE_STAND_EXPECT_COMMIT не задан — не ждём'); process.exit(0); }
if (!stateFile) { console.error('LORE_STAND_STORAGE_STATE не задан — /lore/version без входа не прочитать'); process.exit(1); }

let token = storedAccessToken(JSON.parse(readFileSync(stateFile, 'utf8')));
if (!token) { console.error('в сохранённом входе нет access_token'); process.exit(1); }

// Токен входа живёт ~15 мин, ожидание — до 40: на 401 входим заново той же учёткой (test-sa, иначе test-admin) и
// перечитываем токен. Прогон 9017 (18.11.2026) упал «стенд не дошёл» именно на истёкшем токене.
/** Файлы между сборкой стенда и ожидаемым коммитом; git недоступен или коммита нет в истории — null. */
function changedFiles(from: string, to: string): string[] | null {
  try {
    return execFileSync('git', ['diff', '--name-only', from, to], { encoding: 'utf8' }).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  } catch { return null; }
}

/** Вывод `ci-scope.sh cd` для набора файлов — то же решение «что выкатывать», что принимает LORE CD. Сбой — ''. */
function cdScope(files: string[]): string {
  try {
    return execFileSync('bash', ['../.github/scripts/ci-scope.sh', 'cd'], {
      encoding: 'utf8', env: { ...process.env, CI_SCOPE_FILES: files.join('\n'), EVENT_NAME: 'push', GITHUB_OUTPUT: '' },
    });
  } catch { return ''; }
}

let relogins = 0;
async function relogin(): Promise<boolean> {
  const { accounts } = parseStandAccounts(process.env.LORE_STAND_ACCOUNTS_JSON);
  const a = accounts.find(x => x.login === 'test-sa') ?? accounts.find(x => x.login === 'test-admin');
  if (!a || !url || !stateFile) return false;
  const channel = process.env.LORE_STAND_CHANNEL?.trim();
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const r = await standLogin(browser, url, a.login, a.password, stateFile);
    if (!r.ok) return false;
    token = storedAccessToken(JSON.parse(readFileSync(stateFile, 'utf8')));
    return !!token;
  } finally { await browser.close(); }
}

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
    if (res.status === 200 && st.seen) {
      const files = changedFiles(st.seen, expected);
      if (files && docsOnlyChange(files)) {
        console.log(`стенд на ${st.seen.slice(0, 8)}; до ${expected.slice(0, 8)} изменились только документы (${files.length}) — сборка та же, запускаем смоук`);
        process.exit(0);
      }
      if (files && files.length > 0 && backendDeployExpected(cdScope(files)) === false) {
        console.log(`стенд на ${st.seen.slice(0, 8)}; до ${expected.slice(0, 8)} бэкенд по правилам CD не выкатывается (${files.length} файл(ов)) — /lore/version законно на прежнем коммите, запускаем смоук`);
        process.exit(0);
      }
    }
    last = `HTTP ${res.status}, коммит ${st.seen?.slice(0, 8) ?? '—'}`;
    if (shouldRelogin(res.status, relogins)) {
      relogins++;
      const ok = await relogin();
      console.log(`токен входа истёк (401) — вход заново: ${ok ? 'вошла' : 'не вошла'} (${relogins})`);
      if (ok) continue;
    }
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
