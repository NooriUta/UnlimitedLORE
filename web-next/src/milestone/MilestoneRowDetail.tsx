// Раскрытие строки вехи в разделе «Вехи» (▸ у строки). PU-27 — сгорание вехи по задачам её спринтов;
// K4-CHARTS (владелица 19.11.2026: «можно и на дорожную карту») — под ним графики спринтов вехи
// (Velocity и Burnup, как фильтр «Веха» в v1), тем же блоком, что в паспорте вехи.
import { useNarrow } from '@seidr/kit';
import { MilestoneBurnLine } from './MilestoneBurnLine';
import { MilestoneSprintCharts } from './MilestoneSprintCharts';

export function MilestoneRowDetail({ milestoneId }: { milestoneId: string }) {
  return (
    <div className="ms-row">
      <MilestoneBurnLine milestoneId={milestoneId} />
      <MilestoneSprintCharts milestoneId={milestoneId} />
    </div>
  );
}

/**
 * Графики вехи в паспорте: на компьютере (боковая панель при выборе вехи) — раскрыты; на телефоне — под вехой,
 * раскрытием по кнопке «Графики вехи» (владелица 19.11.2026), чтобы паспорт не начинался с двух графиков.
 */
export function MilestonePassportCharts({ milestoneId, fetchImpl }: { milestoneId: string; fetchImpl?: typeof fetch }) {
  const narrow = useNarrow();
  return <MilestoneSprintCharts milestoneId={milestoneId} fetchImpl={fetchImpl} fold={narrow} />;
}
