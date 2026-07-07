#!/usr/bin/env node
// Drift check: the TS mirrors of the LORE status vocabulary must match the
// canonical shared/lore-statuses.json. Replaces the old "Keep in sync with…"
// comments with a CI gate. Run via `npm run check:statuses`.
//
// Backend Java has its own mirror guarded by LoreStatusesConsistencyTest (JUnit).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(readFileSync(join(root, 'shared/lore-statuses.json'), 'utf8'));
const expected = canonical.planStatuses;

const errors = [];

function extractQuoted(block) {
  return [...block.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]);
}

function same(label, got) {
  const a = [...expected].sort();
  const b = [...got].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    errors.push(`${label}: mismatch vs shared/lore-statuses.json.planStatuses\n  canonical: ${a.join(', ')}\n  got:       ${b.join(', ')}`);
  }
}

// 1) MCP: const LORE_STATUS = z.enum([ ... ]);
{
  const src = readFileSync(join(root, 'mcp-server/src/tools/loreWrite.ts'), 'utf8');
  const m = src.match(/const LORE_STATUS = z\.enum\(\[([\s\S]*?)\]\)/);
  if (!m) errors.push('MCP: could not locate `const LORE_STATUS = z.enum([...])` in loreWrite.ts');
  else same('MCP LORE_STATUS', extractQuoted(m[1]));
}

// 2) Frontend: export type LorePlanItemStatus = 'a' | 'b' | ...;
{
  const src = readFileSync(join(root, 'src/api/lore.ts'), 'utf8');
  const m = src.match(/export type LorePlanItemStatus =([^;]*);/);
  if (!m) errors.push('Frontend: could not locate `export type LorePlanItemStatus` in src/api/lore.ts');
  else same('Frontend LorePlanItemStatus', extractQuoted(m[1]));
}

if (errors.length) {
  console.error('✗ LORE status drift detected:\n\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log(`✓ LORE status vocabularies in sync (${expected.length} plan statuses).`);
