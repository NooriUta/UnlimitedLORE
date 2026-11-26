// SPRINT_LORE_EXT_ISSUES_W2/ISS-06-LINK-FALSE-SUCCESS (issue #6), решение
// D-2026-LORE-MCP-LINK-NOOP-IS-ERROR при ADR-LORE-043. Владелец 25.11.2026: «однородно возвращать
// ошибку с объяснением на noop если запрос был на cud без r».
//
// Бэкенд отвечает ok:true + outcome. Если CUD-запрос ничего не изменил (outcome=noop — не сделано;
// outcome=unchanged — уже такое значение / связь уже есть), MCP отдаёт isError:true: первая строка —
// объяснение, JSON ответа целиком ниже. Чтение не затрагивается.
//
// Сторож: каждый инструмент полной поверхности помечен read|cud (toolKinds.ts), каждый cud идёт
// через общую обёртку (strictTool.ts), никто не регистрирует инструменты мимо неё.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const REASON = 'ребро не создано: проект NOPE/x не найден(ы). МЕТКА-ПРИЧИНЫ-БЭКЕНДА';
const noopBody = { ok: true, linked: false, action: 'added', outcome: 'noop', reason: REASON, project_candidates: ['Acme/x'] };
const unchangedBody = { ok: true, linked: false, outcome: 'unchanged', hint: 'связь уже была — повторять вызов не нужно' };

let backend: Server;
let mode: 'noop' | 'unchanged' = 'noop';

beforeAll(async () => {
  backend = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Чтение отвечает ТОЖЕ outcome:noop — чтобы проверить, что чтение ошибкой не становится.
    if (req.method !== 'POST') { res.end(JSON.stringify({ rows: [], outcome: 'noop' })); return; }
    res.end(JSON.stringify(mode === 'noop' ? noopBody : unchangedBody));
  });
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
  process.env.LORE_BACKEND_URL = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  // Окружение машины (секреты OIDC и т.п.) не должно влиять: режим заголовка, как в stdio по умолчанию.
  for (const k of Object.keys(process.env)) if (k.startsWith('LORE_MCP_') || k.startsWith('LORE_OIDC')) delete process.env[k];
  process.env.LORE_SEER_ROLE = 'admin';
  process.env.LORE_ACTIVE_PROJECT = 'Acme/x';
  process.env.LORE_FORGEJO = 'true';
});

afterAll(async () => {
  await new Promise<void>((r) => backend?.close(() => r()));
});

type Res = { isError?: boolean; content: { type: string; text: string }[] };
const text = (r: Res) => r.content.map((c) => c.text).join('\n');
const wrap = (b: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(b, null, 2) }] });

async function fullServer(): Promise<McpServer> {
  const { createLoreServer, resolveSurface } = await import('../server.js');
  const { surface, profiles } = resolveSurface(null, null, () => {});
  return createLoreServer(surface, profiles, true);
}

describe('noopAsError: «ничего не изменилось» → ошибка протокола MCP', () => {
  it('noop → isError, первая строка — причина и подсказка, JSON сохранён целиком', async () => {
    const { noopAsError } = await import('./cudOutcome.js');
    const r = noopAsError(wrap(noopBody)) as Res;
    expect(r.isError).toBe(true);
    const t = text(r);
    expect(t.startsWith('НЕ СДЕЛАНО')).toBe(true);
    expect(t.indexOf(REASON)).toBeLessThan(t.indexOf('{'));
    expect(t.slice(0, t.indexOf('{'))).toContain('Acme/x');
    expect(JSON.parse(t.slice(t.indexOf('{')))).toEqual(noopBody);
  });

  it('noop по проекту без кандидатов — подсказка «project_new»; без reason — честное «причину не назвал»', async () => {
    const { noopAsError } = await import('./cudOutcome.js');
    expect(text(noopAsError(wrap({ ok: true, project: 'NOPE/x', outcome: 'noop', reason: 'ребро не создано' })) as Res)).toMatch(/project_new/);
    expect(text(noopAsError(wrap({ ok: true, outcome: 'noop' })) as Res)).toMatch(/причину не назвал/);
  });

  it('unchanged (уже такое значение / связь уже есть) — тоже ошибка: «изменений нет: уже такое значение»', async () => {
    const { noopAsError } = await import('./cudOutcome.js');
    const r = noopAsError(wrap(unchangedBody)) as Res;
    expect(r.isError).toBe(true);
    expect(text(r).startsWith('ИЗМЕНЕНИЙ НЕТ')).toBe(true);
    expect(text(r)).toMatch(/уже такое значение/);
    expect(JSON.parse(text(r).slice(text(r).indexOf('{')))).toEqual(unchangedBody);
  });

  it('created/updated/deleted, без outcome, не JSON, уже ошибка — без изменений', async () => {
    const { noopAsError } = await import('./cudOutcome.js');
    for (const b of [{ ok: true, outcome: 'created' }, { ok: true, outcome: 'updated' }, { ok: true, outcome: 'deleted' }, { ok: true }, [1]]) {
      const r = wrap(b);
      expect(noopAsError(r), JSON.stringify(b)).toBe(r);
    }
    const plain = { content: [{ type: 'text', text: 'not json' }] };
    expect(noopAsError(plain)).toBe(plain);
    const already = { isError: true, content: [{ type: 'text', text: JSON.stringify(noopBody) }] };
    expect(noopAsError(already)).toBe(already);
  });
});

describe('сторож: пометка read|cud и общая обёртка', () => {
  it('каждый инструмент полной поверхности помечен read или cud; лишних пометок нет', async () => {
    const { TOOL_KIND } = await import('./toolKinds.js');
    const names = Object.keys((await fullServer() as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => !TOOL_KIND[n])).toEqual([]);
    expect(Object.keys(TOOL_KIND).filter((n) => !names.includes(n))).toEqual([]);
  });

  it('каждый cud зарегистрирован через обёртку noopAsError, каждый read — без неё; описание cud называет правило', async () => {
    const { TOOL_KIND } = await import('./toolKinds.js');
    const { NOOP_GUARD } = await import('./strictTool.js');
    const reg = (await fullServer() as unknown as { _registeredTools: Record<string, { handler: unknown; description?: string }> })._registeredTools;
    const bad: string[] = [];
    for (const [n, t] of Object.entries(reg)) {
      const guarded = (t.handler as Record<symbol, unknown>)[NOOP_GUARD] === true;
      if (TOOL_KIND[n] === 'cud' && !guarded) bad.push(`${n}: cud без обёртки`);
      if (TOOL_KIND[n] === 'read' && guarded) bad.push(`${n}: read в обёртке`);
      if (TOOL_KIND[n] === 'cud' && !(t.description ?? '').includes('returned as an ERROR')) bad.push(`${n}: в описании нет правила`);
    }
    expect(bad).toEqual([]);
  });

  it('никто не регистрирует инструменты мимо server.tool (registerTool — только в strictTool.ts)', () => {
    const offenders: string[] = [];
    for (const dir of [new URL('.', import.meta.url), new URL('../', import.meta.url)]) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'strictTool.ts') continue;
        if (/\.registerTool\(/.test(readFileSync(new URL(f, dir), 'utf8'))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Аргументы по JSON Schema инструмента: обязательные поля + rel/project/target_id, если есть. */
function argsFor(schema: { properties?: Record<string, Record<string, unknown>>; required?: string[] }): Record<string, unknown> {
  const props = schema.properties ?? {};
  const keys = new Set([...(schema.required ?? []), ...['rel', 'project', 'git_project', 'target_id'].filter((k) => k in props)]);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const p = props[k] ?? {};
    // rel=project — случай issue #6; есть не у всех, тогда первое значение.
    if (Array.isArray(p.enum)) out[k] = p.enum.includes('project') ? 'project' : p.enum[0];
    else if (p.const !== undefined) out[k] = p.const;
    else if (k === 'rel') out[k] = 'project';
    else if (p.type === 'number' || p.type === 'integer') out[k] = 1;
    else if (p.type === 'boolean') out[k] = true;
    else if (p.type === 'array') out[k] = ['X-1'];
    else if (p.type === 'object') out[k] = { project: 'Acme/x' };
    else out[k] = k === 'project' || k === 'git_project' ? 'Acme/x' : 'X-1';
  }
  return out;
}

async function connectFull(): Promise<Client> {
  const server = await fullServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cud-guard', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('живой вызов через сервер', () => {
  it('issue #6: каждый *_link и entity_link на noop бэкенда — isError с причиной бэкенда первой строкой', async () => {
    mode = 'noop';
    const client = await connectFull();
    const tools = (await client.listTools()).tools.filter((t) => /_link$/.test(t.name));
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      'sprint_link', 'uc_link', 'doc_link', 'adr_link', 'runbook_link', 'decision_link', 'question_link', 'feature_link', 'entity_link',
    ]));
    const bad: string[] = [];
    for (const t of tools) {
      const r = (await client.callTool({ name: t.name, arguments: argsFor(t.inputSchema as never) })) as Res;
      const tx = text(r);
      if (!(r.isError === true && tx.startsWith('НЕ СДЕЛАНО') && tx.includes('МЕТКА-ПРИЧИНЫ-БЭКЕНДА'))) {
        bad.push(`${t.name}: isError=${r.isError} ${tx.slice(0, 160).replace(/\s+/g, ' ')}`);
      }
    }
    expect(bad).toEqual([]);
    await client.close();
  }, 60_000);

  it('повтор (unchanged) у status_set и sprint_link — тоже ошибка «изменений нет»', async () => {
    mode = 'unchanged';
    const client = await connectFull();
    for (const call of [
      { name: 'status_set', arguments: { entity_type: 'task', id: 'SPRINT_X/T-1', status: 'active' } },
      { name: 'sprint_link', arguments: { sprint_id: 'SPRINT_X', rel: 'project', target_id: 'Acme/x' } },
    ]) {
      const r = (await client.callTool(call)) as Res;
      expect(r.isError, call.name).toBe(true);
      expect(text(r).startsWith('ИЗМЕНЕНИЙ НЕТ'), call.name).toBe(true);
    }
    await client.close();
  });

  it('чтение с outcome:noop в ответе ошибкой не становится', async () => {
    mode = 'noop';
    const client = await connectFull();
    const r = (await client.callTool({ name: 'query_slice', arguments: { slice: 'sprints' } })) as Res;
    expect(r.isError).not.toBe(true);
    await client.close();
  });
});
