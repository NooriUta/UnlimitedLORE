// Забирает client-secret клиента lore-admin из Keycloak и записывает его в
// .env репозитория (gitignored). Секрет НЕ печатается — только факт записи.
// Запуск: node backend/keycloak/kc-fetch-admin-secret.js
const fs = require('fs'), path = require('path'), http = require('http');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const USER = process.env.KC_ADMIN_USER, PASS = process.env.KC_ADMIN_PASS;
const REALM = process.env.KC_ADMIN_REALM || 'omilore';
const BASE = (process.env.KC_ADMIN_URL || 'http://localhost:18180/kc').replace(/^https?:\/\/[^/]+/, '');
const HOST = (process.env.KC_ADMIN_URL || 'http://localhost:18180/kc').match(/^https?:\/\/([^:/]+)/)[1];
const PORT = Number((process.env.KC_ADMIN_URL || '').match(/:(\d+)/)?.[1] || 18180);
if (!USER || !PASS) { console.log('Нет KC_ADMIN_USER/KC_ADMIN_PASS в .env'); process.exit(1); }

function req(method, p, body, token, form) {
  return new Promise((res, rej) => {
    const data = body ? (form ? body : JSON.stringify(body)) : null;
    const r = http.request({ host: HOST, port: PORT, path: BASE + p, method,
      headers: Object.assign({ 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}, token ? { Authorization: 'Bearer ' + token } : {}) },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ code: x.statusCode, body: d })); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

(async () => {
  const tok = await req('POST', '/realms/master/protocol/openid-connect/token',
    `grant_type=password&client_id=admin-cli&username=${encodeURIComponent(USER)}&password=${encodeURIComponent(PASS)}`, null, true);
  if (tok.code !== 200) { console.log('admin token FAIL ' + tok.code); process.exit(1); }
  const T = JSON.parse(tok.body).access_token;

  const list = await req('GET', `/admin/realms/${REALM}/clients?clientId=lore-admin`, null, T);
  const arr = JSON.parse(list.body);
  if (!arr.length) { console.log('клиент lore-admin не найден — сначала запустите kc-provision-agents.js'); process.exit(1); }
  const id = arr[0].id;

  const sec = await req('GET', `/admin/realms/${REALM}/clients/${id}/client-secret`, null, T);
  if (sec.code !== 200) { console.log('не удалось прочитать секрет: ' + sec.code); process.exit(1); }
  const value = JSON.parse(sec.body).value;
  if (!value) { console.log('секрет пуст — сгенерируйте его в KC (Credentials → Regenerate)'); process.exit(1); }

  let env = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^KC_ADMIN_CLIENT_SECRET=.*$/m.test(env)) env = env.replace(/^KC_ADMIN_CLIENT_SECRET=.*$/m, 'KC_ADMIN_CLIENT_SECRET=' + value);
  else env += (env.endsWith('\n') ? '' : '\n') + 'KC_ADMIN_CLIENT_SECRET=' + value + '\n';
  fs.writeFileSync(ENV_PATH, env);
  console.log('KC_ADMIN_CLIENT_SECRET записан в .env (' + value.length + ' симв) — значение не выводится');
})().catch(e => console.log('ERR ' + e.message));
