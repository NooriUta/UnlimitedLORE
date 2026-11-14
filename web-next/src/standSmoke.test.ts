// SPRINT_UXR_S11_TEST_OPT/E2E-STAND: смоук v2 на стенде после выкатки в preprod.
// Сами сценарии бегут в браузере против живого стенда (e2e/stand/, свой конфиг) и
// здесь не исполняются. Здесь — логика, от которой зависит честность отчёта:
//   • «не выполнен» никогда не превращается в зелёный;
//   • без сохранённого входа и без адреса стенда — явный not-run с причиной;
//   • прод не смоукается ни по прямому адресу, ни по редиректу;
//   • хэш бандла достаётся из отданного HTML.
// Плюс гварды: стенд-спеки не попадают в обычные прогоны e2e и vitest.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSummary, extractBundle, isForbiddenStandUrl, outcomeOf, renderMarkdown, standPreflight, type ScenarioResult,
} from './standSmoke/summary.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webNext = resolve(here, '..');
const read = (p: string) => readFileSync(resolve(webNext, p), 'utf8');

const PRE = 'https://preprod.new.lore.odal.seidrstudio.pro';
const res = (id: string, outcome: ScenarioResult['outcome'], reason?: string): ScenarioResult =>
  ({ id, title: `сценарий ${id}`, outcome, reason });
const base = { standUrl: PRE, bundle: 'index-DCihLPT3.js', version: null, startedAt: '2026-11-14T10:00:00Z', finishedAt: '2026-11-14T10:01:00Z' };

describe('standPreflight: запускать ли смоук вообще', () => {
  it('нет сохранённого входа — not-run с причиной «нет сохранённого входа — смоук не выполнен»', () => {
    const p = standPreflight({ standUrl: PRE, storageState: undefined, exists: () => true });
    expect(p.run).toBe(false);
    expect(p.reason).toContain('нет сохранённого входа — смоук не выполнен');
  });

  it('путь к входу задан, но файла нет — тоже not-run, и путь назван', () => {
    const p = standPreflight({ standUrl: PRE, storageState: 'C:/x/stand-auth.json', exists: () => false });
    expect(p.run).toBe(false);
    expect(p.reason).toContain('нет сохранённого входа — смоук не выполнен');
    expect(p.reason).toContain('C:/x/stand-auth.json');
  });

  it('нет адреса стенда — not-run', () => {
    const p = standPreflight({ standUrl: undefined, storageState: 'a.json', exists: () => true });
    expect(p.run).toBe(false);
    expect(p.reason).toMatch(/LORE_STAND_URL/);
  });

  it('адрес прода — отказ, даже при сохранённом входе', () => {
    const p = standPreflight({ standUrl: 'https://lore.odal.seidrstudio.pro', storageState: 'a.json', exists: () => true });
    expect(p.run).toBe(false);
    expect(p.refused).toBe(true);
    expect(p.reason).toMatch(/прод/);
  });

  it('препрод и вход на месте — запускаем', () => {
    expect(standPreflight({ standUrl: PRE, storageState: 'a.json', exists: () => true })).toMatchObject({ run: true, refused: false });
  });
});

describe('isForbiddenStandUrl: прод не смоукаем', () => {
  it.each([
    'https://lore.odal.seidrstudio.pro/',
    'https://new.lore.odal.seidrstudio.pro/news',
    'http://192.168.3.143:4400/',
    // :4400 на ci-server — пересыльщик прод-MCP/прод-фронта (lore4400-forward), не препрод.
    'http://192.168.3.131:4400',
  ])('%s — прод', url => expect(isForbiddenStandUrl(url)).toBe(true));

  it.each([
    PRE, 'https://preprod.lore.odal.seidrstudio.pro', 'http://192.168.3.131:4412/', 'http://127.0.0.1:4401',
  ])('%s — можно', url => expect(isForbiddenStandUrl(url)).toBe(false));

  it('мусор вместо адреса — запрещено (не гадаем)', () => expect(isForbiddenStandUrl('не адрес')).toBe(true));
});

describe('extractBundle: какая сборка на стенде', () => {
  it('берёт assets/index-*.js из отданного HTML', () => {
    const html = '<script type="module" crossorigin src="/assets/index-DCihLPT3.js"></script><link href="/assets/index-Ab12.css">';
    expect(extractBundle(html)).toBe('index-DCihLPT3.js');
  });
  it('нет бандла — null, а не пустая строка', () => expect(extractBundle('<html>301 Moved</html>')).toBeNull());
});

describe('outcomeOf: статус Playwright → итог сценария', () => {
  it.each([
    ['passed', 'pass'], ['failed', 'fail'], ['timedOut', 'fail'], ['interrupted', 'fail'], ['skipped', 'not-run'],
  ] as const)('%s → %s', (s, o) => expect(outcomeOf(s)).toBe(o));
});

describe('buildSummary: счёт и вердикт', () => {
  it('все прошли — green', () => {
    const s = buildSummary({ ...base, results: [res('S1', 'pass'), res('S2', 'pass')] });
    expect(s.counts).toEqual({ pass: 2, fail: 0, notRun: 0, total: 2 });
    expect(s.verdict).toBe('green');
  });

  it('хоть один упал — red, даже если остальные не выполнены', () => {
    expect(buildSummary({ ...base, results: [res('S1', 'fail'), res('S2', 'not-run')] }).verdict).toBe('red');
  });

  it('хоть один не выполнен и падений нет — not-run, НЕ green', () => {
    const s = buildSummary({ ...base, results: [res('S1', 'pass'), res('S2', 'not-run', 'вход истёк')] });
    expect(s.verdict).toBe('not-run');
    expect(s.counts.notRun).toBe(1);
  });

  it('ни одного сценария — not-run, а не «0 упавших = зелёный»', () => {
    const s = buildSummary({ ...base, results: [], preflightReason: 'нет сохранённого входа — смоук не выполнен' });
    expect(s.verdict).toBe('not-run');
    expect(s.reason).toContain('нет сохранённого входа');
  });

  it('бандл и версия едут в сводку как есть', () => {
    const s = buildSummary({ ...base, version: { release: null, commit: '0e2c6314' }, results: [res('S1', 'pass')] });
    expect(s.bundle).toBe('index-DCihLPT3.js');
    expect(s.version).toEqual({ release: null, commit: '0e2c6314' });
  });
});

describe('renderMarkdown: отчёт выкатки', () => {
  it('вердикт, счёт, бандл, причина not-run и строка на сценарий со скрином', () => {
    const s = buildSummary({
      ...base,
      results: [
        { id: 'S1', title: 'Спринты: раскрыть строку', outcome: 'pass', screenshot: 'S1-sprints.png' },
        { id: 'S4', title: 'Админка «Агенты»', outcome: 'not-run', reason: 'нет прав админа' },
      ],
    });
    const md = renderMarkdown(s);
    expect(md).toMatch(/не выполнен/i);
    expect(md).toContain('pass 1');
    expect(md).toContain('not-run 1');
    expect(md).toContain('index-DCihLPT3.js');
    expect(md).toContain('нет прав админа');
    expect(md).toContain('S1-sprints.png');
    expect(md).not.toMatch(/\|/); // без таблиц: отчёт идёт в Telegram-разметку
  });

  it('бандл не достали — так и написано, а не пусто', () => {
    expect(renderMarkdown(buildSummary({ ...base, bundle: null, results: [] }))).toMatch(/бандл: не получен/);
  });
});

describe('гварды: стенд-смоук не попадает в обычные прогоны', () => {
  it('обычный playwright.config игнорирует e2e/stand', () => {
    expect(read('playwright.config.ts')).toMatch(/testIgnore:\s*\[?\s*['"]\*\*\/stand\/\*\*['"]/);
  });
  it('vitest берёт тесты только из src/**', () => {
    expect(read('vite.config.ts')).toMatch(/include:\s*\['src\/\*\*/);
  });
  it('свой конфиг стенда и npm-скрипт e2e:stand', () => {
    expect(read('playwright.stand.config.ts')).toMatch(/testDir:\s*['"]e2e\/stand['"]/);
    expect(JSON.parse(read('package.json')).scripts['e2e:stand']).toMatch(/playwright test -c playwright\.stand\.config\.ts/);
  });
});
