// Словарь типов рёбер LORE для графа и связей паспорта v2
// (SPRINT_UXR_S5_RECORD_TASKS/S5-10). Подпись читается «откуда → куда»:
// «D-… решено в ADR-…», «задача ссылается на ADR». Набор — рёбра схемы, которые
// ставит «Связать» S2-06 (LoreLinkTypes.PAIRS) и рёбра с побочным действием,
// плюс структурные (принадлежность/иерархия) — они идут в отдельный слой
// графа (layer: 'structural'), скрытый по умолчанию. Список структурных — тот
// же, что в LoreLinkTypes («не входят в таблицу сознательно») и
// BACKLINK_EXCLUDED_EDGE_TYPES контракта S2.
//
// Подписи — в TS, а не в web-next/src/i18n: это справочник схемы с парой ru/en
// на тип, парность проверяет тест. Неизвестный тип показывается кодом.
import type { KitConfig, KitLang } from '@seidr/kit';

export interface LoreEdgeType {
  ru: string;
  en: string;
  /** Токен цвета без var(): --acc, --inf… */
  color: string;
  layer?: 'structural';
}

const S = 'structural' as const;

export const LORE_EDGE_TYPES: Record<string, LoreEdgeType> = {
  // Решения и обоснование
  DECIDED_IN: { ru: 'решено в', en: 'decided in', color: '--acc' },
  JUSTIFIED_BY: { ru: 'обосновано', en: 'justified by', color: '--acc' },
  SUPERSEDES: { ru: 'заменяет', en: 'supersedes', color: '--wrn' },
  TRACED_TO: { ru: 'прослежено к', en: 'traced to', color: '--acc' },
  // Ссылки
  REFERENCES: { ru: 'упоминает', en: 'mentions', color: '--inf' },
  REFERENCES_ADR: { ru: 'ссылается на ADR', en: 'references ADR', color: '--inf' },
  // Реализация и поставка
  IMPLEMENTED_IN: { ru: 'реализуется в', en: 'implemented in', color: '--suc' },
  IMPLEMENTED_IN_RELEASE: { ru: 'вышло в релизе', en: 'shipped in release', color: '--suc' },
  REALIZES: { ru: 'реализует', en: 'realizes', color: '--suc' },
  // Зависимости и блокировки
  DEPENDS_ON: { ru: 'зависит от', en: 'depends on', color: '--wrn' },
  BLOCKS: { ru: 'блокирует', en: 'blocks', color: '--dng' },
  GATES: { ru: 'гейт для', en: 'gates', color: '--dng' },
  // Вопросы
  RAISED_IN: { ru: 'поднят в', en: 'raised in', color: '--wrn' },
  ANSWERS: { ru: 'отвечает на', en: 'answers', color: '--suc' },
  // Сценарии и JTBD
  UC_INCLUDES: { ru: 'включает сценарий', en: 'includes use case', color: '--inf' },
  UC_EXTENDS: { ru: 'расширяет сценарий', en: 'extends use case', color: '--inf' },
  BUILDS_ON: { ru: 'опирается на', en: 'builds on', color: '--inf' },
  HAS_ACTOR: { ru: 'с участием', en: 'has actor', color: '--t2' },
  RELIEVES: { ru: 'снимает боль', en: 'relieves', color: '--suc' },
  ADDRESSES: { ru: 'адресует боль', en: 'addresses', color: '--suc' },
  PROMISES: { ru: 'обещает выгоду', en: 'promises', color: '--suc' },
  DELIVERS: { ru: 'даёт выгоду', en: 'delivers', color: '--suc' },
  PERFORMS: { ru: 'выполняет работу', en: 'performs', color: '--inf' },
  HELPS_WITH: { ru: 'помогает с работой', en: 'helps with', color: '--inf' },
  FELT_BY: { ru: 'ощущает', en: 'felt by', color: '--wrn' },
  PERFORMED_BY: { ru: 'выполняется', en: 'performed by', color: '--t2' },
  SUCCESS_OF: { ru: 'успех работы', en: 'success of', color: '--suc' },
  DESIRED_BY: { ru: 'желанно для', en: 'desired by', color: '--t2' },
  // Структурные: принадлежность и иерархия
  HAS_STATE: { ru: 'версия записи', en: 'has state', color: '--t3', layer: S },
  BELONGS_TO_PROJECT: { ru: 'в проекте', en: 'in project', color: '--t3', layer: S },
  BELONGS_TO: { ru: 'принадлежит', en: 'belongs to', color: '--t3', layer: S },
  PART_OF: { ru: 'входит в', en: 'part of', color: '--t3', layer: S },
  IN_PHASE: { ru: 'в фазе', en: 'in phase', color: '--t3', layer: S },
  TAGGED_WITH: { ru: 'с тегом', en: 'tagged with', color: '--t3', layer: S },
  DOC_CHILD_OF: { ru: 'дочерний документ', en: 'child doc of', color: '--t3', layer: S },
};

export const LORE_STRUCTURAL_EDGES: ReadonlySet<string> = new Set(
  Object.entries(LORE_EDGE_TYPES).filter(([, e]) => e.layer === S).map(([t]) => t),
);

export function loreEdgeLabel(lang: KitLang, type: string): string {
  const e = LORE_EDGE_TYPES[type];
  return e ? (lang === 'en' ? e.en : e.ru) : type;
}

/** config.edges для kit (подпись, цвет, слой) на выбранном языке. */
export function loreEdgesConfig(lang: KitLang): NonNullable<KitConfig['edges']> {
  const out: NonNullable<KitConfig['edges']> = {};
  for (const [type, e] of Object.entries(LORE_EDGE_TYPES)) {
    out[type] = e.layer ? { label: loreEdgeLabel(lang, type), color: e.color, layer: e.layer } : { label: loreEdgeLabel(lang, type), color: e.color };
  }
  return out;
}
