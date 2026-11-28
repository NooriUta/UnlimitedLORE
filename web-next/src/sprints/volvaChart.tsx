// Встроенный график Völva в v2 (SPRINT_VIZ_EMBED/EMB-L2, VE-4) — перенос слоя
// v1 (src/components/lore/charts/LoreChart.tsx + chartLayer.ts).
//
// Почему перенос, а не «подключить»: v1 заморожен с 07.11 (S3-10), а в v2
// настройку charts.layer можно было выставить во «Флагах», но её не читал ни
// один экран — встройки не было нигде, даже честного «не настроено» (приёмка
// 14.11.2026, препрод ef099926).
//
// Слой — настройка app_setting `charts.layer`, одна на весь LORE (решение
// владелицы 06.11.2026). Встройка — только явным «volva»: пустое, неизвестное
// или выключенное значение не уводит графики во внешнюю систему, и всё
// остаётся как было. Подпись адреса — только бэкенд LORE
// (GET /lore/embed/volva/{chart}?project=a/b,c/d, VE-2), проект — из скоупа шапки.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EmbedChartFrame, useKitLang, type EmbedFrameState, type KitLang } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { appT, useAppT } from '../i18n';
import { fetchAppSettings } from '../admin/appSettings';
import type { DictRow } from '../admin/dicts';

export type ChartLayer = 'echarts' | 'volva';
export const CHART_LAYER_KEY = 'charts.layer';
/** График «Спринтов» по D-2026-LORE-VIZ-EMBED-PLACES — карточка 44 в белом списке бэкенда. */
export const VOLVA_SPRINTS_CHART = 'sprints_timeline';
/** Имя системы в текстах состояний. */
export const VOLVA_SOURCE = 'Völva';
/** Иконка вида: провидица Völva — хрустальный шар (game-icons). */
export const VOLVA_VIEW_ICON = 'crystal-ball';
/**
 * Ожидание первого сообщения встройки, мс. VE-7 (Völva 0.1.12 на стенде, 15.11.2026): статическая
 * встройка шлёт metabase.frame сразу после отрисовки и metabase.error при ошибке — молчание 15 с
 * значит «не ответила».
 */
export const VOLVA_ANSWER_TIMEOUT_MS = 15000;

/** Слой графиков: volva — только явным значением; иначе echarts. */
export function chartLayerOf(rows: readonly Pick<DictRow, 'code' | 'label_ru' | 'is_active'>[]): ChartLayer {
  const r = rows.find(x => x.code === CHART_LAYER_KEY && x.is_active !== false);
  const v = (r?.label_ru ?? '').trim().toLowerCase().replace('ö', 'o');
  return v === 'volva' ? 'volva' : 'echarts';
}

/**
 * Слой из app_setting. Пока не прочитан или прочитать не смогли — echarts:
 * встройку нельзя включать на догадке, а прежний вид остаётся рабочим.
 *
 * Фолбэк (владелица 14.11.2026, на проде charts.layer=volva без ключа): «фолбек
 * на echarts должна быть у тех у кого нет настройки интеграции с volva». При
 * volva и заданном `chart` подпись проверяется один раз: «не настроено» (нет
 * ключа/адреса — 503, нет графика в белом списке — 404) → echarts, вида Völva
 * нет. Нет прав, нужен проект, сбой сети — Völva остаётся и показывает это
 * честно: это не «не настроено».
 */
export function useChartLayer(fetchImpl?: typeof fetch, enabled = true, chart?: string): ChartLayer {
  const [layer, setLayer] = useState<ChartLayer>('echarts');
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fetchAppSettings(ctrl.signal, fetchImpl)
      .then(async rows => {
        if (ctrl.signal.aborted) return;
        const want = chartLayerOf(rows);
        if (want !== 'volva' || !chart) { setLayer(want); return; }
        const probe = await volvaEmbedState(chart, [], fetchImpl, { signal: ctrl.signal });
        if (!ctrl.signal.aborted) setLayer(probe.kind === 'not_configured' ? 'echarts' : 'volva');
      })
      .catch(() => { /* не прочитали — встройка не включается, вид прежний */ });
    return () => ctrl.abort();
  }, [fetchImpl, enabled, chart]);
  return enabled ? layer : 'echarts';
}

const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('application/json');

/** Ответ подписи → честное состояние рамки. */
export async function volvaEmbedState(
  chart: string,
  projects: readonly string[],
  fetchImpl: typeof fetch = loreFetch,
  opts: { signal?: AbortSignal; lang?: KitLang } = {},
): Promise<EmbedFrameState> {
  const lang = opts.lang ?? 'ru';
  // EMB-L6: язык LORE — в подпись (запертый lang у графика с флагом lang), чтобы статусы и надписи
  // Völva были на том же языке, что и LORE. Бэкенд принимает только ru/en.
  const q = new URLSearchParams();
  if (projects.length) q.set('project', projects.join(','));
  q.set('lang', lang);
  const qs = `?${q.toString()}`;
  let res: Response;
  try {
    res = await fetchImpl(`/lore/embed/volva/${encodeURIComponent(chart)}${qs}`, { signal: opts.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    return { kind: 'unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
  if (!isJson(res)) return { kind: 'unavailable', detail: `HTTP ${res.status} NON_JSON` };
  let b: Record<string, unknown> = {};
  try { b = (await res.json()) as Record<string, unknown>; } catch { return { kind: 'unavailable', detail: `HTTP ${res.status}` }; }
  const code = typeof b.error === 'string' ? b.error : '';
  const detail = typeof b.detail === 'string' ? b.detail : '';
  if (res.ok) {
    const url = typeof b.url === 'string' ? b.url : '';
    return url ? { kind: 'ready', signedUrl: url } : { kind: 'unavailable', detail: 'malformed answer: url' };
  }
  if (res.status === 503 && (code === 'NOT_CONFIGURED' || code === '')) {
    return { kind: 'not_configured', hint: appT(lang, 'volva.notConfigured.hint'), detail: code || `HTTP ${res.status}` };
  }
  if (res.status === 404 && code === 'UNKNOWN_CHART') {
    return { kind: 'not_configured', hint: appT(lang, 'volva.unknownChart.hint', { chart }), detail: code };
  }
  if (res.status === 400 && code === 'PROJECT_REQUIRED') {
    return { kind: 'needs', title: appT(lang, 'volva.needsProject.title'), hint: appT(lang, 'volva.needsProject.hint') };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'forbidden', reason: detail || code || `HTTP ${res.status}` };
  return { kind: 'unavailable', detail: [code || `HTTP ${res.status}`, detail].filter(Boolean).join(': ') };
}

export interface VolvaChartProps {
  chart: string;
  title: string;
  /** Проекты скоупа шапки — граница прав, запирается в подписи. */
  projects: readonly string[];
  fetchImpl?: typeof fetch;
}

/** Встроенный график Völva: подпись на бэкенде → рамка kit с честными состояниями. */
export function VolvaChart({ chart, title, projects, fetchImpl }: VolvaChartProps) {
  const lang = useKitLang();
  const [state, setState] = useState<EmbedFrameState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = projects.join(',');
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    volvaEmbedState(chart, key ? key.split(',') : [], fetchImpl, { signal: ctrl.signal, lang })
      .then(s => { if (!ctrl.signal.aborted) setState(s); });
    return () => ctrl.abort();
  }, [chart, key, fetchImpl, lang, attempt]);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const { ref, height } = useFillHeight(VOLVA_MIN_HEIGHT);
  // VE-7 (Völva 0.1.12): высота — metabase.frame, ошибка — metabase.error (рамка kit показывает
  // «Völva: ошибка» с кодом); молчание 15 с — «не ответила».
  // EMB-L6 (слово владелицы 28.11): минимум — вся оставшаяся высота окна, а не 320 px: Völva
  // растягивает строки на высоту кадра, и 105 спринтов не сплющиваются в полоску.
  return (
    <div ref={ref}>
      {/* Рамка kit берёт minHeight как НАЧАЛЬНОЕ значение своей высоты — рисуем её после замера. */}
      {height != null && <EmbedChartFrame source={VOLVA_SOURCE} title={title} state={state} minHeight={height} onRetry={retry} answerTimeoutMs={VOLVA_ANSWER_TIMEOUT_MS} />}
    </div>
  );
}

const VOLVA_MIN_HEIGHT = 320;
/** Запас под нижнюю кромку окна (строка состояния LORE). */
const FILL_BOTTOM_GAP = 24;

/** Высота от верха элемента до низа окна (не меньше min); пересчёт на resize. */
export function useFillHeight(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(min, Math.floor(window.innerHeight - Math.max(0, top) - FILL_BOTTOM_GAP)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [min]);
  return { ref, height };
}

/** Подпись вида и заголовок рамки «Спринтов». */
export function useVolvaSprintsLabels() {
  const t = useAppT();
  return { view: t('volva.view'), title: t('volva.sprintsTitle') };
}
