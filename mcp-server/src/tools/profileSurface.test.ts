import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLoreRead } from './loreRead.js';
import { registerLoreWrite } from './loreWrite.js';
import { registerMuninn } from './muninn.js';
import { registerClaudeRules } from './claudeRules.js';
import { registerVersion } from './version.js';
import { withStrictTools } from './strictTool.js';
import { corePermission, fullPermission, gateFor, permissionForProfile, type Permission } from '../profile.js';

// SPRINT_LORE_MCP_V2/MCPV2-1: снапшот ПОВЕРХНОСТИ (имён зарегистрированных
// инструментов) по каждому профилю выдачи. Смена набора под любым профилем —
// красный тест с дифом; намеренная смена — UPDATE_PROFILE_SURFACE=1 и коммит.
const SNAPSHOT_URL = new URL('./profile-surface.snapshot.json', import.meta.url);

function namesFor(perm: Permission): string[] {
  const names: string[] = [];
  const fake = {
    tool: (...args: unknown[]) => { names.push(args[0] as string); },
    registerTool: ((name: string) => { names.push(name); }) as never,
  } as unknown as McpServer;
  // Гейт применяется обёрткой, как в index.ts; forgejo_* вне моста не регистрируются.
  const server = withStrictTools(fake, gateFor([perm]));
  registerLoreRead(server);
  registerLoreWrite(server);
  registerMuninn(server);
  registerClaudeRules(server);
  registerVersion(server);
  return names.sort();
}

function allProfiles(): string[] {
  const dir = fileURLToPath(new URL('../../agent-profiles/', import.meta.url));
  // tool-paths.json — реестр «инструмент → пути бэкенда», не профиль разрешений.
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'tool-paths.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function surface(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    full: namesFor(fullPermission()),
    core: namesFor(corePermission()),
  };
  for (const p of allProfiles()) out[p] = namesFor(permissionForProfile(p));
  return out;
}

describe('поверхность по профилям — снапшот', () => {
  it('набор инструментов каждого профиля совпадает со снимком', () => {
    const actual = surface();
    if (process.env.UPDATE_PROFILE_SURFACE === '1') {
      writeFileSync(SNAPSHOT_URL, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    const expected = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf-8')) as Record<string, string[]>;
    for (const p of Object.keys(actual).sort()) {
      expect(actual[p], `профиль ${p}: снапшот устарел — UPDATE_PROFILE_SURFACE=1 npx vitest run src/tools/profileSurface.test.ts и закоммитить`).toEqual(expected[p] ?? []);
    }
    // Профиль пропал из agent-profiles/ — его снапшот не должен остаться висячим.
    for (const p of Object.keys(expected)) {
      expect(Object.keys(actual), `профиль ${p} есть в снапшоте, но файла нет`).toContain(p);
    }
  });

  it('санити: core — только чтение, full ⊇ developer ⊇ core', () => {
    const s = surface();
    expect(s['full'].length).toBeGreaterThan(s['developer'].length);
    expect(s['developer'].length).toBeGreaterThan(s['core'].length);
    for (const t of s['core']) expect(s['developer'], `core-инструмент ${t} пропал у developer`).toContain(t);
    expect(s['core']).not.toContain('task_new');
  });
});
