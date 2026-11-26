// Автологин всех тестовых учёток стенда одной командой (AP-02, E2E-STAND):
//
//   LORE_STAND_URL=https://preprod.lore.odal.seidrstudio.pro \
//   LORE_STAND_ACCOUNTS_JSON='{"test-sa":"…",…}' \
//   npm run e2e:stand:login
//
// Пишет e2e/stand/.auth/<логин>.json (папка в .gitignore) и stand.json = вход test-sa (super-admin: у admin без проектов лента пуста)
// (или test-admin, если test-sa не вошла) для смоука. Прод отвергается так же, как смоуком. Пароли не печатаются.
// Код выхода: 0 — все вошли; 1 — хоть одна не вошла или учёток нет.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { authFileFor } from '../../src/standSmoke/rbac.ts';
import { isForbiddenStandUrl } from '../../src/standSmoke/summary.ts';
import { parseStandAccounts } from './accounts.ts';
import { standLogin } from './login.ts';

const url = process.env.LORE_STAND_URL?.trim();
const dir = resolve(process.env.LORE_STAND_AUTH_DIR?.trim() || 'e2e/stand/.auth');
if (!url) { console.error('LORE_STAND_URL не задан'); process.exit(1); }
if (isForbiddenStandUrl(url)) { console.error('адрес прода — автологин на проде запрещён'); process.exit(1); }
const { accounts, error } = parseStandAccounts(process.env.LORE_STAND_ACCOUNTS_JSON);
if (error) { console.error(error); process.exit(1); }
if (accounts.length === 0) { console.error('LORE_STAND_ACCOUNTS_JSON не задан — учёток нет'); process.exit(1); }

mkdirSync(dir, { recursive: true });
const channel = process.env.LORE_STAND_CHANNEL?.trim();
const browser = await chromium.launch(channel ? { channel } : {});
let failed = 0;
for (const a of accounts) {
  const r = await standLogin(browser, url, a.login, a.password, authFileFor(dir, a.login));
  if (r.ok) console.log(`вошла: ${a.login}`);
  else { failed++; console.log(`НЕ вошла: ${a.login} — ${r.reason}`); }
}
await browser.close();
for (const admin of ['test-sa', 'test-admin']) {
  const f = authFileFor(dir, admin);
  if (existsSync(f)) { copyFileSync(f, resolve(dir, 'stand.json')); console.log(`stand.json = ${admin}`); break; }
}
process.exit(failed ? 1 : 0);
