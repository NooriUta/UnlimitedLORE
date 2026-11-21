// Графики разделов списков — видом «Аналитика» в переключателе видов, а не над списком (владелица 21.11.2026:
// «что опять делает тут график? у нас же должна быть вкладка аналитика или völva»). Правило для всех экранов:
// графики НИКОГДА не стоят над содержимым — в паспорте это вкладка «Графики» (#1687), в списке — вид «Аналитика».
// Нет записи раздела здесь — вида «Аналитика» у раздела нет.
import type { ReactNode } from 'react';
import type { ListScreenId } from '../lists/screens';
import { ReleaseRhythmBlock } from './Batch2Charts';

export interface SectionChartsProps { fetchImpl?: typeof fetch }

/** Раздел списка → его графики (рисуются только в виде «Аналитика»). */
export const SECTION_CHARTS: Partial<Record<ListScreenId, (p: SectionChartsProps) => ReactNode>> = {
  // №8 (графики 19.11.2026, пачка 2): ритм релизов — прежде висел над лентой релизов.
  releases: p => (
    <section className="an-grid pch__grid" data-testid="releases-charts">
      <div className="an-block" data-block="rhythm"><ReleaseRhythmBlock {...p} /></div>
    </section>
  ),
};
