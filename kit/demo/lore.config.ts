// Пример конфига kit для LORE (SPRINT_UXR_S10_SEIDR_KIT/K-01).
// Виды записей — то, чем живёт LORE: задачи, спринты, ADR, решения, спеки.
// Иконки и цвета статусов — из таблицы v2 (kit/src/elements/statusMeta.ts),
// чтобы демо и экраны v2 не разошлись. Навигация — по смыслу (план / знание /
// контроль), а не по таблицам БД.
import type { KitConfig, KitRecord, KitVerdict } from '../src/core/contract';

/**
 * Вердикт LORE (ADR-LORE-039 — правила качества записи): у задачи есть
 * описание, оценка и привязка к спринту; у ADR и спеки — тело. Считается
 * на клиенте только в демо; в бою его отдаёт сервер в fields.verdict.
 */
export function loreVerdict(r: KitRecord): KitVerdict {
  const checks: [code: string, ok: boolean, hint?: boolean][] = [];
  const hasBody = typeof r.body_md === 'string' && r.body_md.trim() !== '';
  if (r.kind === 'task') {
    checks.push(['body', hasBody]);
    checks.push(['effort', typeof r.fields.effort_days === 'number']);
    checks.push(['sprint', typeof r.fields.sprint_id === 'string' && r.fields.sprint_id !== '']);
    checks.push(['component', typeof r.fields.component_id === 'string', true]);
  } else if (r.kind === 'adr' || r.kind === 'spec') {
    checks.push(['body', hasBody]);
    checks.push(['decisions', Array.isArray(r.fields.decision_ids) && r.fields.decision_ids.length > 0, true]);
  } else {
    checks.push(['title', r.title.trim() !== '']);
  }
  const hard = checks.filter(([, , hint]) => !hint);
  return {
    score: hard.filter(([, ok]) => ok).length,
    max: hard.length,
    failed: hard.filter(([, ok]) => !ok).map(([code]) => code),
    hints: checks.filter(([, ok, hint]) => hint && !ok).map(([code]) => code),
  };
}

export const loreConfig: KitConfig = {
  modules: [
    { id: 'forseti', title: 'Forseti', icon: 'scales', status: 'active' },
    { id: 'bragi', title: 'BRAGI', icon: 'harp', status: 'planned' },
  ],
  menu: {
    myViews: true,
    recent: true,
    groups: [
      {
        id: 'plan', title: 'План', tone: 'var(--acc)',
        items: [
          { id: 'sprint', title: 'Спринты', icon: 'sprint' },
          { id: 'task', title: 'Задачи', icon: 'checkbox-tree' },
        ],
      },
      {
        id: 'knowledge', title: 'Знание', tone: 'var(--suc)',
        items: [
          { id: 'adr', title: 'ADR', icon: 'scroll-quill' },
          { id: 'decision', title: 'Решения', icon: 'laurel-crown' },
          { id: 'spec', title: 'Спеки', icon: 'open-book' },
        ],
      },
      {
        id: 'control', title: 'Контроль', tone: 'var(--wrn)',
        items: [{ id: 'attention', title: 'Требует внимания', icon: 'magnifying-glass', view: 'summary' }],
      },
    ],
  },
  kinds: {
    task: {
      title: 'Задачи', icon: 'checkbox-tree',
      fields: [
        { key: 'sprint_id', title: 'Спринт', type: 'ref' },
        { key: 'component_id', title: 'Компонент', type: 'ref' },
        { key: 'effort_days', title: 'Оценка, дн', type: 'number' },
        { key: 'priority', title: 'Приоритет', type: 'enum' },
      ],
    },
    sprint: {
      title: 'Спринты', icon: 'sprint',
      fields: [
        { key: 'starts', title: 'Начало', type: 'date' },
        { key: 'ends', title: 'Конец', type: 'date' },
        { key: 'goal_md', title: 'Цель', type: 'md' },
      ],
    },
    adr: {
      title: 'ADR', icon: 'scroll-quill',
      fields: [{ key: 'context_md', title: 'Контекст', type: 'md' }],
    },
    decision: { title: 'Решения', icon: 'laurel-crown', fields: [{ key: 'rule', title: 'Правило', type: 'text' }] },
    spec: { title: 'Спеки', icon: 'open-book', fields: [{ key: 'version', title: 'Версия', type: 'text' }] },
  },
  edges: {
    IN_SPRINT: { label: 'в спринте', color: 'var(--acc)' },
    DEPENDS_ON: { label: 'зависит от', color: 'var(--wrn)' },
    DECIDED_IN: { label: 'решено в', color: 'var(--suc)' },
    DOCUMENTED_IN: { label: 'описано в', color: 'var(--inf)' },
  },
  graph: { depth: 2, limit: 60, colorBy: 'verdict' },
  statuses: {
    items: [
      { code: 'backlog', title: 'Бэклог', category: 'todo', icon: 'tied-scroll', color: 'var(--st-backlog)', hotkey: '1', allow: ['todo', 'cancelled'] },
      { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: 'var(--st-todo)', hotkey: '2', allow: ['in_progress', 'blocked', 'cancelled'] },
      { code: 'in_progress', title: 'В работе', category: 'active', icon: 'progression', color: 'var(--st-active)', hotkey: '3', allow: ['done', 'blocked', 'todo'] },
      { code: 'blocked', title: 'Заблокировано', category: 'active', icon: 'handcuffed', color: 'var(--st-blocked)', hotkey: '4', allow: ['in_progress', 'cancelled'] },
      { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)', hotkey: '5', allow: ['in_progress'] },
      { code: 'cancelled', title: 'Отменено', category: 'cancelled', icon: 'cross-mark', color: 'var(--st-cancelled)', hotkey: '6', allow: ['backlog'] },
    ],
    // →done у LORE идёт через reviewer-гейт: себе не одобряют.
    selfApprove: false,
    undo: true,
    bulk: true,
  },
  roles: {
    owner: { canEdit: true, canStatus: true },
    agent: { canEdit: true, canStatus: true },
    viewer: { canEdit: false, canStatus: false },
  },
  verdict: (r) => loreVerdict(r),
  list: {
    views: ['list', 'board', 'tree'],
    quick: [
      { id: 'mine-active', title: 'В работе', filter: { status: 'in_progress' } },
      { id: 'blocked', title: 'Заблокировано', filter: { status: 'blocked' } },
      { id: 'bad', title: 'Есть провалы качества', filter: { quality: 'bad' } },
    ],
    filters: ['status', 'kind', 'quality', 'sprint_id', 'component_id'],
    groupings: ['status', 'kind', 'sprint_id'],
    columns: ['title', 'id', 'verdict', 'status', 'updated_at'],
    tree: { parent: 'sprint_id', order: 'priority', rollup: 'status' },
  },
  palette: {
    commands: [{ id: 'open-kit', title: 'Открыть витрину kit', run: (ctx) => { void ctx.href('kit'); } }],
  },
};
