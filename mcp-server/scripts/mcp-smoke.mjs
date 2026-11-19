// Смоук MCP-сервера LORE против любого бэкенда (владелица 19.11.2026: «проверки на всех местах работы — mcp,
// бэк, интеграции и ui должны работать»). Поднимает настоящий MCP-сервер (dist/index.js) как дочерний процесс,
// перечисляет инструменты и вызывает набор на чтение и — с --write — на запись (только в тестовую копию!).
// Запуск: LORE_BACKEND_URL=http://127.0.0.1:9192 node scripts/mcp-smoke.mjs [--write]
// По адресу (AO-MCP-HOSTED): LORE_MCP_URL=https://<хост LORE>/mcp LORE_MCP_TOKEN=<токен> [LORE_MCP_PROFILE=full]
//   node scripts/mcp-smoke.mjs — тот же набор вызовов против развёрнутого MCP, без дочернего процесса.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpUrl = (process.env.LORE_MCP_URL || '').trim();
const url = mcpUrl || process.env.LORE_BACKEND_URL;
if (!url) { console.error('не задан ни LORE_MCP_URL (MCP по адресу), ни LORE_BACKEND_URL (локальный MCP)'); process.exit(2); }
if (mcpUrl && !(process.env.LORE_MCP_TOKEN || '').trim()) { console.error('LORE_MCP_URL задан, а LORE_MCP_TOKEN нет — MCP по адресу без токена отвечает 401'); process.exit(2); }
if (/lore\.odal|192\.168\.3\.131/.test(url) && process.argv.includes('--write')) { console.error('запись на прод/стенд запрещена'); process.exit(2); }
const write = process.argv.includes('--write');
// Окружение ребёнка — без входа OIDC: тестовый бэкенд работает с заглушкой входа, а частичная настройка OIDC из
// окружения вызывающего (например, один секрет без issuer) по праву роняет MCP. Значения не печатаются.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^LORE_(MCP_CLIENT_|OIDC_)/.test(k)));
// Токен не печатается: он уходит только заголовком.
const transport = mcpUrl
  ? new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: {
      Authorization: 'Bearer ' + process.env.LORE_MCP_TOKEN.trim(),
      'X-Lore-Mcp-Profile': (process.env.LORE_MCP_PROFILE || 'full').trim(),
    } } })
  : new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { ...childEnv, LORE_BACKEND_URL: url, LORE_SEER_ROLE: process.env.LORE_SEER_ROLE || 'admin' } });
console.log(`режим: ${mcpUrl ? 'по адресу ' + mcpUrl : 'локальный dist/index.js → ' + url}`);
const client = new Client({ name: 'mcp-smoke', version: '1' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`инструментов: ${tools.length}`);
const results = [];
const call = async (name, args, check = () => true) => {
  if (!tools.some(t => t.name === name)) { results.push({ name, ok: false, why: 'нет инструмента' }); return null; }
  const t0 = Date.now();
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content || []).map(c => c.text || '').join('');
    const ok = !r.isError && check(text);
    results.push({ name, ok, ms: Date.now() - t0, why: ok ? '' : text.slice(0, 200) });
    return text;
  } catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, why: e.message.slice(0, 200) }); return null; }
};
const nonEmptyArray = t => { try { const j = JSON.parse(t); return Array.isArray(j) ? j.length > 0 : !!j; } catch { return t.length > 0; } };
// чтение
await call('lore_version', {});
await call('list_slices', {}, t => t.includes('sprints'));
for (const [slice, params] of [['sprints', {}], ['open_tasks', {}], ['adrs', {}], ['decisions', {}], ['specs', {}], ['docs', {}], ['components', {}], ['products', {}], ['git_projects', {}], ['releases', {}], ['milestones', {}], ['quality_gates', {}], ['tasks_of_sprint', { sprint_id: 'SPRINT_LORE_MODEL_DOCS_TIDY' }], ['sprint_tree', { id: 'SPRINT_LORE_MODEL_DOCS_TIDY' }], ['repositories', {}], ['repos_of_project', { project: 'AIDA/MIDGARD' }]])
  await call('query_slice', { slice, params }, nonEmptyArray).then(() => { results[results.length - 1].name = `query_slice:${slice}`; });
await call('search', { q: 'миграция', limit: 5 }, t => /"hits"/.test(t));
// запись — только в копию
if (write) {
  const sid = 'SPRINT_MCP_SMOKE_' + Date.now().toString(36).toUpperCase();
  await call('sprint_new', { sprint_id: sid, name: 'Смоук MCP на новой модели', project: 'NooriUta/UnlimitedLORE' }, t => /"ok":\s*true/.test(t));
  await call('task_new', { sprint_id: sid, task_id: 'T-1', title: 'Проверка записи задачи', author_agent: 'omiloreadmin', executor_agent: 'omiloreadmin', reviewer_agent: 'arharaga' }, t => /"ok":\s*true/.test(t));
  await call('task_set', { task_uid: `${sid}/T-1`, title: 'Проверка записи задачи', note_append: 'заметка смоука' }, t => /"ok":\s*true/.test(t));
  await call('status_set', { entity_type: 'task', id: `${sid}/T-1`, status: 'active' }, t => /"ok":\s*true/.test(t));
  await call('status_set', { entity_type: 'task', id: `${sid}/T-1`, status: 'blocked', reason: 'смоук: причина' }, t => /"ok":\s*true/.test(t));
  await call('query_slice', { slice: 'tasks_by_uids', params: { task_uids: `${sid}/T-1` } }, t => /BLOCKED|blocked/.test(t) && /смоук: причина/.test(t)).then(() => { results[results.length - 1].name = 'проверка: статус и причина записаны'; });
  await call('decision_new', { decision_id: 'D-SMOKE-' + Date.now().toString(36).toUpperCase(), title: 'Смоук решения', body_md: 'проверка', project: 'NooriUta/UnlimitedLORE' }, t => /"ok":\s*true/.test(t));
}
await client.close();
const bad = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ms !== undefined ? ` ${r.ms} мс` : ''}${r.why ? ' — ' + r.why : ''}`);
console.log(`ИТОГ: ${results.length - bad.length}/${results.length} зелёные`);
process.exit(bad.length ? 1 : 0);
