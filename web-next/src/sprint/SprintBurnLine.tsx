// Burn-down спринта строкой (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36).
//
// В v1 это одна строка цифр под контекстом спринта: «BURN-DOWN ОСТАТОК 6
// ЗАКРЫТО 6 объём 12 · пик 6» (эталон — скрин владелицы 08.11.2026). Ряд и
// сводку считает kit (burnSeries / burnSummary, S5-03), график там же и уже
// написан; здесь только подключение к срезам LORE и честные состояния.
//
// Почему строка, а не график: из прототипа v4 берутся функции и расположение,
// а эталон для паспорта спринта — v1, и там именно строка. График остаётся
// доступным отдельно и в эту задачу не входит.
//
// «Цель к сроку» (SPRINT_UXR_POLISH_UAT_1113/PU-10, K2-VIEW-TARGET, допущения А1–А4 владелицы 12.11):
// вердикт словами — прямо в строке, график со сгоранием, планом, прогнозом и вертикалью
// срока — по кнопке «Цель к сроку». Прогноз и вердикт считает приложение (targetForecast),
// kit рисует. Строка цифр S4-36 остаётся как была; шапку графика не дублируем (headless).
//
// PU-27: та же строка у ВЕХИ (MilestoneBurnLine). Вид строки — `BurnLineView`,
// один на оба типа; различаются только охват задач и слова состояний.
import { useCallback, useState } from 'react';
import { BurnChart, burnSummary, LoadError, useKitLang } from '@seidr/kit';
import { useSprintBurn, type BurnSliceLoader, type SprintBurn } from './useSprintBurn';
import { targetForecast } from '../record/targetForecast';
import { sliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';

export interface SprintBurnLineProps {
  sprintId: string;
  /** Загрузчик среза; по умолчанию — обычный путь в LORE. Нужен тестам. */
  load?: BurnSliceLoader;
  /** Срок спринта (planned_end). null — срока нет, сказать словами; не задан — вида нет. */
  deadline?: string | null;
  /** «Сегодня» для прогноза (ГГГГ-ММ-ДД); по умолчанию — текущая дата. Нужен тестам. */
  today?: string;
}

/** Слова состояний строки: у спринта и вехи они свои. */
export interface BurnLineText {
  loading: string;
  empty: string;
  failed: string;
  noDeadline: string;
}

export interface BurnLineViewProps {
  /** Ключ панели графика (id для aria-controls). */
  panelKey: string;
  burn: SprintBurn;
  /** Срок: строка — есть; null — нет, сказать словами; undefined — вида нет. */
  deadline?: string | null;
  today?: string;
  /** Замороженная (историческая) запись: график есть, прогноза и вердикта нет (PU-27). */
  frozen?: boolean;
  /** Слова «заморожено — прогноза нет»; нужны вместе с frozen. */
  frozenText?: string;
  text: BurnLineText;
}

export function BurnLineView({ panelKey, burn, deadline, today, frozen, frozenText, text }: BurnLineViewProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [open, setOpen] = useState(false);

  if (burn.state === 'loading') return <p className="sprint-burn sprint-burn--loading">{text.loading}</p>;

  // Сбой и «нет прав» — не «истории нет»: это разные ответы, и путать их нельзя.
  if (burn.state === 'error' || burn.state === 'forbidden') {
    return <LoadError compact error={burn.error} onRetry={burn.onRetry} title={text.failed} />;
  }

  if (burn.state === 'empty') {
    return <p className="sprint-burn sprint-burn--empty" data-testid="sprint-burn-empty">{text.empty}</p>;
  }

  const sum = burnSummary(burn.points ?? []);
  // Замороженная запись — без прогноза: срок прошёл по определению, вердикт «не успеваем» врал бы.
  const due = frozen ? undefined : deadline ? deadline.slice(0, 10) : deadline;
  const target = due ? targetForecast(burn.points ?? [], due, today ?? new Date().toISOString().slice(0, 10), lang) : null;
  const panelId = `sprint-burn-target-${panelKey}`;
  const hasTarget = due !== undefined || Boolean(frozen);
  if (!sum) return <p className="sprint-burn sprint-burn--empty" data-testid="sprint-burn-empty">{text.empty}</p>;

  return (
    <div className="sprint-burn">
      {/* Неполная выдача среза: график и цифры по обрезанной истории врут,
          поэтому пометка видимая, а не сноской. */}
      {burn.state === 'partial' && (
        <p className="sprint-burn__partial" data-testid="sprint-burn-partial">
          {t('sprintBurn.partial')}
        </p>
      )}
      <p className="sprint-burn__line" data-testid="sprint-burn">
        <span className="sprint-burn__name">{t('sprintBurn.title')}</span>
        <span className="sprint-burn__pair"><span className="sprint-burn__k">{t('sprintBurn.remaining')}</span> <b>{sum.remaining}</b></span>
        <span className="sprint-burn__pair"><span className="sprint-burn__k">{t('sprintBurn.done')}</span> <b>{sum.done}</b></span>
        <span className="sprint-burn__pair"><span className="sprint-burn__k">{t('sprintBurn.scope')}</span> <b>{sum.scope}</b></span>
        <span className="sprint-burn__pair"><span className="sprint-burn__k">{t('sprintBurn.peak')}</span> <b>{sum.peak}</b></span>
        {target && <span className="sprint-burn__verdict" data-testid="sprint-burn-verdict" data-tone={target.verdict.tone}>{target.verdict.text}</span>}
        {due === null && <span className="sprint-burn__nodue" data-testid="sprint-burn-no-deadline">{text.noDeadline}</span>}
        {frozen && <span className="sprint-burn__nodue" data-testid="milestone-burn-frozen">{frozenText}</span>}
        {hasTarget && (
          <button type="button" className="sprint-burn__toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(o => !o)}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t('sprintBurn.target')}
          </button>
        )}
      </p>
      {open && hasTarget && (
        <div id={panelId}>
          <BurnChart
            headless
            points={burn.points}
            state={burn.state}
            completeness={burn.completeness}
            onRetry={burn.onRetry}
            {...(due ? { deadline: due } : {})}
            forecast={target?.forecast}
            verdict={target?.verdict}
          />
        </div>
      )}
    </div>
  );
}

export function SprintBurnLine({ sprintId, load, deadline, today }: SprintBurnLineProps) {
  const t = useAppT();
  const fetcher = sliceFetcher();
  const loader = useCallback<BurnSliceLoader>(
    (slice, signal) => (load ? load(slice, signal) : fetcher(slice, {}, signal)),
    // fetcher пересоздаётся каждый рендер, но ходит одним и тем же путём:
    // в зависимости берём только то, что действительно меняет загрузку.
    [load], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const burn = useSprintBurn(sprintId, loader);
  return (
    <BurnLineView
      panelKey={sprintId}
      burn={burn}
      deadline={deadline}
      today={today}
      text={{
        loading: t('sprintBurn.loading'),
        empty: t('sprintBurn.empty'),
        failed: t('sprintBurn.failed'),
        noDeadline: t('sprintBurn.noDeadline'),
      }}
    />
  );
}
