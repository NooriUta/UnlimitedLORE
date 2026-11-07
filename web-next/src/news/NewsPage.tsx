// Экран «Новости» LORE v2 (SPRINT_UXR_S7A_NEWS/S7A-02, MVP D-2026-UXR-MVP).
// Вся лента — компонент kit (NewsFeed): тот же, что паспорта S5 вставляют
// вкладкой «Активность» (NewsActivity, S7A-06). Здесь — только выбор
// источника данных; разрез экрана живёт в URL (префикс «n»).
import { NewsFeed } from '@seidr/kit';
import { newsSource } from './source';

export default function NewsPage() {
  return (
    <main data-lore-app="v2" className="shell">
      <NewsFeed source={newsSource} urlPrefix="n" />
    </main>
  );
}
