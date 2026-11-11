// Граница kit ↔ приложение (SPRINT_UXR_S10_SEIDR_KIT/K-14, SPRINT_UXR_S7B_ADMIN/S7B-24).
// Решение D-2026-UXR-KIT-ABSTRACTIONS-APP-SCREENS: kit — абстракции, приложение —
// предметность LORE. Прежние сторожа стояли точечно (flow/*, configFromModel), а
// аудит 11.11 нашёл предметность ровно в непокрытых модулях (news, activity,
// tasks, charts, auth, record/history, iconCanon, markdown, i18n).
//
// Этот сторож — храповик по ВСЕМУ kit/src (кроме тестов и test/):
//  1. в файле появился предметный маркер LORE, которого нет в эталоне → красный
//     (новое не просачивается — ни в новый файл, ни в старый новым словом);
//  2. в эталоне числится маркер, которого в файле уже нет → красный (эталон
//     обязан сжиматься вместе с выносом, иначе он молча разрешает будущую утечку).
// Эталон (`k14Baseline.json`) — это известный долг с причиной у каждой строки,
// а не разрешение: его разбирает SPRINT_UXR_S7B_ADMIN/S7B-23.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import baseline from './k14Baseline.json';

/** Предметные маркеры LORE. Имя — то, что пишется в эталон. */
export const K14_MARKERS: Record<string, RegExp> = {
  'lore': /(?<![a-z])lore(?![a-z])/,          // маршруты /lore, схема ссылок lore:, протокол 'lore'
  'news/v2': /news\/v2/,
  'task/edit': /task\/edit/,
  'x-seer-role': /x-seer-role/,
  'seer': /seer/,                              // бренд приложения в ключах хранения и сообщениях
  'keycloak': /keycloak/,
  'kc_sub': /kc_sub/,
  'client_id': /client_id/,
  'sprint': /sprint|спринт/,
  'milestone': /milestone|(?<![а-яё])вех[аиуеоы]/,
  'агент': /агент/,
  'forgejo': /forgejo/,
  'ready_for_deploy': /ready_for_deploy/,
};

type Baseline = Record<string, { markers: string[]; why: string }>;
const BASE = (baseline as { files: Baseline }).files;

/** Код без комментариев: слово в пояснении — не утечка, утечка — в исполняемом коде и строках. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function markersIn(text: string): string[] {
  const low = text.toLowerCase();
  return Object.entries(K14_MARKERS).filter(([, re]) => re.test(low)).map(([k]) => k).sort();
}

function scan(root: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'test' || name === 'boundary') continue;
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx|json)$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith('.schema.json')) continue;
      const raw = readFileSync(p, 'utf8');
      const hits = markersIn(name.endsWith('.json') ? raw : stripComments(raw));
      if (hits.length) out[relative(root, p).split(sep).join('/')] = hits;
    }
  };
  walk(join(root, 'src'));
  return out;
}

// Путь от корня пакета: в jsdom-среде import.meta.url — http-адрес.
const KIT = process.cwd();

describe('K-14 · храповик предметности по всему kit/src', () => {
  const found = scan(KIT);

  it('нового предметного маркера LORE нет ни в одном файле kit', () => {
    const leaks: string[] = [];
    for (const [file, hits] of Object.entries(found)) {
      const allowed = new Set(BASE[file]?.markers ?? []);
      for (const m of hits) if (!allowed.has(m)) leaks.push(`${file}: «${m}»`);
    }
    expect(leaks, 'предметность LORE просочилась в kit — вынести в web-next или передать данными/props').toEqual([]);
  });

  it('эталон не числит того, чего уже нет (вынесли — сожми эталон)', () => {
    const stale: string[] = [];
    for (const [file, { markers }] of Object.entries(BASE)) {
      const have = new Set(found[file] ?? []);
      for (const m of markers) if (!have.has(m)) stale.push(`${file}: «${m}»`);
    }
    expect(stale).toEqual([]);
  });

  it('у каждой строки эталона названа причина', () => {
    const noWhy = Object.entries(BASE).filter(([, v]) => !v.why || v.why.trim().length < 10).map(([f]) => f);
    expect(noWhy).toEqual([]);
  });
});

describe('K-14 · S7B-27: лента новостей и «Активность» — экран приложения, не kit', () => {
  it('в kit нет модулей news/ и activity/', () => {
    expect(existsSync(join(KIT, 'src/news'))).toBe(false);
    expect(existsSync(join(KIT, 'src/activity'))).toBe(false);
  });

  it('пакет kit не объявляет точку входа ./activity и не реэкспортирует news', () => {
    const pkg = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')) as { exports: Record<string, string> };
    expect(Object.keys(pkg.exports)).not.toContain('./activity');
    const index = stripComments(readFileSync(join(KIT, 'src/index.ts'), 'utf8'));
    expect(index).not.toMatch(/from '\.\/news'/);
  });
});

describe('K-14 · сам сторож ловит то, что должен (положительный контроль)', () => {
  it('маршрут LORE, эндпоинт и предметные оси распознаются', () => {
    expect(markersIn("href: '/lore?section=sprints'")).toEqual(expect.arrayContaining(['lore', 'sprint']));
    expect(markersIn("fetch('/lore/news/v2')")).toEqual(expect.arrayContaining(['lore', 'news/v2']));
    expect(markersIn("{ 'X-Seer-Role': 'admin' }")).toEqual(expect.arrayContaining(['x-seer-role', 'seer']));
    expect(markersIn("label: 'Вехи'")).toEqual(['milestone']);
    expect(markersIn("t('Доля агентов')")).toEqual(['агент']);
  });

  it('общие слова не путаются с предметными', () => {
    expect(markersIn("const explore = 'colorless folklore'")).toEqual([]);
    expect(markersIn('const human = 1; // спринт в комментарии')).toEqual(['sprint']);
    expect(markersIn(stripComments('const human = 1;\n// спринт в комментарии'))).toEqual([]);
    expect(markersIn('свеха')).toEqual([]);
  });
});
