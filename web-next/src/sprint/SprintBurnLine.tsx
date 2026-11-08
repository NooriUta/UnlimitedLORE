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
import { useCallback } from 'react';
import { burnSummary, LoadError, useSprintBurn, type BurnSliceLoader } from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';

export interface SprintBurnLineProps {
  sprintId: string;
  /** Загрузчик среза; по умолчанию — обычный путь в LORE. Нужен тестам. */
  load?: BurnSliceLoader;
}

export function SprintBurnLine({ sprintId, load }: SprintBurnLineProps) {
  const t = useAppT();
  const fetcher = sliceFetcher();
  const loader = useCallback<BurnSliceLoader>(
    (slice, signal) => (load ? load(slice, signal) : fetcher(slice, {}, signal)),
    // fetcher пересоздаётся каждый рендер, но ходит одним и тем же путём:
    // в зависимости берём только то, что действительно меняет загрузку.
    [load], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const burn = useSprintBurn(sprintId, loader);

  if (burn.state === 'loading') return <p className="sprint-burn sprint-burn--loading">{t('sprintBurn.loading')}</p>;

  // Сбой и «нет прав» — не «истории нет»: это разные ответы, и путать их нельзя.
  if (burn.state === 'error' || burn.state === 'forbidden') {
    return <LoadError compact error={burn.error} onRetry={burn.onRetry} title={t('sprintBurn.failed')} />;
  }

  if (burn.state === 'empty') {
    return <p className="sprint-burn sprint-burn--empty" data-testid="sprint-burn-empty">{t('sprintBurn.empty')}</p>;
  }

  const sum = burnSummary(burn.points ?? []);
  if (!sum) return <p className="sprint-burn sprint-burn--empty" data-testid="sprint-burn-empty">{t('sprintBurn.empty')}</p>;

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
      </p>
    </div>
  );
}
