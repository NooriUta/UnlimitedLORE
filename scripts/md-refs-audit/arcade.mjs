// Read-only ArcadeDB client for the MD-refs audit (SPRINT_UXR_POLISH_UAT_1113/PU-15).
// Only SELECT statements pass: anything else is refused before it leaves the machine.
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function connection({ envFile } = {}) {
  const fileEnv = envFile ? loadEnvFile(path.resolve(envFile)) : {};
  const get = (k, d) => process.env[k] ?? fileEnv[k] ?? d;
  // Прод LORE — 192.168.3.143 (слова владелицы 13.11.2026); на .131:2480 system_aida_lore закрыта.
  const host = get('ARCADE_HOST', '192.168.3.143');
  const port = get('ARCADE_PORT', '2480');
  const db = get('ARCADE_DB', 'system_aida_lore');
  const user = get('ARCADE_USER', 'root');
  const pass = get('ARCADEDB_ROOT_PASSWORD');
  if (!pass) throw new Error('ARCADEDB_ROOT_PASSWORD не задан (ни в окружении, ни в --env-file)');
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  return { url: `http://${host}:${port}/api/v1/query/${encodeURIComponent(db)}`, auth, host, port, db };
}

const READ_ONLY = /^\s*(select|match)\b/i;

export async function query(conn, sql, params) {
  if (!READ_ONLY.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error('Только SELECT: отказ выполнять «' + sql.slice(0, 60) + '»');
  }
  const res = await fetch(conn.url, {
    method: 'POST',
    headers: { Authorization: conn.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'sql', command: sql, params: params ?? {} }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ArcadeDB ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).result;
}
