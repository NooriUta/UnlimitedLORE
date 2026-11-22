// Логика отчёта стенд-смоука (SPRINT_UXR_S11_TEST_OPT/E2E-STAND). Без зависимостей
// от Playwright и Node: её проверяет vitest (src/standSmoke.test.ts), а пользуются
// конфиг, global-setup, спеки и репортёр.
//
// Главное правило: «не выполнен» — отдельный итог, НЕ зелёный. Смоук без входа,
// без адреса или с протухшим входом ничего не проверил, и сводка обязана сказать
// это прямо, а не показать «0 упавших».

export type Outcome = 'pass' | 'fail' | 'not-run' | 'n/a';
export type Verdict = 'green' | 'red' | 'not-run';

export interface ScenarioResult {
  id: string;
  title: string;
  outcome: Outcome;
  /** Почему не выполнен / не применим / чем упал — первая строка ошибки или причина skip. */
  reason?: string;
  /** Имя файла скрина в папке отчёта. */
  screenshot?: string;
  durationMs?: number;
}

export interface StandVersion {
  release: string | null;
  commit: string;
}

export interface Summary {
  standUrl: string | null;
  /** Бандл фронта на стенде (assets/index-*.js); null — не получен. */
  bundle: string | null;
  /** /lore/version стенда; null — не получен. */
  version: StandVersion | null;
  startedAt: string;
  finishedAt: string;
  counts: { pass: number; fail: number; notRun: number; na: number; total: number };
  verdict: Verdict;
  /** Общая причина not-run (предполётная проверка), если была. */
  reason: string | null;
  results: ScenarioResult[];
}

/** Причина not-run без сохранённого входа — дословно ищется в отчётах и логах CI. */
export const NO_LOGIN = 'нет сохранённого входа — смоук не выполнен';

/**
 * 1.18.3 · Приставка причины для сценария, который в ЭТОЙ среде выполнить нельзя по устройству, а не
 * из-за входа, прав или данных: мастер переноса живёт только в установщике, и на стенде его нет.
 * Такой сценарий — отдельный итог «не применимо» (с причиной), а не «не выполнено»: иначе кейс висит
 * как непроверенный и при LORE_STAND_REQUIRE_RUN=1 роняет шаг при исправном коде. Проверку при этом
 * не выбрасывают — она переезжает туда, где среда есть (прогон установщика).
 */
export const NOT_APPLICABLE = 'не применимо';

/** Итог пропущенного сценария: «не применимо …» — n/a, всё остальное — not-run (не зелёный). */
export function outcomeOfSkip(reason: string | undefined): Outcome {
  return reason?.trim().toLowerCase().startsWith(NOT_APPLICABLE) ? 'n/a' : 'not-run';
}

/**
 * Адреса прода — смоук по ним запрещён. :4400 на ci-server — пересыльщик прод-фронта
 * (lore4400-forward, см. docker-compose.preprod.yml), он редиректит на lore.odal.
 * Непарсящийся адрес тоже запрещён: не гадаем, куда он ведёт.
 */
export function isForbiddenStandUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  const host = u.hostname.toLowerCase();
  if (host === 'lore.odal.seidrstudio.pro' || host === 'new.lore.odal.seidrstudio.pro') return true;
  if (host === '192.168.3.143') return true;
  if (host === '192.168.3.131' && u.port === '4400') return true;
  return false;
}

export interface Preflight {
  run: boolean;
  /** true — отказ по адресу прода (не просто «нечего запускать»). */
  refused: boolean;
  reason: string | null;
}

export function standPreflight(opts: { standUrl: string | undefined; storageState: string | undefined; exists: (p: string) => boolean }): Preflight {
  const url = opts.standUrl?.trim();
  if (!url) return { run: false, refused: false, reason: 'LORE_STAND_URL не задан — смоук не выполнен' };
  if (isForbiddenStandUrl(url)) return { run: false, refused: true, reason: `адрес ${url} ведёт на прод — смоук на проде запрещён` };
  const state = opts.storageState?.trim();
  if (!state) return { run: false, refused: false, reason: `${NO_LOGIN} (LORE_STAND_STORAGE_STATE не задан)` };
  if (!opts.exists(state)) return { run: false, refused: false, reason: `${NO_LOGIN} (файла ${state} нет)` };
  return { run: true, refused: false, reason: null };
}

/** Бандл фронта из отданного HTML: `index-XXXX.js`, иначе null. */
export function extractBundle(html: string): string | null {
  const m = /assets\/(index-[\w-]+\.js)/.exec(html);
  return m ? m[1] : null;
}

export function outcomeOf(status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted', skipReason?: string): Outcome {
  if (status === 'passed') return 'pass';
  if (status === 'skipped') return outcomeOfSkip(skipReason);
  return 'fail';
}

export function buildSummary(input: {
  standUrl: string | null;
  bundle: string | null;
  version: StandVersion | null;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  preflightReason?: string | null;
}): Summary {
  const { results } = input;
  const counts = {
    pass: results.filter(r => r.outcome === 'pass').length,
    fail: results.filter(r => r.outcome === 'fail').length,
    notRun: results.filter(r => r.outcome === 'not-run').length,
    na: results.filter(r => r.outcome === 'n/a').length,
    total: results.length,
  };
  // Зелёный — только когда что-то ПРОВЕРЕНО и всё проверенное прошло: ни падений, ни «не выполнено»,
  // и хотя бы один pass. Прогон из одних «не применимо» (и пустой) — not-run, а не «0 упавших = зелёный».
  const verdict: Verdict = counts.fail > 0 ? 'red'
    : counts.notRun > 0 || counts.pass === 0 ? 'not-run'
      : 'green';
  return {
    standUrl: input.standUrl, bundle: input.bundle, version: input.version,
    startedAt: input.startedAt, finishedAt: input.finishedAt,
    counts, verdict, reason: input.preflightReason ?? null, results,
  };
}

const VERDICT_TEXT: Record<Verdict, string> = {
  green: 'зелёный — все сценарии прошли',
  red: 'красный — есть упавшие сценарии',
  'not-run': 'НЕ ВЫПОЛНЕН — проверено не всё, это не зелёный',
};
const MARK: Record<Outcome, string> = { pass: 'pass', fail: 'FAIL', 'not-run': 'not-run', 'n/a': NOT_APPLICABLE };

/** Отчёт выкатки: заголовки + буллеты, без таблиц (уходит в Telegram-разметку). */
export function renderMarkdown(s: Summary): string {
  const v = s.version ? `${s.version.release ?? 'без тега'} · ${s.version.commit || 'коммит неизвестен'}` : 'не получена';
  const lines = [
    '# Смоук v2 на стенде',
    '',
    `- Вердикт: ${VERDICT_TEXT[s.verdict]}`,
    `- Счёт: pass ${s.counts.pass} · fail ${s.counts.fail} · not-run ${s.counts.notRun} · ${NOT_APPLICABLE} ${s.counts.na} (из ${s.counts.total})`,
    `- Стенд: ${s.standUrl ?? 'не задан'}`,
    `- бандл: ${s.bundle ?? 'не получен'}`,
    `- /lore/version: ${v}`,
    `- Время: ${s.startedAt} → ${s.finishedAt}`,
  ];
  if (s.reason) lines.push(`- Причина: ${s.reason}`);
  lines.push('', '## Сценарии', '');
  if (s.results.length === 0) lines.push('- ни один сценарий не выполнялся');
  for (const r of s.results) {
    const extra = [r.reason, r.screenshot ? `скрин ${r.screenshot}` : null].filter(Boolean).join(' · ');
    lines.push(`- ${MARK[r.outcome]} — ${r.id} ${r.title}${extra ? ` — ${extra}` : ''}`);
  }
  return lines.join('\n') + '\n';
}
