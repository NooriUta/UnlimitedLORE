// Burn-down спринта в паспорте: остаток задач по дням (закрыто − заведено).
// Вопрос владельца: «сгораем по работам или нет» — ответ одной линией.
// Честные состояния: ошибка загрузки ≠ «нет данных».
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import { sprintBurndown, type BurnPoint, type BurnRow } from './sprintBurndown';

export default function SprintBurndownChart({ sprintId }: { sprintId: string }) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<BurnPoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setPoints(null); setFailed(false);
    Promise.all([
      fetchLoreSlice<BurnRow>('task_created_dates', undefined, ctrl.signal),
      fetchLoreSlice<BurnRow>('task_done_dates', undefined, ctrl.signal),
    ])
      .then(([created, done]) => setPoints(sprintBurndown(created, done, sprintId)))
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true); });
    return () => ctrl.abort();
  }, [sprintId]);

  const label = t('lore.sprintDetail.burndown.label', 'Burn-down');
  if (failed) return <div style={S.box}><div style={S.title}>{label}</div><div style={S.err}>{t('lore.sprintDetail.burndown.failed', 'не смогли загрузить историю задач')}</div></div>;
  if (points === null) return null;
  if (points.length < 2) return <div style={S.box}><div style={S.title}>{label}</div><div style={S.dim}>{t('lore.sprintDetail.burndown.tooFew', 'мало точек для графика')}</div></div>;

  const W = 600, H = 110;
  const ms = points.map(p => Date.parse(p.date));
  const min = ms[0], range = (ms[ms.length - 1] - min) || 1;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  const x = (i: number) => ((ms[i] - min) / range) * W;
  const y = (v: number) => H - (v / maxY) * H;
  const line = (k: 'remaining' | 'scope') => points.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const peak = Math.max(...points.map(p => p.remaining));

  return (
    <div style={S.box}>
      <div style={S.title} title={t('lore.sprintDetail.burndown.hint', 'Остаток = заведено − закрыто по дням; пунктир — объём. Линия вниз — сгораем.')}>
        {label}
        <span style={{ color: 'var(--acc)' }}>{t('lore.sprintDetail.burndown.remaining', 'остаток')} <b>{last.remaining}</b></span>
        <span style={{ color: 'var(--suc)' }}>{t('lore.sprintDetail.burndown.done', 'закрыто')} <b>{last.done}</b></span>
        <span style={S.dim}>{t('lore.sprintDetail.burndown.scope', 'объём')} {last.scope} · {t('lore.sprintDetail.burndown.peak', 'пик')} {peak}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} style={{ display: 'block' }} role="img"
        aria-label={`${label}: ${last.remaining} / ${last.scope}`}>
        <polyline points={line('scope')} fill="none" stroke="var(--t3)" strokeWidth="1" strokeDasharray="4 3" />
        {/* идеал: от пика остатка к нулю к последнему дню */}
        <line x1={0} y1={y(points[0].remaining)} x2={W} y2={y(0)} stroke="var(--bd)" strokeWidth="1" />
        <polyline points={line('remaining')} fill="none" stroke="var(--acc)" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(last.remaining)} r={3} fill="var(--acc)" />
      </svg>
      <div style={S.axis}><span>{points[0].date}</span><span>{last.date}</span></div>
    </div>
  );
}

const S = {
  box:   { padding: '8px 16px 4px' },
  title: { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)',
           textTransform: 'uppercase' as const, color: 'var(--t2)', marginBottom: 4, flexWrap: 'wrap' as const },
  dim:   { color: 'var(--t3)', fontSize: 'var(--fs-xs)', textTransform: 'none' as const },
  err:   { color: 'var(--dng)', fontSize: 'var(--fs-xs)' },
  axis:  { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--t3)' },
} as const;
