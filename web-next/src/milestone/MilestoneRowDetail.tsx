// Раскрытие строки вехи в разделе «Вехи» (▸ у строки). PU-27 — сгорание вехи по задачам её спринтов;
// K4-CHARTS (владелица 19.11.2026: «можно и на дорожную карту») — под ним графики спринтов вехи
// (Velocity и Burnup, как фильтр «Веха» в v1), тем же блоком, что в паспорте вехи (там — в общем блоке
// графиков паспорта charts/TaskFlowCharts: на телефоне свёрнут кнопкой, на компьютере открыт).
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
