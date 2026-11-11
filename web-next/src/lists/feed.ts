// Вид «Лента» в разделах LORE (SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW).
//
// kit предлагает ленту только там, где ПРИЛОЖЕНИЕ назвало поле времени, поля
// сути и связи-поводы (K-14, decision:D-2026-UXR-KIT-ABSTRACTIONS-APP-SCREENS):
// угадывать, где у записи время и что в ней главное, kit не станет. Здесь эти
// названия и живут — одним описанием на раздел, из которого строятся и конфиг
// kit (`list.feed`), и тело записи, и нижний уровень.
//
// Тело — слово владелицы 10.11.2026: «грузить первые 3 абзаца, остальное при
// раскрытии». Отсюда два пути, и выбор между ними — по цене, а не по вкусу:
//   • тело УЖЕ едет строкой среза (у спринта context_md, у вопроса body_md, у
//     релиза description_md, у технологии content_md) — оно отдаётся целиком,
//     kit показывает три абзаца и раскрывает остальное на месте, без сети;
//   • тела в строке нет (задача, ADR, решение, спека, фича) — тянуть его на всю
//     ленту значило бы N запросов на экран (у задач — 4 млн символов, SE-01).
//     Поэтому тело берётся паспортом `/lore/record` ОДНОЙ записи и только по
//     раскрытию; до него kit честно пишет «Ещё» без числа.
import type { KitConfig, KitEdge, KitRecord } from '@seidr/kit';
import type { AppKey } from '../i18n';
import type { LoreClient } from '../sprints/loreClient';

/** Описание ленты раздела — названия, которые kit сам не угадывает. */
export interface FeedSpec {
  /**
   * Поля сути — md-поля тела записи (1–2). Имя — то же, под которым поле лежит
   * в строке среза и в `values` паспорта: одно имя на оба источника.
   */
  lead: readonly string[];
  /** Срез уже везёт эти поля в строке: тело целиком здесь, сеть не нужна. */
  inRow?: boolean;
  /** Связи, объясняющие повод записи (типы рёбер, как в паспорте). */
  because?: readonly string[];
  /**
   * Повод, который уже лежит полем строки: тип связи → поле записи. Ребро
   * строится из него без запроса (решение → его ADR, вопрос → задачи, которые
   * он держит). Остальные поводы приходят связями паспорта по раскрытию.
   */
  becauseFields?: Readonly<Record<string, string>>;
  /** Нижний уровень двухуровневой ленты; грузится ПРИ РАСКРЫТИИ. */
  under?: {
    titleKey: AppKey;
    load: (client: LoreClient, id: string, signal?: AbortSignal) => Promise<{ records: KitRecord[]; total?: number }>;
  };
}

/** Подписи связей-поводов: ключ i18n по типу ребра. */
export const EDGE_LABEL: Readonly<Record<string, AppKey>> = {
  DEPENDS_ON: 'lists.edge.DEPENDS_ON',
  IMPLEMENTED_IN: 'lists.edge.IMPLEMENTED_IN',
  JUSTIFIED_BY: 'lists.edge.JUSTIFIED_BY',
  GATES: 'lists.edge.GATES',
  SUPERSEDES: 'lists.edge.SUPERSEDES',
  DECIDED_IN: 'lists.edge.DECIDED_IN',
  ANSWERS: 'lists.edge.ANSWERS',
  RAISED_IN: 'lists.edge.RAISED_IN',
};

/** `list.feed` и подписи рёбер для конфига kit. Поле времени — свежесть (changed_at → updated_at, PR #1115). */
export function feedConfig(
  spec: FeedSpec, t: (k: AppKey) => string,
): { feed: NonNullable<NonNullable<KitConfig['list']>['feed']>; edges?: KitConfig['edges'] } {
  const because = spec.because ?? [];
  const feed: NonNullable<NonNullable<KitConfig['list']>['feed']> = {
    timeField: 'updated_at',
    lead: spec.lead.map(k => `fields.${k}`),
    ...(because.length ? { because: [...because] } : {}),
    ...(spec.under ? { under: { title: t(spec.under.titleKey) } } : {}),
  };
  if (!because.length) return { feed };
  const edges: NonNullable<KitConfig['edges']> = {};
  for (const type of because) edges[type] = { label: EDGE_LABEL[type] ? t(EDGE_LABEL[type]) : type, color: 'var(--inf)' };
  return { feed, edges };
}

/**
 * Абзацы md-текста: куски между пустыми строками. Что считать абзацем — забота
 * источника (kit получает абзацы готовыми), и правило здесь одно на все поля.
 */
export function paragraphsOf(...texts: unknown[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (typeof t !== 'string') continue;
    for (const p of t.split(/\r?\n\s*\r?\n/)) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Рёбра-поводы, которые уже лежат полями записей (без запроса). */
export function edgesFromFields(records: readonly KitRecord[], spec: FeedSpec): KitEdge[] {
  const map = spec.becauseFields;
  if (!map) return [];
  const out: KitEdge[] = [];
  for (const r of records) {
    for (const [type, key] of Object.entries(map)) {
      const v = r.fields?.[key];
      const vals = Array.isArray(v) ? v : [v];
      for (const x of vals) if (typeof x === 'string' && x && x !== r.id) out.push({ from: r.id, to: x, type });
    }
  }
  return out;
}
