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
// на тип. Полноту и парность проверяет loreEdges.test.ts — по реестрам сервера
// (модель + CREATE EDGE TYPE схемы), а не по списку, подобранному руками.
// Неизвестный тип показывается кодом (запасной путь, тест его не допускает).
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
  // S5-10 (приёмка 14.11): все остальные типы рёбер сервера — модель и схема. Раньше их не
  // было, и легенда графа показывала код (DOCUMENTED_IN, PARENT_OF). Полноту держит
  // loreEdges.test.ts по реестрам сервера; код остаётся подсказкой (title) чипа легенды.
  // Документирование, иерархия, состав
  DOCUMENTED_IN: { ru: 'описан в', en: 'documented in', color: '--wrn' },
  PARENT_OF: { ru: 'родитель для', en: 'parent of', color: '--inf' },
  PARENT_PRODUCT: { ru: 'входит в продукт', en: 'parent product', color: '--inf' },
  DECOMPOSES_INTO: { ru: 'раскладывается на', en: 'decomposes into', color: '--inf' },
  INCLUDES: { ru: 'включает', en: 'includes', color: '--inf' },
  IN_PRODUCT: { ru: 'в продукте', en: 'in product', color: '--inf' },
  IN_AREA: { ru: 'в области', en: 'in area', color: '--inf' },
  SERVES: { ru: 'обслуживает', en: 'serves', color: '--inf' },
  USES: { ru: 'использует', en: 'uses', color: '--inf' },
  FORMALIZED_AS: { ru: 'оформлено как', en: 'formalized as', color: '--acc' },
  // Планирование и поставка
  TARGETS_MILESTONE: { ru: 'к вехе', en: 'targets milestone', color: '--acc' },
  TARGETS_PRODUCT: { ru: 'для продукта', en: 'targets product', color: '--acc' },
  ON_MILESTONE: { ru: 'на вехе', en: 'on milestone', color: '--acc' },
  // MDL-13 «треки б»: трек спринта — историчное ребро спринт → трек.
  ON_TRACK: { ru: 'на треке', en: 'on track', color: '--acc' },
  SHIPPED_IN: { ru: 'вошло в релиз', en: 'shipped in', color: '--suc' },
  RELEASED_IN: { ru: 'выпущено в', en: 'released in', color: '--suc' },
  CLOSED_BY: { ru: 'закрыто PR', en: 'closed by', color: '--suc' },
  CHANGED_IN: { ru: 'изменено в', en: 'changed in', color: '--t2' },
  EDITED_IN: { ru: 'правилось в', en: 'edited in', color: '--t2' },
  PRODUCED: { ru: 'произвело', en: 'produced', color: '--suc' },
  PRODUCED_BY: { ru: 'подготовлено в', en: 'produced by', color: '--suc' },
  YIELDED: { ru: 'дало', en: 'yielded', color: '--suc' },
  // Качество
  VALIDATES: { ru: 'проверяет', en: 'validates', color: '--wrn' },
  MEASURED_BY: { ru: 'измеряется', en: 'measured by', color: '--wrn' },
  PROMOTED_TO: { ru: 'переведено в', en: 'promoted to', color: '--wrn' },
  LED_TO: { ru: 'привело к', en: 'led to', color: '--wrn' },
  // Люди, агенты, роли, машины
  OWNED_BY: { ru: 'владелец', en: 'owned by', color: '--t2' },
  HAS_PROJECT_ROLE: { ru: 'роль в проекте', en: 'has project role', color: '--t2' },
  ROLE_HELD_BY: { ru: 'роль у', en: 'role held by', color: '--t2' },
  // MT-MCP-TRUTH A6: ответственный вопроса — ребро к человеку или агенту реестра.
  ANSWERABLE_BY: { ru: 'ответственный', en: 'answerable by', color: '--t2' },
  FILLS_ROLE: { ru: 'исполняет роль', en: 'fills role', color: '--t2' },
  LOGGED_BY: { ru: 'записано агентом', en: 'logged by', color: '--t2' },
  USES_MACHINE: { ru: 'работает на машине', en: 'uses machine', color: '--t2' },
  MACHINE_ACCESS: { ru: 'доступ к машине', en: 'machine access', color: '--t2' },
  // Файлы и публикации BRAGI
  ATTACHED_TO: { ru: 'с вложением', en: 'attached to', color: '--t2' },
  HAS_ASSET: { ru: 'с файлом', en: 'has asset', color: '--t2' },
  SOURCED_FROM: { ru: 'взято из', en: 'sourced from', color: '--t2' },
  HAS_VARIANT: { ru: 'с вариацией', en: 'has variant', color: '--inf' },
  FOR_VARIANT: { ru: 'для вариации', en: 'for variant', color: '--inf' },
  IN_CHANNEL: { ru: 'в канале', en: 'in channel', color: '--inf' },
  IN_RUBRIC: { ru: 'в рубрике', en: 'in rubric', color: '--inf' },
  TARGETS_KEY: { ru: 'на ключевое слово', en: 'targets keyword', color: '--inf' },
  TARGETS_PAGE: { ru: 'на страницу', en: 'targets page', color: '--inf' },
  // Структурные: принадлежность и иерархия
  HAS_STATE: { ru: 'версия записи', en: 'has state', color: '--t3', layer: S },
  BELONGS_TO_PROJECT: { ru: 'в проекте', en: 'in project', color: '--t3', layer: S },
  // D-2026-MIG-REPOSITORY-ORGANIZATION: репозитории и организации (решение владелицы 19.11.2026)
  HAS_REPOSITORY: { ru: 'основной репозиторий', en: 'primary repository', color: '--inf' },
  COMPONENT_REPOSITORY: { ru: 'репозиторий компонента', en: 'component repository', color: '--inf' },
  MIRRORED_TO: { ru: 'зеркало', en: 'mirrored to', color: '--t2' },
  USES_REPOSITORY: { ru: 'использует', en: 'uses', color: '--t2' },
  ORG_HAS_PROJECT: { ru: 'проект организации', en: 'organization project', color: '--t2' },
  ORG_HAS_PRODUCT: { ru: 'продукт организации', en: 'organization product', color: '--t2' },
  ORG_HAS_REPOSITORY: { ru: 'репозиторий организации', en: 'organization repository', color: '--t2' },
  ORG_MEMBER: { ru: 'в организации', en: 'organization member', color: '--t2' },
  BELONGS_TO: { ru: 'принадлежит', en: 'belongs to', color: '--t3', layer: S },
  PART_OF: { ru: 'входит в', en: 'part of', color: '--t3', layer: S },
  IN_PHASE: { ru: 'в фазе', en: 'in phase', color: '--t3', layer: S },
  TAGGED_WITH: { ru: 'с тегом', en: 'tagged with', color: '--t3', layer: S },
  DOC_CHILD_OF: { ru: 'дочерний документ', en: 'child doc of', color: '--t3', layer: S },
  // SPRINT_LORE_KNOW_REGISTRY/SKILL-02 (SPEC-SKILLS-TAGS-062 §6): рёбра вида skill:*.
  APPLIES_TO_ROLE: { ru: 'для роли', en: 'applies to role', color: '--inf' },
  SKILL_EXTENDS: { ru: 'уточняет скилл', en: 'extends skill', color: '--inf' },
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
