// Словарь типов рёбер LORE для графа и связей паспорта v2
// (SPRINT_UXR_S5_RECORD_TASKS/S5-10). Подпись читается «откуда → куда»:
// «D-… решено в ADR-…», «задача ссылается на ADR». Набор — рёбра схемы, которые
// ставит «Связать» S2-06 (LoreLinkTypes.PAIRS) и рёбра с побочным действием,
// плюс структурные (принадлежность/иерархия) — они идут в отдельный слой
// графа (layer: 'structural'), скрытый по умолчанию. Список структурных — тот
// же, что в LoreLinkTypes («не входят в таблицу сознательно») и
// BACKLINK_EXCLUDED_EDGE_TYPES контракта S2.
//
// Подписи — в TS, а не в web-next/src/i18n: это справочник схемы с ru/en/pl
// на тип. Полноту и парность проверяет loreEdges.test.ts — по реестрам сервера
// (модель + CREATE EDGE TYPE схемы), а не по списку, подобранному руками.
// Неизвестный тип показывается кодом (запасной путь, тест его не допускает).
import type { KitConfig, KitLang } from '@seidr/kit';

export interface LoreEdgeType {
  ru: string;
  en: string;
  /** KREG-10: польская подпись. KitLang пока ru|en — pl читается через loreEdgeLabel('pl', …); нет pl → en. */
  pl?: string;
  /** Токен цвета без var(): --acc, --inf… */
  color: string;
  layer?: 'structural';
}

const S = 'structural' as const;

export const LORE_EDGE_TYPES: Record<string, LoreEdgeType> = {
  // Решения и обоснование
  DECIDED_IN: { ru: 'решено в', en: 'decided in', pl: 'zdecydowano w', color: '--acc' },
  JUSTIFIED_BY: { ru: 'обосновано', en: 'justified by', pl: 'uzasadnione przez', color: '--acc' },
  SUPERSEDES: { ru: 'заменяет', en: 'supersedes', pl: 'zastępuje', color: '--wrn' },
  TRACED_TO: { ru: 'прослежено к', en: 'traced to', pl: 'powiązane z', color: '--acc' },
  // Ссылки
  REFERENCES: { ru: 'упоминает', en: 'mentions', pl: 'wspomina', color: '--inf' },
  REFERENCES_ADR: { ru: 'ссылается на ADR', en: 'references ADR', pl: 'odwołuje się do ADR', color: '--inf' },
  // Реализация и поставка
  IMPLEMENTED_IN: { ru: 'реализуется в', en: 'implemented in', pl: 'realizowane w', color: '--suc' },
  IMPLEMENTED_IN_RELEASE: { ru: 'вышло в релизе', en: 'shipped in release', pl: 'weszło do wydania', color: '--suc' },
  REALIZES: { ru: 'реализует', en: 'realizes', pl: 'realizuje', color: '--suc' },
  // Зависимости и блокировки
  DEPENDS_ON: { ru: 'зависит от', en: 'depends on', pl: 'zależy od', color: '--wrn' },
  BLOCKS: { ru: 'блокирует', en: 'blocks', pl: 'blokuje', color: '--dng' },
  GATES: { ru: 'гейт для', en: 'gates', pl: 'bramka dla', color: '--dng' },
  // Вопросы
  RAISED_IN: { ru: 'поднят в', en: 'raised in', pl: 'zgłoszone w', color: '--wrn' },
  ANSWERS: { ru: 'отвечает на', en: 'answers', pl: 'odpowiada na', color: '--suc' },
  // Сценарии и JTBD
  UC_INCLUDES: { ru: 'включает сценарий', en: 'includes use case', pl: 'zawiera scenariusz', color: '--inf' },
  UC_EXTENDS: { ru: 'расширяет сценарий', en: 'extends use case', pl: 'rozszerza scenariusz', color: '--inf' },
  BUILDS_ON: { ru: 'опирается на', en: 'builds on', pl: 'opiera się na', color: '--inf' },
  HAS_ACTOR: { ru: 'с участием', en: 'has actor', pl: 'z udziałem', color: '--t2' },
  RELIEVES: { ru: 'снимает боль', en: 'relieves', pl: 'łagodzi ból', color: '--suc' },
  ADDRESSES: { ru: 'адресует боль', en: 'addresses', pl: 'odpowiada na ból', color: '--suc' },
  PROMISES: { ru: 'обещает выгоду', en: 'promises', pl: 'obiecuje korzyść', color: '--suc' },
  DELIVERS: { ru: 'даёт выгоду', en: 'delivers', pl: 'daje korzyść', color: '--suc' },
  PERFORMS: { ru: 'выполняет работу', en: 'performs', pl: 'wykonuje pracę', color: '--inf' },
  HELPS_WITH: { ru: 'помогает с работой', en: 'helps with', pl: 'pomaga w pracy', color: '--inf' },
  FELT_BY: { ru: 'ощущает', en: 'felt by', pl: 'odczuwany przez', color: '--wrn' },
  PERFORMED_BY: { ru: 'выполняется', en: 'performed by', pl: 'wykonywane przez', color: '--t2' },
  SUCCESS_OF: { ru: 'успех работы', en: 'success of', pl: 'sukces pracy', color: '--suc' },
  DESIRED_BY: { ru: 'желанно для', en: 'desired by', pl: 'pożądane przez', color: '--t2' },
  // S5-10 (приёмка 14.11): все остальные типы рёбер сервера — модель и схема. Раньше их не
  // было, и легенда графа показывала код (DOCUMENTED_IN, PARENT_OF). Полноту держит
  // loreEdges.test.ts по реестрам сервера; код остаётся подсказкой (title) чипа легенды.
  // Документирование, иерархия, состав
  DOCUMENTED_IN: { ru: 'описан в', en: 'documented in', pl: 'opisany w', color: '--wrn' },
  PARENT_OF: { ru: 'родитель для', en: 'parent of', pl: 'nadrzędny dla', color: '--inf' },
  PARENT_PRODUCT: { ru: 'входит в продукт', en: 'parent product', pl: 'należy do produktu', color: '--inf' },
  DECOMPOSES_INTO: { ru: 'раскладывается на', en: 'decomposes into', pl: 'dzieli się na', color: '--inf' },
  INCLUDES: { ru: 'включает', en: 'includes', pl: 'zawiera', color: '--inf' },
  IN_PRODUCT: { ru: 'в продукте', en: 'in product', pl: 'w produkcie', color: '--inf' },
  IN_AREA: { ru: 'в области', en: 'in area', pl: 'w obszarze', color: '--inf' },
  SERVES: { ru: 'обслуживает', en: 'serves', pl: 'obsługuje', color: '--inf' },
  USES: { ru: 'использует', en: 'uses', pl: 'używa', color: '--inf' },
  FORMALIZED_AS: { ru: 'оформлено как', en: 'formalized as', pl: 'sformalizowane jako', color: '--acc' },
  // Планирование и поставка
  TARGETS_MILESTONE: { ru: 'к вехе', en: 'targets milestone', pl: 'do kamienia milowego', color: '--acc' },
  TARGETS_PRODUCT: { ru: 'для продукта', en: 'targets product', pl: 'dla produktu', color: '--acc' },
  ON_MILESTONE: { ru: 'на вехе', en: 'on milestone', pl: 'na kamieniu milowym', color: '--acc' },
  // MDL-13 «треки б»: трек спринта — историчное ребро спринт → трек.
  ON_TRACK: { ru: 'на треке', en: 'on track', pl: 'na ścieżce', color: '--acc' },
  SHIPPED_IN: { ru: 'вошло в релиз', en: 'shipped in', pl: 'weszło do wydania', color: '--suc' },
  RELEASED_IN: { ru: 'выпущено в', en: 'released in', pl: 'wydane w', color: '--suc' },
  CLOSED_BY: { ru: 'закрыто PR', en: 'closed by', pl: 'zamknięte przez PR', color: '--suc' },
  CHANGED_IN: { ru: 'изменено в', en: 'changed in', pl: 'zmienione w', color: '--t2' },
  EDITED_IN: { ru: 'правилось в', en: 'edited in', pl: 'edytowane w', color: '--t2' },
  PRODUCED: { ru: 'произвело', en: 'produced', pl: 'wytworzyło', color: '--suc' },
  PRODUCED_BY: { ru: 'подготовлено в', en: 'produced by', pl: 'przygotowane w', color: '--suc' },
  YIELDED: { ru: 'дало', en: 'yielded', pl: 'dało', color: '--suc' },
  // Качество
  VALIDATES: { ru: 'проверяет', en: 'validates', pl: 'sprawdza', color: '--wrn' },
  MEASURED_BY: { ru: 'измеряется', en: 'measured by', pl: 'mierzone przez', color: '--wrn' },
  PROMOTED_TO: { ru: 'переведено в', en: 'promoted to', pl: 'przeniesione do', color: '--wrn' },
  LED_TO: { ru: 'привело к', en: 'led to', pl: 'doprowadziło do', color: '--wrn' },
  // Люди, агенты, роли, машины
  OWNED_BY: { ru: 'владелец', en: 'owned by', pl: 'właściciel', color: '--t2' },
  HAS_PROJECT_ROLE: { ru: 'роль в проекте', en: 'has project role', pl: 'rola w projekcie', color: '--t2' },
  ROLE_HELD_BY: { ru: 'роль у', en: 'role held by', pl: 'rolę pełni', color: '--t2' },
  // MT-MCP-TRUTH A6: ответственный вопроса — ребро к человеку или агенту реестра.
  ANSWERABLE_BY: { ru: 'ответственный', en: 'answerable by', pl: 'odpowiedzialny', color: '--t2' },
  FILLS_ROLE: { ru: 'исполняет роль', en: 'fills role', pl: 'pełni rolę', color: '--t2' },
  LOGGED_BY: { ru: 'записано агентом', en: 'logged by', pl: 'zapisane przez agenta', color: '--t2' },
  USES_MACHINE: { ru: 'работает на машине', en: 'uses machine', pl: 'pracuje na maszynie', color: '--t2' },
  MACHINE_ACCESS: { ru: 'доступ к машине', en: 'machine access', pl: 'dostęp do maszyny', color: '--t2' },
  // Файлы и публикации BRAGI
  ATTACHED_TO: { ru: 'с вложением', en: 'attached to', pl: 'z załącznikiem', color: '--t2' },
  HAS_ASSET: { ru: 'с файлом', en: 'has asset', pl: 'z plikiem', color: '--t2' },
  SOURCED_FROM: { ru: 'взято из', en: 'sourced from', pl: 'pochodzi z', color: '--t2' },
  HAS_VARIANT: { ru: 'с вариацией', en: 'has variant', pl: 'z wariantem', color: '--inf' },
  FOR_VARIANT: { ru: 'для вариации', en: 'for variant', pl: 'dla wariantu', color: '--inf' },
  IN_CHANNEL: { ru: 'в канале', en: 'in channel', pl: 'w kanale', color: '--inf' },
  IN_RUBRIC: { ru: 'в рубрике', en: 'in rubric', pl: 'w rubryce', color: '--inf' },
  TARGETS_KEY: { ru: 'на ключевое слово', en: 'targets keyword', pl: 'na słowo kluczowe', color: '--inf' },
  TARGETS_PAGE: { ru: 'на страницу', en: 'targets page', pl: 'na stronę', color: '--inf' },
  // Структурные: принадлежность и иерархия
  HAS_STATE: { ru: 'версия записи', en: 'has state', pl: 'wersja rekordu', color: '--t3', layer: S },
  BELONGS_TO_PROJECT: { ru: 'в проекте', en: 'in project', pl: 'w projekcie', color: '--t3', layer: S },
  // D-2026-MIG-REPOSITORY-ORGANIZATION: репозитории и организации (решение владелицы 19.11.2026)
  HAS_REPOSITORY: { ru: 'основной репозиторий', en: 'primary repository', pl: 'główne repozytorium', color: '--inf' },
  // ADR-LORE-066: релиз принадлежит репозиторию
  RELEASE_OF: { ru: 'релиз репозитория', en: 'release of repository', pl: 'wydanie repozytorium', color: '--inf' },
  PR_OF: { ru: 'PR репозитория', en: 'PR of repository', pl: 'PR repozytorium', color: '--inf' },
  COMPONENT_REPOSITORY: { ru: 'репозиторий компонента', en: 'component repository', pl: 'repozytorium komponentu', color: '--inf' },
  MIRRORED_TO: { ru: 'зеркало', en: 'mirrored to', pl: 'kopia lustrzana', color: '--t2' },
  USES_REPOSITORY: { ru: 'использует', en: 'uses', pl: 'używa', color: '--t2' },
  ORG_HAS_PROJECT: { ru: 'проект организации', en: 'organization project', pl: 'projekt organizacji', color: '--t2' },
  ORG_HAS_PRODUCT: { ru: 'продукт организации', en: 'organization product', pl: 'produkt organizacji', color: '--t2' },
  ORG_HAS_REPOSITORY: { ru: 'репозиторий организации', en: 'organization repository', pl: 'repozytorium organizacji', color: '--t2' },
  ORG_MEMBER: { ru: 'в организации', en: 'organization member', pl: 'w organizacji', color: '--t2' },
  BELONGS_TO: { ru: 'принадлежит', en: 'belongs to', pl: 'należy do', color: '--t3', layer: S },
  PART_OF: { ru: 'входит в', en: 'part of', pl: 'wchodzi w skład', color: '--t3', layer: S },
  IN_PHASE: { ru: 'в фазе', en: 'in phase', pl: 'w fazie', color: '--t3', layer: S },
  TAGGED_WITH: { ru: 'с тегом', en: 'tagged with', pl: 'z tagiem', color: '--t3', layer: S },
  DOC_CHILD_OF: { ru: 'дочерний документ', en: 'child doc of', pl: 'dokument podrzędny', color: '--t3', layer: S },
  // SPRINT_LORE_KNOW_REGISTRY/SKILL-02 (SPEC-SKILLS-TAGS-062 §6): рёбра вида skill:*.
  APPLIES_TO_ROLE: { ru: 'для роли', en: 'applies to role', pl: 'dla roli', color: '--inf' },
  SKILL_EXTENDS: { ru: 'уточняет скилл', en: 'extends skill', pl: 'doprecyzowuje skill', color: '--inf' },
};

export const LORE_STRUCTURAL_EDGES: ReadonlySet<string> = new Set(
  Object.entries(LORE_EDGE_TYPES).filter(([, e]) => e.layer === S).map(([t]) => t),
);

/** Язык подписи ребра: языки kit и польский (KREG-10; в KitLang его пока нет). */
export type LoreEdgeLang = KitLang | 'pl';

export function loreEdgeLabel(lang: LoreEdgeLang, type: string): string {
  const e = LORE_EDGE_TYPES[type];
  if (!e) return type;
  if (lang === 'pl') return e.pl?.trim() ? e.pl : e.en;
  return lang === 'en' ? e.en : e.ru;
}

/** config.edges для kit (подпись, цвет, слой) на выбранном языке. */
export function loreEdgesConfig(lang: KitLang): NonNullable<KitConfig['edges']> {
  const out: NonNullable<KitConfig['edges']> = {};
  for (const [type, e] of Object.entries(LORE_EDGE_TYPES)) {
    out[type] = e.layer ? { label: loreEdgeLabel(lang, type), color: e.color, layer: e.layer } : { label: loreEdgeLabel(lang, type), color: e.color };
  }
  return out;
}
