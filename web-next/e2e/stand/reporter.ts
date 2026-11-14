// Сводка смоука стенда (E2E-STAND): summary.json + summary.md в e2e/.stand-report.
// Счёт pass / fail / not-run, бандл и /lore/version стенда, скрин на сценарий.
//
// Код выхода: красный при упавшем сценарии и при отказе по адресу прода. «Не выполнен»
// по умолчанию код не роняет (локально без входа это нормальный исход), но сводка
// говорит «НЕ ВЫПОЛНЕН», а не «зелёный». В CI после выкатки ставится
// LORE_STAND_REQUIRE_RUN=1 — тогда и not-run роняет шаг: смоук, который ничего не
// проверил, не должен выглядеть пройденным.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { preflightFromEnv, readBuild, REPORT_DIR } from './paths.ts';
import { buildSummary, outcomeOf, renderMarkdown, type ScenarioResult, type StandVersion } from '../../src/standSmoke/summary.ts';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const firstLine = (s: string | undefined) => (s ? stripAnsi(s).split('\n').map(l => l.trim()).find(Boolean) : undefined);

export default class StandReporter implements Reporter {
  private startedAt = new Date().toISOString();
  private results: ScenarioResult[] = [];
  private version: StandVersion | null = null;

  onBegin(): void {
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const [id, ...rest] = test.title.split(' ');
    const outcome = outcomeOf(result.status);
    const skip = test.annotations.find(a => a.type === 'skip')?.description;
    const shot = result.attachments.find(a => a.name === 'screenshot' && a.path);
    const ver = result.attachments.find(a => a.name === 'stand-version' && a.body);
    if (ver?.body) {
      try { this.version = JSON.parse(ver.body.toString('utf8')) as StandVersion; } catch { /* версия не разобралась — останется «не получена» */ }
    }
    this.results.push({
      id, title: rest.join(' '), outcome,
      reason: outcome === 'not-run' ? skip ?? 'пропущен без причины' : outcome === 'fail' ? firstLine(result.error?.message) : undefined,
      // Playwright копирует вложение под хэш-именем; в отчёте — свой файл сценария (shot() → <код>.png).
      screenshot: shot ? `${id}.png` : undefined,
      durationMs: result.duration,
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    const build = readBuild();
    const pre = preflightFromEnv();
    const preflightReason = pre.reason ?? (build?.refused ? build.error : null);
    const summary = buildSummary({
      standUrl: build?.standUrl ?? process.env.LORE_STAND_URL ?? null,
      bundle: build?.bundle ?? null,
      version: this.version,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      results: this.results,
      preflightReason,
    });
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(resolve(REPORT_DIR, 'summary.json'), JSON.stringify({ ...summary, build }, null, 2));
    writeFileSync(resolve(REPORT_DIR, 'summary.md'), renderMarkdown(summary));
    const c = summary.counts;
    console.log(`\n[stand-smoke] ${summary.verdict.toUpperCase()}: pass ${c.pass} · fail ${c.fail} · not-run ${c.notRun}; бандл ${summary.bundle ?? 'не получен'}`);
    if (summary.reason) console.log(`[stand-smoke] причина: ${summary.reason}`);
    console.log(`[stand-smoke] отчёт: ${resolve(REPORT_DIR, 'summary.md')}`);
    const refused = pre.refused || build?.refused === true;
    const requireRun = process.env.LORE_STAND_REQUIRE_RUN === '1';
    if (summary.verdict === 'red' || refused || (summary.verdict === 'not-run' && requireRun)) return { status: 'failed' };
    return { status: result.status };
  }

  printsToStdio(): boolean {
    return false;
  }
}
