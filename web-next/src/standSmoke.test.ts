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
    expect(s.counts).toEqual({ pass: 2, fail: 0, notRun: 0, na: 0, total: 2 });
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

// 1.18.3 · «не применимо» — отдельный итог, не «не выполнено». Смоук стенда краснел на кейсах, которые
// на стенде выполнить НЕЛЬЗЯ по устройству: MA7 проверяет мастер переноса, а мастер живёт только в
// установщике (адрес LORE_MIGRATE_UI_URL владелица заводить не стала). Такой кейс пропускался как
// not-run, а not-run при LORE_STAND_REQUIRE_RUN=1 роняет шаг — красный прогон при исправном коде.
// Правило: «не применимо в этой среде» (с причиной) считается отдельно и вердикт не портит; «не
// выполнен» (вход, права, данные) — как прежде, не зелёный.
describe('n/a: сценарий, не применимый в этой среде, — не «не выполнен»', () => {
  const caseOf = (src: string, id: string) => {
    const i = src.indexOf(`test('${id} `);
    if (i < 0) return '';
    const j = src.indexOf('\ntest(', i + 1);
    return src.slice(i, j < 0 ? undefined : j);
  };

  it('skip с причиной «не применимо …» — n/a; любой другой пропуск — not-run', () => {
    expect(outcomeOf('skipped', 'не применимо на стенде: мастер переноса живёт только в установщике')).toBe('n/a');
    expect(outcomeOf('skipped', 'вход истёк')).toBe('not-run');
    expect(outcomeOf('skipped')).toBe('not-run');
    expect(outcomeOf('passed', 'не применимо')).toBe('pass');
  });

  it('pass + n/a — зелёный; «не применимо» в счёте отдельно, not-run нет', () => {
    const s = buildSummary({ ...base, results: [res('S1', 'pass'), res('MA7', 'n/a', 'не применимо на стенде: мастер в установщике')] });
    expect(s.counts).toEqual({ pass: 1, fail: 0, notRun: 0, na: 1, total: 2 });
    expect(s.verdict).toBe('green');
  });

  it('все сценарии «не применимо» — НЕ зелёный: проверено ничего', () => {
    expect(buildSummary({ ...base, results: [res('MA7', 'n/a', 'не применимо на стенде')] }).verdict).toBe('not-run');
  });

  it('n/a не прячет падения', () => {
    expect(buildSummary({ ...base, results: [res('S1', 'fail'), res('MA7', 'n/a', 'не применимо')] }).verdict).toBe('red');
  });

  it('в отчёте «не применимо» — словами и с причиной', () => {
    const md = renderMarkdown(buildSummary({
      ...base,
      results: [res('S1', 'pass'), { id: 'MA7', title: 'Мастер, шаг «З»', outcome: 'n/a', reason: 'не применимо на стенде: мастер только в установщике' }],
    }));
    expect(md).toContain('не применимо 1');
    expect(md).toContain('не применимо — MA7');
    expect(md).toContain('мастер только в установщике');
  });

  it('репортёр отдаёт причину пропуска в outcomeOf и сохраняет её для n/a', () => {
    const r = read('e2e/stand/reporter.ts');
    expect(r).toMatch(/outcomeOf\(result\.status, skip\)/);
    expect(r).toMatch(/'n\/a'/);
  });

  it('MA7: причина — «не применимо» на стенде, и сказано, где проверка живёт теперь', () => {
    const ma7 = caseOf(read('e2e/stand/migration-admin.stand.ts'), 'MA7');
    expect(ma7, 'кейс MA7 на месте (не удалён)').not.toBe('');
    expect(ma7).toMatch(/не применимо/);
    expect(ma7).toMatch(/orphan-sprints\.test\.mjs/);
  });

  it('MA3: «прогона переноса не было» — проверяемое состояние экрана, а не пропуск кейса', () => {
    const ma3 = caseOf(read('e2e/stand/migration-admin.stand.ts'), 'MA3');
    expect(ma3, 'кейс MA3 на месте').not.toBe('');
    expect(ma3, 'no_run больше не пропуск').not.toMatch(/test\.skip\([^;]*no_run/);
    expect(ma3, 'проверяется честный экран «прогона ещё не было»').toMatch(/adm-mig-norun/);
  });

  it('проверка шага «З» переехала в прогон установщика (node --test scripts/model-migration)', () => {
    const wiz = read('../scripts/model-migration/orphan-sprints.test.mjs');
    expect(wiz).toMatch(/api\/orphan-sprints/);
    expect(wiz).toMatch(/os-state/);
    expect(read('../.github/workflows/lore-installer-publish.yml')).toMatch(/node --test scripts\/model-migration\/\*\.test\.mjs/);
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
