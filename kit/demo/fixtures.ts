// Фикстуры X_DATA для демо и рендер-тестов kit. Детерминированы: свой ГПСЧ с
// постоянным зерном, без Math.random и без текущего времени — снимки и счётчики
// одинаковы от прогона к прогону.
import type { KitData, KitEdge, KitRecord } from '../src/core/contract';

/** LCG (Numerical Recipes) — одинаковая последовательность на любом движке. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 1);
const iso = (n: number) => new Date(EPOCH - n * DAY).toISOString();

/* ---------- «Дата-странники»: выдача обрезана сервером ---------- */

const DW_KINDS = ['Quiz', 'Scroll', 'Trail', 'Rule', 'Topic', 'Item', 'ItemTemplate', 'ErrorPattern',
  'Author', 'Rune', 'Porcha', 'SchoolStep', 'Dream', 'Wanderer', 'Quest'] as const;
const DW_DISC = ['Сон о числах', 'Сон о словах', 'Сон о картах', 'Сон о звёздах', 'Сон о травах', 'Сон о рунах'] as const;
const DW_FAIL = ['no_hint', 'no_quiz', 'no_author', 'dup_option'] as const;

/** 181 из 240 записей: сервер обрезал выдачу (meta.truncated + total). */
export function datawanderersData(): KitData {
  const r = rng(20261107);
  const records: KitRecord[] = [];
  for (let i = 1; i <= 181; i++) {
    const kind = pick(r, DW_KINDS);
    const bad = r() < 0.3;
    const failed = bad ? [{ code: pick(r, DW_FAIL), message: 'провал проверки' }] : [];
    records.push({
      id: `${kind.toLowerCase()}-${String(i).padStart(3, '0')}`,
      kind,
      title: `${kind} №${i}`,
      status: pick(r, ['', '', 'fix', 'ok'] as const),
      fields: {
        disc: pick(r, DW_DISC),
        quality: bad ? 'bad' : 'ok',
        has_edit: r() < 0.15 ? 'yes' : 'no',
        verdict: { score: bad ? 3 : 5, max: 5, failed, hints: r() < 0.2 ? [{ code: 'short_text', message: '' }] : [] },
      },
      updated_at: iso(Math.floor(r() * 60)),
    });
  }
  const edges: KitEdge[] = [];
  for (let i = 0; i < 260; i++) {
    edges.push({ from: pick(r, records).id, to: pick(r, records).id, type: pick(r, ['PREREQ', 'SUBTOPIC', 'ASSESSES', 'QUIZ_OF'] as const) });
  }
  return {
    records,
    edges,
    journal: [],
    meta: { generated_at: '2026-11-07T12:00:00Z', scope: 'method', total: 240, returned: 181, truncated: true },
  };
}

/* ---------- LORE: полная выдача, много групп ---------- */

const LORE_COMPONENTS = ['FORSETI', 'OMILORE', 'BRAGI', 'QG', 'KC'] as const;

/**
 * 260 записей, выдача полная. Задач «готово» больше 50 (бюджет группы), а
 * спринтов 24 — больше 20 групп (правило «топ-10 + Прочие», S9).
 */
export function loreData(): KitData {
  const r = rng(4400);
  const sprints = Array.from({ length: 24 }, (_, i) => `SPRINT_DEMO_${String(i + 1).padStart(2, '0')}`);
  const records: KitRecord[] = [];
  for (let i = 1; i <= 240; i++) {
    const sprint = sprints[Math.min(sprints.length - 1, Math.floor(Math.pow(r(), 2) * sprints.length))];
    records.push({
      id: `${sprint}/T-${i}`,
      kind: 'task',
      title: `Задача ${i}: ${pick(r, ['список', 'карточка', 'поиск', 'граф', 'журнал'])}`,
      status: pick(r, ['done', 'done', 'done', 'active', 'backlog', 'planned', 'blocked', 'cancelled'] as const),
      fields: { sprint, component: pick(r, LORE_COMPONENTS), effort: Math.floor(r() * 5) + 1 },
      updated_at: iso(Math.floor(r() * 90)),
    });
  }
  for (let i = 1; i <= 20; i++) {
    records.push({
      id: `ADR-DEMO-${String(i).padStart(3, '0')}`,
      kind: 'adr',
      title: `ADR ${i}`,
      status: pick(r, ['planned', 'done', 'cancelled'] as const),
      fields: { component: pick(r, LORE_COMPONENTS) },
      updated_at: iso(Math.floor(r() * 200)),
    });
  }
  return {
    records,
    edges: [],
    journal: [],
    meta: { generated_at: '2026-11-07T12:00:00Z', scope: 'NooriUta/UnlimitedLORE', total: records.length, returned: records.length, truncated: false },
  };
}
