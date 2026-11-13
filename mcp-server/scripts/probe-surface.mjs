// Препрод-проба MCP v2 (SPRINT_LORE_MCP_V2): поднимает собранный dist/index.js
// против препрод-бэкенда и печатает поверхность (число/имена инструментов) для
// заданного LORE_MCP_PROFILE. Роль — из agent_scope токена клиента (OIDC-env).
// Запуск: node scripts/probe-surface.mjs [profile|""]
import { spawn } from 'node:child_process';

const profile = process.argv[2] ?? '';
const env = {
  ...process.env,
  LORE_BACKEND_URL: 'https://preprod.lore.odal.seidrstudio.pro/_backend',
  LORE_OIDC_ISSUER: 'https://odal.seidrstudio.pro/kc/realms/omilore',
  LORE_MCP_CLIENT_ID: 'lore-mcp-full_kimi',
  LORE_MCP_CLIENT_SECRET: process.env.LORE_MCP_CLIENT_SECRET_DSH,
  LORE_MACHINE_ID: 'LorCetus',
  ...(profile ? { LORE_MCP_PROFILE: profile } : {}),
};

const child = spawn('node', ['dist/index.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
let buf = '';
const names = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout; stderr:\n' + stderr)), 30000);
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === 1) send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      if (msg.id === 2) { clearTimeout(to); resolve(msg.result.tools.map((t) => t.name).sort()); }
    }
  });
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1.0' } } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
});
child.kill();
const surfaceLine = (stderr.match(/surface: .*/) || [''])[0];
console.log(`PROFILE=${profile || '(none)'}  tools=${names.length}  ${surfaceLine}`);
console.log(names.join(' '));
