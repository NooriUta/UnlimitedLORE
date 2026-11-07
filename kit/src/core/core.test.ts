// K-01: схема конфига и формат данных kit (window.X_DATA) — валидатор, JSON-схема
// и два примера (LORE, «Дата-странники»). Тесты пишутся раньше кода: каждое
// правило валидатора проверено и на «ловит», и на «пропускает чистое».
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  KIT_COLOR_TOKENS,
  KIT_CONFIG_SCHEMA,
  KIT_DATA_SCHEMA,
  readKitData,
  validateKitConfig,
  validateKitData,
  type KitConfig,
  type KitData,
} from './index';
import { loreConfig } from '../../demo/lore.config';
import { loreData } from '../../demo/lore.data';
import { datawanderersConfig } from '../../demo/datawanderers.config';
import { datawanderersData } from '../../demo/datawanderers.data';

const require = createRequire(import.meta.url);
const iconSet = require('@iconify-json/game-icons/icons.json') as { icons: Record<string, unknown>; aliases?: Record<string, unknown> };
const iconExists = (slug: string) => slug in iconSet.icons || slug in (iconSet.aliases ?? {});

const codes = (v: { errors: { code: string }[] }) => v.errors.map((e) => e.code);
const warnCodes = (v: { warnings: { code: string }[] }) => v.warnings.map((e) => e.code);

/** Минимальный корректный конфиг — база для «сломай одно поле». */
function minimalConfig(): KitConfig {
  return {
    modules: [{ id: 'm', title: 'Модуль', icon: 'compass' }],
    menu: { groups: [{ id: 'g', title: 'Группа', items: [{ id: 'task', title: 'Задачи' }] }] },
    kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
    statuses: {
      items: [
        { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: 'var(--st-todo)', allow: ['done'] },
        { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)' },
      ],
    },
  };
}

function minimalData(): KitData {
  return {
    records: [{ id: 'T-1', kind: 'task', title: 'Первая', status: 'todo', fields: {} }],
    edges: [],
    journal: [],
    meta: { generated_at: '2026-11-07T10:00:00Z', total: 1, returned: 1 },
  };
}

describe('K-01 · валидатор конфига', () => {
  it('минимальный конфиг проходит без ошибок и предупреждений', () => {
    const v = validateKitConfig(minimalConfig());
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('не объект — одна понятная ошибка, а не падение', () => {
    for (const bad of [null, undefined, 42, 'cfg', []]) {
      const v = validateKitConfig(bad);
      expect(v.ok).toBe(false);
      expect(codes(v)).toContain('type');
    }
  });

  it('обязательные разделы: modules, menu, kinds, statuses', () => {
    for (const key of ['modules', 'menu', 'kinds', 'statuses'] as const) {
      const cfg = minimalConfig() as unknown as Record<string, unknown>;
      delete cfg[key];
      const v = validateKitConfig(cfg);
      expect(v.ok, key).toBe(false);
      expect(v.errors.some((e) => e.path === key && e.code === 'required'), key).toBe(true);
    }
  });

  it('цвет — только токен var(--…): сырой hex и неизвестный токен отбиваются', () => {
    const cfg = minimalConfig();
    cfg.statuses.items[0].color = '#ff0000';
    cfg.menu.groups[0].tone = 'var(--nope)';
    cfg.edges = { DEP: { label: 'зависит', color: 'red' } };
    const v = validateKitConfig(cfg);
    expect(v.errors.filter((e) => e.code === 'color-token').map((e) => e.path).sort()).toEqual([
      'edges.DEP.color', 'menu.groups[0].tone', 'statuses.items[0].color',
    ]);
    expect(KIT_COLOR_TOKENS).toContain('acc');
  });

  it('иконка — слаг game-icons; при переданной проверке — ещё и существующий', () => {
    const cfg = minimalConfig();
    cfg.modules[0].icon = '✓';
    cfg.kinds.task.icon = 'no-such-icon-anywhere';
    expect(codes(validateKitConfig(cfg))).toContain('icon-slug');
    const v = validateKitConfig(cfg, { iconExists });
    expect(v.errors.find((e) => e.path === 'kinds.task.icon')?.code).toBe('icon-missing');
  });

  it('статусы: код уникален, URL-безопасен, непуст; allow ссылается на свои коды; горячие клавиши не повторяются', () => {
    const cfg = minimalConfig();
    cfg.statuses.items.push({ code: 'done', title: 'Дубль', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)' });
    cfg.statuses.items.push({ code: '', title: 'Пусто', category: 'todo', icon: 'circle', color: 'var(--t3)' });
    cfg.statuses.items[0].allow = ['done', 'ghost'];
    cfg.statuses.items[0].hotkey = '1';
    cfg.statuses.items[1].hotkey = '1';
    const c = codes(validateKitConfig(cfg));
    expect(c).toEqual(expect.arrayContaining(['duplicate', 'status-code', 'unknown-ref', 'duplicate-hotkey']));
  });

  it('категория статуса и вид списка — из перечня контракта', () => {
    const cfg = minimalConfig() as unknown as { statuses: { items: { category: string }[] }; list: unknown };
    cfg.statuses.items[0].category = 'open';
    cfg.list = { views: ['list', 'kanban'] };
    const v = validateKitConfig(cfg);
    expect(v.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['statuses.items[0].category', 'list.views[1]']));
  });

  it('вид tree требует list.tree и наоборот', () => {
    const cfg = minimalConfig();
    cfg.list = { views: ['tree'] };
    expect(codes(validateKitConfig(cfg))).toContain('tree-config');
    cfg.list = { views: ['list'], tree: { parent: 'parent', order: 'order' } };
    expect(warnCodes(validateKitConfig(cfg))).toContain('tree-unused');
  });

  it('пункт меню: либо вид записей (ключ kinds), либо явный view; id меню уникальны', () => {
    const cfg = minimalConfig();
    cfg.menu.groups[0].items.push({ id: 'ghost', title: 'Призрак' });
    cfg.menu.groups.push({ id: 'g', title: 'Дубль', items: [{ id: 'task', title: 'Снова задачи' }] });
    const v = validateKitConfig(cfg);
    expect(warnCodes(v)).toContain('menu-target');
    expect(codes(v)).toContain('duplicate');
  });

  it('функции (verdict, overview, tabs.render, palette.run, hooks) должны быть функциями', () => {
    const cfg = minimalConfig() as unknown as Record<string, unknown> & { kinds: Record<string, Record<string, unknown>> };
    cfg.verdict = 'server';
    cfg.kinds.task.overview = 42;
    cfg.kinds.task.tabs = [{ key: 'a', title: 'A', render: 'x' }];
    cfg.palette = { commands: [{ id: 'c', title: 'C', run: null }] };
    cfg.hooks = { onSave: true };
    const paths = validateKitConfig(cfg).errors.filter((e) => e.code === 'function').map((e) => e.path).sort();
    expect(paths).toEqual(['hooks.onSave', 'kinds.task.overview', 'kinds.task.tabs[0].render', 'palette.commands[0].run', 'verdict']);
  });

  it('overview строкой допустим (контракт: ReactNode|string — возвращает функция, но и готовая строка честна)', () => {
    const cfg = minimalConfig() as unknown as { kinds: Record<string, Record<string, unknown>> };
    cfg.kinds.task.overview = 'quiz';
    expect(validateKitConfig(cfg).errors.filter((e) => e.code === 'function')).toEqual([]);
  });

  it('поля вида: тип из перечня, ключи уникальны', () => {
    const cfg = minimalConfig() as unknown as { kinds: Record<string, Record<string, unknown>> };
    cfg.kinds.task.fields = [
      { key: 'a', title: 'A', type: 'text' },
      { key: 'a', title: 'A2', type: 'md' },
      { key: 'b', title: 'B', type: 'html' },
    ];
    const c = codes(validateKitConfig(cfg));
    expect(c).toEqual(expect.arrayContaining(['duplicate', 'enum']));
  });

  it('graph: depth 1..3, limit — целое > 0', () => {
    const cfg = minimalConfig() as unknown as Record<string, unknown>;
    cfg.graph = { depth: 4, limit: 0 };
    expect(validateKitConfig(cfg).errors.map((e) => e.path).sort()).toEqual(['graph.depth', 'graph.limit']);
  });

  it('неизвестный ключ верхнего уровня — предупреждение (дрейф от контракта виден, а не тонет)', () => {
    const cfg = { ...minimalConfig(), storage: { key: 'x' } };
    const v = validateKitConfig(cfg);
    expect(v.ok).toBe(true);
    expect(v.warnings.find((w) => w.code === 'unknown-key')?.path).toBe('storage');
  });
});

describe('K-01 · валидатор данных (window.X_DATA)', () => {
  it('минимальные данные проходят', () => {
    const v = validateKitData(minimalData(), minimalConfig());
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it('обязательные блоки records/edges/journal/meta и generated_at', () => {
    const d = minimalData() as unknown as Record<string, unknown>;
    delete d.journal;
    (d.meta as Record<string, unknown>).generated_at = undefined;
    const paths = validateKitData(d).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['journal', 'meta.generated_at']));
  });

  it('запись: id уникален, fields — объект; лишний ключ верхнего уровня — предупреждение «положи в fields»', () => {
    const d = minimalData() as unknown as { records: Record<string, unknown>[] };
    d.records.push({ id: 'T-1', kind: 'task', title: 'Дубль', status: 'todo', fields: [] , summary: 'x' });
    const v = validateKitData(d);
    expect(codes(v)).toEqual(expect.arrayContaining(['duplicate', 'type']));
    expect(v.warnings.find((w) => w.code === 'unknown-key')?.path).toBe('records[1].summary');
  });

  it('против конфига: неизвестный вид, статус, тип ребра и висячее ребро — предупреждения', () => {
    const d = minimalData();
    d.records.push({ id: 'X-1', kind: 'alien', title: 'Чужой', status: 'weird', fields: {} });
    d.edges.push({ from: 'T-1', to: 'NOPE', type: 'DEP' });
    const w = warnCodes(validateKitData(d, minimalConfig()));
    expect(w).toEqual(expect.arrayContaining(['unknown-kind', 'unknown-status', 'unknown-edge-type', 'dangling-edge']));
  });

  it('meta.returned расходится с числом записей — предупреждение; truncated без total — тоже', () => {
    const d = minimalData();
    d.meta = { generated_at: '2026-11-07T10:00:00Z', returned: 5, truncated: true };
    const w = warnCodes(validateKitData(d));
    expect(w).toEqual(expect.arrayContaining(['meta-returned', 'meta-truncated-total']));
  });

  it('meta.errors — честные ошибки блоков: форма {block, reason}', () => {
    const d = minimalData();
    d.meta.errors = [{ block: 'journal', reason: '403' }, { block: 'edges' } as never];
    expect(validateKitData(d).errors.map((e) => e.path)).toContain('meta.errors[1].reason');
  });

  it('журнал: at — дата ISO, record_id обязателен', () => {
    const d = minimalData() as unknown as { journal: Record<string, unknown>[] };
    d.journal.push({ at: 'вчера', who: 'kate', field: 'status', from: 'todo', to: 'done' });
    const paths = validateKitData(d).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['journal[0].at', 'journal[0].record_id']));
  });
});

describe('K-01 · readKitData — чтение window.X_DATA с честным исходом', () => {
  it('нет переменной — missing, а не «пусто»', () => {
    expect(readKitData({}).state).toBe('missing');
  });
  it('битая форма — error с проблемами', () => {
    const r = readKitData({ X_DATA: { records: 'nope' } });
    expect(r.state).toBe('error');
    if (r.state === 'error') expect(r.issues.length).toBeGreaterThan(0);
  });
  it('годная форма — ok с данными и предупреждениями; ключ переопределяется', () => {
    const r = readKitData({ MY_DATA: minimalData() }, { key: 'MY_DATA', config: minimalConfig() });
    expect(r.state).toBe('ok');
    if (r.state === 'ok') {
      expect(r.data.records).toHaveLength(1);
      expect(r.warnings).toEqual([]);
    }
  });
});

describe('K-01 · JSON-схема согласована с валидатором', () => {
  it('схемы — draft 2020-12 с $id', () => {
    for (const s of [KIT_CONFIG_SCHEMA, KIT_DATA_SCHEMA]) {
      expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(typeof s.$id).toBe('string');
    }
  });
  it('каждый required верхнего уровня схемы конфига ловится валидатором', () => {
    for (const key of KIT_CONFIG_SCHEMA.required) {
      const cfg = minimalConfig() as unknown as Record<string, unknown>;
      delete cfg[key];
      expect(validateKitConfig(cfg).errors.some((e) => e.path === key), key).toBe(true);
    }
  });
  it('каждый required верхнего уровня схемы данных ловится валидатором', () => {
    for (const key of KIT_DATA_SCHEMA.required) {
      const d = minimalData() as unknown as Record<string, unknown>;
      delete d[key];
      expect(validateKitData(d).errors.some((e) => e.path === key), key).toBe(true);
    }
  });
  it('ключи верхнего уровня схемы конфига = ключи контракта (без дрейфа)', () => {
    expect(Object.keys(KIT_CONFIG_SCHEMA.properties).sort()).toEqual(
      ['edges', 'graph', 'hooks', 'kinds', 'list', 'menu', 'modules', 'palette', 'roles', 'statuses', 'verdict'].sort(),
    );
  });
  it('перечень токенов схемы = перечень валидатора', () => {
    const pattern = KIT_CONFIG_SCHEMA.$defs.colorToken.pattern;
    for (const t of KIT_COLOR_TOKENS) expect(new RegExp(pattern).test(`var(--${t})`), t).toBe(true);
    expect(new RegExp(pattern).test('#fff')).toBe(false);
  });
});

describe('K-01 · примеры конфигов', () => {
  for (const [name, cfg, data] of [
    ['LORE', loreConfig, loreData],
    ['Дата-странники', datawanderersConfig, datawanderersData],
  ] as const) {
    it(`${name}: конфиг чистый (ни ошибок, ни предупреждений), иконки существуют`, () => {
      const v = validateKitConfig(cfg, { iconExists });
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
    });
    it(`${name}: фикстура данных чистая против своего конфига`, () => {
      const v = validateKitData(data, cfg);
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
    });
    it(`${name}: вердикт считается для каждой записи и не превышает max`, () => {
      expect(cfg.verdict).toBeTypeOf('function');
      for (const r of data.records) {
        const v = cfg.verdict!(r, { data, config: cfg, href: (id) => `#${id}`, esc: (s) => s, md: (s) => s });
        expect(v.score, r.id).toBeLessThanOrEqual(v.max);
        expect(v.score, r.id).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('Дата-странники: группы меню и виды записей перенесены из их конфига полностью', () => {
    const items = datawanderersConfig.menu.groups.flatMap((g) => g.items.map((i) => i.id));
    for (const k of ['Rule', 'Trail', 'Quiz', 'Scroll', 'Rune', 'Porcha', 'SchoolStep', 'Topic', 'Item',
      'ItemTemplate', 'ErrorPattern', 'Author', 'Dream', 'Wanderer', 'Quest']) {
      expect(items, k).toContain(k);
      expect(datawanderersConfig.kinds[k], k).toBeDefined();
    }
    expect(Object.keys(datawanderersConfig.edges ?? {})).toHaveLength(15);
    expect(datawanderersConfig.modules.find((m) => m.id === 'test')?.status).toBe('planned');
  });

  it('Дата-странники: статус «не смотрели» получил непустой код none (пустой код несовместим с URL)', () => {
    expect(datawanderersConfig.statuses.items.map((s) => s.code)).toEqual(['none', 'fix', 'ok']);
  });
});
