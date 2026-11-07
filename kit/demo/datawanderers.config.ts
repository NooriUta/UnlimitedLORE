// Пилот-конфиг «Дата-странников · Методология» под контракт kit
// (SPRINT_UXR_S10_SEIDR_KIT/K-01). Источник — их пример
// tools/proto/seidr-kit.config.example.js (репо AIDA/Datawanderers-ServerandLore,
// ветка feat/content-admin, коммит 5645dbb); их репо не меняется, здесь —
// приведение к kit/src/core/contract.ts.
//
// Что поменялось при приведении (и почему):
//  - modules[].key → id; menu.groups[] получили id; пункт-строка 'Quiz' →
//    {id:'Quiz', title} — id совпадает с ключом kinds, значит пункт ведёт в список вида;
//  - tone/цвет '--inf' → 'var(--inf)'; '--vio' в теме Seiðr нет → 'var(--st-design)'
//    (фиолетовый оттенок палитры статусов); рёбра без цвета → 'var(--t2)';
//  - statuses: field 'review.status' → KitRecord.status; пустой код '' («не смотрели»)
//    → 'none' (код попадает в URL и фильтры); category open → todo; глифы ○✗✓ → слаги
//    game-icons; «порядок = клавиши 1…N» → явные hotkey '1'..'3';
//  - verdict {field:'verdict', shape} → функция, читающая fields.verdict (считает сервер);
//    failed/hints [{code,message}] → коды (контракт: string[]);
//  - list.quick {f:'rv:fix'} → {id, title, filter:{status:'fix'}}; groups → groupings;
//  - graph {depth:[1,2], cap:60, color} → {depth:2, limit:60, colorBy}.
// Не вошло в контракт (kit их не прочтёт, валидатор пометил бы unknown-key):
//  app.title/theme, menu.module/top/counter, kinds.*.edit/defaultEdit/lanes/group,
//  summary.worklists, edit.confirm/who, storage, export, palette.hotkey/search/cap,
//  robust — список предложений к контракту в spec:SPEC-SEIDR-KIT-CONFIG.
import type { KindConfig, KitConfig, KitRecord, KitVerdict } from '../src/core/contract';

/** Вердикт считает сервер (ADR-LORE-039); kit только читает fields.verdict. */
export function dwVerdict(r: KitRecord): KitVerdict {
  const v = r.fields.verdict as
    | { score?: number; max?: number; failed?: { code: string }[]; hints?: { code: string }[] }
    | undefined;
  if (!v) return { score: 0, max: 0, failed: [], hints: [] };
  return {
    score: v.score ?? 0,
    max: v.max ?? 0,
    failed: (v.failed ?? []).map((f) => f.code),
    hints: (v.hints ?? []).map((h) => h.code),
  };
}

const LETTERS = 'ABCDEFGH';

/** Обзор квиза: вопрос, варианты, верный ✓. */
function quizOverview(r: KitRecord): string {
  const options = Array.isArray(r.fields.options) ? (r.fields.options as string[]) : [];
  const answer = String(r.fields.answer ?? '');
  const lines = options.map((o, i) => `- ${LETTERS[i]}. ${o}${LETTERS[i] === answer ? ' ✓' : ''}`);
  return [`**${String(r.fields.question ?? r.title)}**`, '', ...lines].join('\n');
}

/** Обзор тропы: три полосы — у сна A, стык снов, у сна B. */
function trailOverview(r: KitRecord): string {
  const a = String(r.fields.dreamA ?? '?');
  const b = String(r.fields.dreamB ?? '?');
  return `у сна «${a}» · стык снов · у сна «${b}»`;
}

const plain = (title: string, icon: string): KindConfig => ({
  title, icon, fields: [{ key: 'summary', title: 'Описание', type: 'text' }],
});

export const datawanderersConfig: KitConfig = {
  modules: [
    { id: 'method', title: 'Методология', icon: 'spell-book', status: 'active' },
    { id: 'test', title: 'Тестирование', icon: 'crystal-ball', status: 'planned' },
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
      { id: 'review', title: 'Согласование', tone: 'var(--wrn)', items: [{ id: 'queue', title: 'Очередь и мои правки', icon: 'scales', view: 'queue' }] },
      {
        id: 'mechanics', title: 'Механика', tone: 'var(--acc)',
        items: [
          { id: 'Rule', title: 'Правила игры' }, { id: 'Trail', title: 'Тропы' }, { id: 'Quiz', title: 'Квизы' },
          { id: 'Scroll', title: 'Свитки' }, { id: 'Rune', title: 'Руны' }, { id: 'Porcha', title: 'Порчи' },
          { id: 'SchoolStep', title: 'Ступени школы' },
        ],
      },
      {
        id: 'knowledge', title: 'Знание', tone: 'var(--suc)',
        items: [
          { id: 'Topic', title: 'Темы' }, { id: 'Item', title: 'Задания' }, { id: 'ItemTemplate', title: 'Шаблоны' },
          { id: 'ErrorPattern', title: 'Типичные ошибки' }, { id: 'Author', title: 'Авторы' },
        ],
      },
      {
        id: 'world', title: 'Мир', tone: 'var(--st-design)',
        items: [{ id: 'Dream', title: 'Сны' }, { id: 'Wanderer', title: 'Странники' }, { id: 'Quest', title: 'Квесты' }],
      },
    ],
  },
  kinds: {
    Quiz: {
      title: 'Квизы', icon: 'puzzle',
      overview: (r) => quizOverview(r),
      tabs: [{ key: 'play', title: 'Сыграть', render: (r) => quizOverview(r) }],
      fields: [
        { key: 'question', title: 'Вопрос', type: 'text' },
        { key: 'options', title: 'Варианты', type: 'text' },
        { key: 'hints', title: 'Подсказки к неверным', type: 'text' },
        { key: 'answer', title: 'Верный ответ (буква)', type: 'enum' },
      ],
    },
    Scroll: {
      title: 'Свитки', icon: 'scroll-unfurled',
      overview: (r, ctx) => ctx.md(String(r.fields.text_md ?? '')),
      tabs: [{ key: 'play', title: 'Прочесть', render: (r, ctx) => ctx.md(String(r.fields.text_md ?? '')) }],
      fields: [
        { key: 'text_md', title: 'Текст', type: 'md' },
        { key: 'tell_correct', title: '«О чём» (верное)', type: 'text' },
      ],
    },
    Trail: {
      title: 'Тропы', icon: 'trail',
      overview: (r) => trailOverview(r),
      fields: [{ key: 'dreamA', title: 'Сон A', type: 'ref' }, { key: 'dreamB', title: 'Сон B', type: 'ref' }],
    },
    Rule: {
      title: 'Правила игры', icon: 'stone-tablet',
      fields: [{ key: 'doc_md', title: 'Пояснение', type: 'md' }, { key: 'value', title: 'Значение', type: 'number' }],
    },
    Topic: {
      title: 'Темы', icon: 'tree-branch',
      fields: [{ key: 'summary', title: 'Описание', type: 'text' }, { key: 'discipline', title: 'Ветка', type: 'enum' }],
    },
    Item: plain('Задания', 'targeted'),
    ItemTemplate: plain('Шаблоны', 'quill-ink'),
    ErrorPattern: plain('Типичные ошибки', 'broken-skull'),
    Author: plain('Авторы', 'quill'),
    Rune: plain('Руны', 'rune-stone'),
    Porcha: plain('Порчи', 'cursed-star'),
    SchoolStep: plain('Ступени школы', 'stairs-goal'),
    Dream: plain('Сны', 'dream-catcher'),
    Wanderer: plain('Странники', 'hood'),
    Quest: plain('Квесты', 'treasure-map'),
  },
  edges: {
    PREREQ: { label: 'требует', color: 'var(--acc)' },
    SUBTOPIC: { label: 'подтема', color: 'var(--t2)' },
    ENCODES: { label: 'руна темы', color: 'var(--st-design)' },
    ASSESSES: { label: 'проверяет', color: 'var(--suc)' },
    FROM_TEMPLATE: { label: 'из шаблона', color: 'var(--t2)' },
    KNOWS_ERROR: { label: 'знает ошибку', color: 'var(--t2)' },
    CONTRIBUTED: { label: 'вклад автора', color: 'var(--inf)' },
    REFLECTS: { label: 'отражение автора', color: 'var(--t2)' },
    HOME: { label: 'сон-дом', color: 'var(--t2)' },
    HAS_ITEM: { label: 'задание квеста', color: 'var(--t2)' },
    HAUNTS: { label: 'порча сна', color: 'var(--t2)' },
    QUIZ_OF: { label: 'квиз руны', color: 'var(--wrn)' },
    SCROLL_OF: { label: 'свиток темы', color: 'var(--wrn)' },
    TRAIL_END: { label: 'конец тропы', color: 'var(--t2)' },
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
      { code: 'none', title: 'не смотрели', category: 'todo', icon: 'circle', color: 'var(--t3)', hotkey: '1', allow: ['fix', 'ok'] },
      { code: 'fix', title: 'нужна правка', category: 'active', icon: 'cancel', color: 'var(--dng)', hotkey: '2', allow: ['none', 'ok'] },
      { code: 'ok', title: 'согласовано', category: 'done', icon: 'check-mark', color: 'var(--suc)', hotkey: '3', allow: ['none', 'fix'] },
      { code: '', title: 'не смотрели', category: 'todo', icon: 'empty-hourglass', color: 'var(--t3)', hotkey: 'Digit1' },
      { code: 'fix', title: 'нужна правка', category: 'active', icon: 'cross-mark', color: 'var(--dng)', hotkey: 'Digit2' },
      { code: 'ok', title: 'согласовано', category: 'done', icon: 'laurel-crown', color: 'var(--suc)', hotkey: 'Digit3' },
    ],
    undo: true,
    bulk: true,
  },
  verdict: (r) => dwVerdict(r),
  list: {
    views: ['list', 'board'],
    quick: [
      { id: 'bad', title: 'есть провалы качества', filter: { quality: 'bad' } },
      { id: 'rv-fix', title: 'нужна правка', filter: { status: 'fix' } },
      { id: 'rv-none', title: 'ещё не смотрели', filter: { status: 'none' } },
      { id: 'rv-edit', title: 'с предложенной правкой', filter: { review: 'edit' } },
      { id: 'rv-ok', title: 'согласовано', filter: { status: 'ok' } },
    ],
    filters: ['quality', 'status', 'review'],
    groupings: ['quality', 'status', 'discipline'],
    columns: ['select', 'title', 'id', 'verdict', 'status', 'edges_count'],
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
