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

// 3) SPRINT_QG_REBUILD/QG-13 — the READ axis: taskTick() recognises free-text
// status_raw, and its "done" vocabulary is a mirror of statusMatch.done. This is
// the copy that actually drifted: MERGED and ЗАКРЫТ were missing here, so the
// same task read as closed in the backend and open on screen.
{
  const canon = canonical.statusMatch?.done;
  if (!canon) errors.push('statusMatch.done missing from shared/lore-statuses.json');
  else {
    const src = readFileSync(join(root, 'src/components/lore/lore-status.ts'), 'utf8');
    const m = src.match(
      /startsWith\('(.)'\)\s*\|\|\s*\/\^\(([^)]+)\)\/i\.test\(s\)\)\s*return\s*\{\s*status:\s*'done'/,
    );
    // A regex that stopped matching would turn this gate into a silent pass —
    // the exact failure mode the whole sprint is about.
    if (!m) {
      errors.push(
        "Frontend taskTick: could not locate the 'done' branch in lore-status.ts — " +
          'the check would have passed without checking anything',
      );
    } else {
      if (m[1] !== canon.marker) {
        errors.push(`Frontend taskTick 'done' marker: got ${m[1]}, canonical ${canon.marker}`);
      }
      const got = m[2].split('|').map((w) => w.trim().toUpperCase()).filter(Boolean);
      const a = [...canon.words].sort();
      const b = [...got].sort();
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
        errors.push(
          `Frontend taskTick 'done' words: mismatch vs shared/lore-statuses.json.statusMatch.done\n  canonical: ${a.join(', ')}\n  got:       ${b.join(', ')}`,
        );
      }
    }
  }
}

if (errors.length) {
  console.error('✗ LORE status drift detected:\n\n' + errors.join('\n\n'));
  process.exit(1);
}
console.log(`✓ LORE status vocabularies in sync (${expected.length} plan statuses, read-axis 'done' pinned).`);
