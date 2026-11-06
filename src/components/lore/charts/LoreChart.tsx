// Один график — два слоя (решение владелицы 06.11.2026): свой на ECharts или
// встройка Völva. Слой выбирается настройкой charts.layer в админке
// (app_setting), одной на весь LORE. В слое Völva отсутствие карточки или
// подписи показывается честно, а не пустой рамкой.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchVolvaEmbed, LoreHttpError } from '../../../api/lore';
import { useDictionary } from '../DictionaryProvider';
import VolvaEmbedFrame, { type VolvaEmbedState } from '../VolvaEmbedFrame';
import { readChartLayer } from './chartLayer';

interface Props {
  /** Имя графика в белом списке встройки Völva (lore.volva.embed.charts). */
  volvaChart: string;
  volvaProject?: string;
  title: string;
  /** Слой ECharts — рисует LORE. */
  children: ReactNode;
}

export function useChartLayer() {
  const { entries } = useDictionary('app_setting');
  return readChartLayer(entries);
}

export default function LoreChart({ volvaChart, volvaProject, title, children }: Props) {
  const { t } = useTranslation();
  const layer = useChartLayer();
  const [state, setState] = useState<VolvaEmbedState>({ kind: 'loading' });

  useEffect(() => {
    if (layer !== 'volva') return;
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    fetchVolvaEmbed(volvaChart, volvaProject, ctrl.signal)
      .then(r => setState({ kind: 'ready', signedUrl: r.url }))
      .catch(e => {
        if (ctrl.signal.aborted) return;
        if (e instanceof LoreHttpError && (e.status === 503 || e.status === 404)) setState({ kind: 'not_configured' });
        else setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [layer, volvaChart, volvaProject]);

  if (layer === 'echarts') return <>{children}</>;
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginBottom: 4 }}>{t('lore.charts.volvaLayer', 'Слой Völva (настройка charts.layer в админке)')}</div>
      <VolvaEmbedFrame state={state} title={title} minHeight={160} />
    </div>
  );
}
