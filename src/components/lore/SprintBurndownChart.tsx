// Burn-down спринта в паспорте: остаток задач по дням (закрыто − заведено).
// Вопрос владельца: «сгораем по работам или нет» — ответ одной линией.
// Честные состояния: ошибка загрузки ≠ «нет данных».
// По умолчанию — одна строка со спарклайном (владелец: «это очень внезапно» —
// во всю ширину график вырастал до ~400px и выталкивал задачи). Высота
// фиксирована (BURN_H), SVG тянется только по ширине: preserveAspectRatio=none
// + vectorEffect, чтобы линии не толстели при растяжении.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import { BURN_H, sprintBurndown, type BurnPoint, type BurnRow } from './sprintBurndown';

const W = 600;

export default function SprintBurndownChart({ sprintId }: { sprintId: string }) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<BurnPoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

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
  if (failed) return <div style={S.box}><div style={S.title}>{label}<span style={S.err}>{t('lore.sprintDetail.burndown.failed', 'не смогли загрузить историю задач')}</span></div></div>;
  if (points === null) return null;
  if (points.length < 2) return <div style={S.box}><div style={S.title}>{label}<span style={S.dim}>{t('lore.sprintDetail.burndown.tooFew', 'мало точек для графика')}</span></div></div>;

  const H = open ? BURN_H.expanded : BURN_H.collapsed;
  const ms = points.map(p => Date.parse(p.date));
  const min = ms[0], range = (ms[ms.length - 1] - min) || 1;
  const maxY = Math.max(...points.map(p => p.scope), 1);
  const pad = 3;
  const x = (i: number) => ((ms[i] - min) / range) * W;
  const y = (v: number) => pad + (H - 2 * pad) * (1 - v / maxY);
  const line = (k: 'remaining' | 'scope') => points.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const peak = Math.max(...points.map(p => p.remaining));
  const nss = { vectorEffect: 'non-scaling-stroke' as const };

  const chart = (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', flex: open ? undefined : 1, minWidth: 0 }} role="img"
      aria-label={`${label}: ${last.remaining} / ${last.scope}`}>
      <polyline points={line('scope')} fill="none" stroke="var(--t3)" strokeWidth="1" strokeDasharray="4 3" style={nss} />
      {open && <line x1={0} y1={y(points[0].remaining)} x2={W} y2={y(0)} stroke="var(--bd)" strokeWidth="1" style={nss} />}
      <polyline points={line('remaining')} fill="none" stroke="var(--acc)" strokeWidth="1.6" strokeLinejoin="round" style={nss} />
    </svg>
  );

  return (
    <div style={S.box}>
      <div style={{ ...S.title, cursor: 'pointer' }} onClick={() => setOpen(o => !o)} role="button" tabIndex={0}
        aria-expanded={open}
        title={`${t('lore.sprintDetail.burndown.hint', 'Остаток = заведено − закрыто по дням; пунктир — объём. Линия вниз — сгораем.')} ${open ? t('lore.sprintDetail.burndown.collapse', 'Свернуть') : t('lore.sprintDetail.burndown.expand', 'Развернуть график')}`}>
        <span style={S.caret}>{open ? '▾' : '▸'}</span>
        {label}
        <span style={{ color: 'var(--acc)' }}>{t('lore.sprintDetail.burndown.remaining', 'остаток')} <b>{last.remaining}</b></span>
        <span style={{ color: 'var(--suc)' }}>{t('lore.sprintDetail.burndown.done', 'закрыто')} <b>{last.done}</b></span>
        <span style={S.dim}>{t('lore.sprintDetail.burndown.scope', 'объём')} {last.scope} · {t('lore.sprintDetail.burndown.peak', 'пик')} {peak}</span>
        {!open && chart}
      </div>
      {open && <>{chart}<div style={S.axis}><span>{points[0].date}</span><span>{last.date}</span></div></>}
    </div>
  );
}

const S = {
  box:   { padding: '6px 16px 2px' },
  title: { display: 'flex', gap: 10, alignItems: 'center', fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)',
           textTransform: 'uppercase' as const, color: 'var(--t2)', marginBottom: 2 },
  caret: { color: 'var(--t3)', width: 10 },
  dim:   { color: 'var(--t3)', fontSize: 'var(--fs-xs)', textTransform: 'none' as const, whiteSpace: 'nowrap' as const },
  err:   { color: 'var(--dng)', fontSize: 'var(--fs-xs)', textTransform: 'none' as const },
  axis:  { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--t3)' },
} as const;
