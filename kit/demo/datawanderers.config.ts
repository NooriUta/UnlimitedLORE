// Пилот-конфиг «Дата-странников» (методотдел), приведённый к КОНТРАКТУ ЯДРА
// kit (kit/src/core/contract.ts). Источник: репо AIDA/Datawanderers-ServerandLore,
// ветка feat/content-admin, tools/proto/seidr-kit.config.example.js, коммит
// 5645dbb (PR #25), снят с их рабочего прототипа method.tpl.html. Их репо не
// меняем — расхождения формы перечислены здесь, а не исправлены у них.
//
// Что поменялось при приведении к контракту:
//  - modules/menu: key → id; у модуля обязательна иконка (game-icons);
//    пункт меню-строка 'Quiz' → {id:'Quiz', title, view:'Quiz'};
//  - tone и цвета рёбер — имена токенов Seiðr (var(--acc)…). У них есть
//    '--vio', которого в Seiðr нет: такие рёбра/группы — нейтральный var(--t2);
//  - statuses: field 'review.status' → статус записи (KitRecord.status), их
//    категория 'open' → 'todo'; символы ○ ✗ ✓ → слаги game-icons;
//  - verdict: сервер считает (ADR-LORE-039), kit только читает
//    fields.verdict и приводит к KitVerdict (failed/hints — коды);
//  - list.quick: строка-фильтр 'rv:fix' → KitFilter {status:'fix'};
//    'bad' → {'fields.quality':'bad'}; 'rv:edit' → {'fields.has_edit':'yes'};
//  - list.groups (словарь подписей) → groupings (ключи полей);
//  - не вошло в контракт (остаётся за K-04…K-07): overview-строки ('quiz',
//    'lanes'…), edit, summary, storage, export, palette.hotkey, robust.
import type { KitConfig, KitRecord, KitVerdict } from '../src/core/contract';

const NEUTRAL = 'var(--t2)';

function kind(title: string, icon: string): KitConfig['kinds'][string] {
  return { title, icon };
}

/** Вердикт сервера из fields.verdict; нет поля — «проверок нет» (0 из 0), а не «ок». */
export function datawanderersVerdict(r: KitRecord): KitVerdict {
  const v = r.fields.verdict as { score?: number; max?: number; failed?: { code: string }[]; hints?: { code: string }[] } | undefined;
  return {
    score: v?.score ?? 0,
    max: v?.max ?? 0,
    failed: (v?.failed ?? []).map(f => f.code),
    hints: (v?.hints ?? []).map(h => h.code),
  };
}

export const datawanderersConfig: KitConfig = {
  modules: [
    { id: 'method', title: 'Методология', icon: 'scroll-unfurled', status: 'active' },
    { id: 'test', title: 'Тестирование', icon: 'test-tubes', status: 'planned' },
  ],
  menu: {
    myViews: true,
    recent: true,
    groups: [
      { id: 'analytics', title: 'Аналитика', tone: 'var(--inf)', items: [{ id: 'home', title: 'Сводка · требует внимания', icon: 'magnifying-glass', view: 'summary' }] },
      { id: 'review', title: 'Согласование', tone: 'var(--wrn)', items: [{ id: 'review', title: 'Очередь и мои правки', icon: 'stamper', view: 'queue' }] },
      {
        id: 'mechanics', title: 'Механика', tone: 'var(--acc)',
        items: ['Rule', 'Trail', 'Quiz', 'Scroll', 'Rune', 'Porcha', 'SchoolStep'].map(k => ({ id: k, title: k, view: k })),
      },
      {
        id: 'knowledge', title: 'Знание', tone: 'var(--suc)',
        items: ['Topic', 'Item', 'ItemTemplate', 'ErrorPattern', 'Author'].map(k => ({ id: k, title: k, view: k })),
      },
      { id: 'world', title: 'Мир', tone: NEUTRAL, items: ['Dream', 'Wanderer', 'Quest'].map(k => ({ id: k, title: k, view: k })) },
    ],
  },
  kinds: {
    Quiz: kind('Квизы', 'perspective-dice-six-faces-random'),
    Scroll: kind('Свитки', 'scroll-unfurled'),
    Trail: kind('Тропы', 'trail'),
    Rule: kind('Правила игры', 'scales'),
    Topic: kind('Темы', 'book-cover'),
    Item: kind('Задания', 'checkbox-tree'),
    ItemTemplate: kind('Шаблоны', 'stamper'),
    ErrorPattern: kind('Типичные ошибки', 'cross-mark'),
    Author: kind('Авторы', 'quill-ink'),
    Rune: kind('Руны', 'rune-stone'),
    Porcha: kind('Порчи', 'poison-bottle'),
    SchoolStep: kind('Ступени школы', 'stairs'),
    Dream: kind('Сны', 'night-sleep'),
    Wanderer: kind('Странники', 'walking-boot'),
    Quest: kind('Квесты', 'treasure-map'),
  },
  edges: {
    PREREQ: { label: 'требует', color: 'var(--acc)' },
    SUBTOPIC: { label: 'подтема', color: NEUTRAL },
    ENCODES: { label: 'руна темы', color: NEUTRAL },
    ASSESSES: { label: 'проверяет', color: 'var(--suc)' },
    FROM_TEMPLATE: { label: 'из шаблона', color: NEUTRAL },
    KNOWS_ERROR: { label: 'знает ошибку', color: NEUTRAL },
    CONTRIBUTED: { label: 'вклад автора', color: 'var(--inf)' },
    REFLECTS: { label: 'отражение автора', color: NEUTRAL },
    HOME: { label: 'сон-дом', color: NEUTRAL },
    HAS_ITEM: { label: 'задание квеста', color: NEUTRAL },
    HAUNTS: { label: 'порча сна', color: NEUTRAL },
    QUIZ_OF: { label: 'квиз руны', color: 'var(--wrn)' },
    SCROLL_OF: { label: 'свиток темы', color: 'var(--wrn)' },
    TRAIL_END: { label: 'конец тропы', color: NEUTRAL },
    ON_TRAIL: { label: 'на тропе', color: 'var(--wrn)' },
  },
  graph: { depth: 2, limit: 60, colorBy: 'verdict' },
  statuses: {
    items: [
      { code: '', title: 'не смотрели', category: 'todo', icon: 'empty-hourglass', color: 'var(--t3)', hotkey: 'Digit1' },
      { code: 'fix', title: 'нужна правка', category: 'active', icon: 'cross-mark', color: 'var(--dng)', hotkey: 'Digit2' },
      { code: 'ok', title: 'согласовано', category: 'done', icon: 'laurel-crown', color: 'var(--suc)', hotkey: 'Digit3' },
    ],
    undo: true,
    bulk: true,
  },
  verdict: datawanderersVerdict,
  list: {
    views: ['list', 'board'],
    quick: [
      { id: 'bad', title: 'есть провалы качества', filter: { 'fields.quality': 'bad' } },
      { id: 'rv-fix', title: 'нужна правка', filter: { status: 'fix' } },
      { id: 'rv-none', title: 'ещё не смотрели', filter: { status: '' } },
      { id: 'rv-edit', title: 'с предложенной правкой', filter: { 'fields.has_edit': 'yes' } },
      { id: 'rv-ok', title: 'согласовано', filter: { status: 'ok' } },
    ],
    filters: ['kind', 'status', 'fields.quality', 'fields.disc'],
    groupings: ['status', 'kind', 'fields.disc'],
    columns: ['select', 'title+id', 'verdict', 'status', 'edges_count'],
  },
};
