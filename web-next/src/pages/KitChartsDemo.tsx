// Витрина /kit: графики одним семейством (SPRINT_UXR_S13_KIT4/K4-CHARTS) — на формах данных
// прототипа k4-charts.html, который владелица утвердила 14.11.2026: дрейф MUNINN (с пропуском),
// Парето MUNINN, доля BRAGI в ИИ-выдаче, семантическая матрица MUNINN, телеметрия MIDGARD.
import { BarChart, HeatChart, LineChart, ScatterChart } from '@seidr/kit';
import { appT } from '../i18n';
import type { KitLang } from '@seidr/kit';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-03T00:00:00Z');
const HOUR = 3_600_000;

export function KitChartsDemo({ lang }: { lang: KitLang }) {
  const t = (k: Parameters<typeof appT>[1]) => appT(lang, k);
  return (
    <div className="kitp__grid">
      <LineChart title={t('kitPage.chf.drift')} source="MUNINN · bench drift" unit={t('kitPage.chf.score')}
        series={[
          { key: 'qwen', label: 'qwen3-32b', points: [71, 72, 70, 73, 74, 74, null, 76, 77].map((y, i) => ({ x: T0 + i * 3 * DAY, y })) },
          { key: 'llama', label: 'llama-4-scout', points: [64, 66, 65, 63, 62, 61, 63, 64, 66].map((y, i) => ({ x: T0 + i * 3 * DAY, y })) },
        ]} />
      <ScatterChart title={t('kitPage.chf.pareto')} source="MUNINN · bench pareto" xTitle={t('kitPage.chf.tokens')}
        groups={[{ key: 'local', label: 'local' }, { key: 'api', label: 'api' }]}
        points={[
          { x: 800, y: 74, label: 'gemini-flash', group: 'api' }, { x: 1150, y: 79, label: 'claude-haiku', group: 'api' },
          { x: 2350, y: 88, label: 'claude-sonnet', group: 'api' }, { x: 950, y: 69, label: 'qwen3-8b', group: 'local' },
          { x: 1600, y: 75, label: 'gpt-oss-20b', group: 'local' }, { x: 2050, y: 77, label: 'qwen3-32b', group: 'local' },
          { x: 1450, y: 65, label: 'mistral-small', group: 'local' }, { x: 2450, y: 63, label: 'llama-4-scout', group: 'local' },
        ]} />
      <BarChart title={t('kitPage.chf.share')} source="BRAGI · analytics" unit="%"
        groups={[{ key: 'art', label: t('kitPage.chf.articles') }, { key: 'post', label: t('kitPage.chf.posts') }]}
        data={[
          { category: 'Хабр', values: { art: 34, post: 12 } }, { category: 'vc.ru', values: { art: 21, post: 14 } },
          { category: 'Telegram', values: { art: 8, post: 27 } }, { category: 'LinkedIn', values: { art: 5, post: null } },
        ]} />
      <HeatChart title={t('kitPage.chf.heat')} source="MUNINN · bench semantic"
        rows={['ru-wiki', 'ru-news', 'code', 'sql', 'docs']} cols={['L1', 'L2', 'L3', 'L4', 'L5']}
        values={[[92, 88, 81, 70, 55], [90, 85, 77, 60, 49], [84, 80, 72, 61, 40], [88, 83, 75, 66, 52], [91, 86, 60, null, 60]]} />
      <LineChart title={t('kitPage.chf.tele')} source="MIDGARD · greenhouse-2" unit="°C"
        xLabel={x => new Date(x).toISOString().slice(11, 16)}
        series={[
          { key: 'air', label: t('kitPage.chf.air'), points: [21, 22.4, 23.8, 24.6, 23.9, 22.7, 21.5, 19.6, 18.1, 19.8, 22.1, 24.3].map((y, i) => ({ x: T0 + i * 2 * HOUR, y })) },
          { key: 'set', label: t('kitPage.chf.setpoint'), dashed: true, points: Array.from({ length: 12 }, (_, i) => ({ x: T0 + i * 2 * HOUR, y: 22 })) },
        ]} />
      <BarChart title={t('kitPage.chf.failed')} groups={[]} data={[]} error={t('kitPage.chf.failedWhy')} onRetry={() => {}} />
    </div>
  );
}
