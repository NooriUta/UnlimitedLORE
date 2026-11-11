// Метрики ведра ленты → цифры для kit BucketFigures (SPRINT_UXR_S7A_NEWS, владелица
// 11.11.2026: «все важные метрики должны быть посчитаны и отображены для этой группы:
// считает сервер, отображает kit»).
//
// Ведро — день, группа или подгруппа: у всех ОДИН набор чисел (контракт с сервером, список
// а)–д) от 11.11): by_kind, by_type (с by_kind), burn, total, agent_*. Здесь только подпись и
// раскладка — ни одного пересчёта: клиент рисует поля ответа, как и для дня (S7A-09).
// Поля нет — элемента нет: «сервер не прислал» ≠ «ноль».
import type { BucketChip, BucketFiguresProps, KitLang } from '@seidr/kit';
import { NEWS_KIND_META, NEWS_TYPE_META, pairText, signTone, signed, typeLabel } from './model';
import type { NewsKey } from './i18n';
import type { NewsPair, NewsTriple } from './types';

/** Набор чисел ведра — одинаковый у дня, группы и подгруппы. Всё необязательно: старый сервер. */
export interface NewsBucketMetrics {
  total?: NewsPair;
  by_kind?: Record<string, NewsTriple>;
  by_type?: Record<string, NewsTriple & { by_kind?: Record<string, NewsTriple> }>;
  /** Сгорание задач ведра: последний статус объекта в границах ведра (правило владелицы). */
  burn?: { open_start: number; open_end: number; burn: number };
  agent_events?: number;
  agent_elements?: number;
  /** Баланс «закрыто против заведено» — считает сервер (форма 11.11, ветка fix/news-ready-last-status). */
  balance?: { closed: number; created: number };
  /** Выкатка задач ведра. */
  ship?: { waiting: number; ship_unknown: number; shipped: number };
  /** Правило счёта ведра: последний статус объекта в границах дня или периода. */
  rule?: string;
  /** Промежуточные переходы, отброшенные из счёта по правилу последнего статуса. */
  intermediate?: { events: number; rows: number };
}

/** Критичные виды (набор утвердила владелица 09.11.2026) — цветными чипами. */
export const CRIT_KINDS = ['ready', 'reactivated', 'released'] as const;

type T = (k: NewsKey, vars?: Record<string, string | number>) => string;

export interface FiguresOpts {
  t: T;
  lang: KitLang;
  /** Типы не показываем, если ось группировки — тип: они и так стоят заголовками. */
  showTypes: boolean;
  /** Приставка testid: у дня — 'news-cube-' (как было), у групп — своя, чтобы не совпадали. */
  idPrefix: string;
  compact?: boolean;
}

/** Цифры ведра. null — сервер ничего для ведра не прислал. */
export function figuresOf(m: NewsBucketMetrics | undefined, o: FiguresOpts): BucketFiguresProps | null {
  if (!m || (!m.by_kind && !m.total && !m.burn && !m.balance)) return null;
  const { t, lang, idPrefix: p } = o;
  const rows = (k: string) => m.by_kind?.[k]?.rows ?? 0;
  // Баланс — из поля сервера; старый сервер его не шлёт — тогда из by_kind, как было у дня.
  const tasksCreated = m.balance?.created ?? m.by_type?.task?.by_kind?.created?.rows ?? 0;
  const closed = m.balance?.closed ?? rows('closed');
  const burn = m.burn;
  const showBal = closed + tasksCreated > 0 || (burn && burn.burn !== 0);
  const crit: BucketChip[] = CRIT_KINDS.flatMap(k => {
    const n = rows(k);
    return n ? [{ id: `${p}kind-${k}`, n, label: t(`cube.${k}` as NewsKey), icon: NEWS_KIND_META[k].icon, tone: NEWS_KIND_META[k].tone, showLabel: true }] : [];
  });
  const otherCreated = rows('created') - tasksCreated;
  const info: BucketChip[] = [
    ...(otherCreated > 0 ? [{ n: otherCreated, label: t('cube.other'), icon: NEWS_KIND_META.created.icon }] : []),
    ...(rows('changed') > 0 ? [{ n: rows('changed'), label: t('cube.changed'), icon: NEWS_KIND_META.changed.icon }] : []),
  ];
  return {
    compact: o.compact,
    ...(burn ? { burn: { text: signed(burn.burn), tone: signTone(burn.burn), title: t('cube.burn'), id: `${p}burn` } } : {}),
    ...(showBal ? {
      balance: {
        done: closed, added: tasksCreated, aria: t('bal', { cl: closed, cr: tasksCreated }),
        doneText: `${closed} ${t('cube.closed')}`, addedText: `${tasksCreated} ${t('cube.created')}`,
        doneId: `${p}kind-closed`, addedId: `${p}kind-created`,
      },
    } : {}),
    chips: crit,
    ...(m.total ? { total: { text: pairText(m.total), title: t('pair'), id: `${p}total`, innerId: p === 'news-cube-' ? 'news-day-total' : `${p}pair` } } : {}),
    tail: [...info, ...(m.total ? [{ id: `${p}delta`, n: m.total.elements, label: t('cube.delta'), text: `Δ ${m.total.elements}` }] : [])],
    ...(o.showTypes && m.by_type ? {
      types: Object.entries(m.by_type).map(([k, n]) => ({ key: k, n: n.rows, icon: NEWS_TYPE_META[k]?.icon ?? 'scroll-quill', title: typeLabel(k, lang) })),
      typesId: p === 'news-cube-' ? 'news-day-types' : `${p}types`, typesTitle: t('day.types'),
    } : {}),
  };
}
