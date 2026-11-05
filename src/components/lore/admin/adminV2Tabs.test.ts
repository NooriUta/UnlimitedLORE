import { describe, expect, it } from 'vitest';
import ruLocale from '../../../i18n/locales/ru/common.json';
import enLocale from '../../../i18n/locales/en/common.json';
import { cardParts, type Col } from './adminCards';
import { actBtn, searchBox } from '../adminLayout';
import { agentsCounter } from './adminShellModel';
import { GROUP_I18N, NAV_GROUPS, TAB_I18N, ALL_TABS } from './adminTabs';
import { QUICK_GROUPS, tryCopy } from './quickCommands';

// AH-05, пачка 2 (прототип admin-v2): остальные вкладки — таблица на десктопе,
// карточки с подписями полей на телефоне; хвосты пачки 1 (SH-05/13/16/17/18, Q-04).

const ADMIN_SRC = import.meta.glob(['./*.tsx', './*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flatten(v as Record<string, unknown>, key));
    else acc[key] = String(v);
    return acc;
  }, {});
}
const RU = flatten(ruLocale as Record<string, unknown>);
const EN = flatten(enLocale as Record<string, unknown>);

describe('таблица → карточки (телефон)', () => {
  const cols: Col[] = [
    { key: 'code', label: 'код', kind: 'title' },
    { key: 'label', label: 'подпись' },
    { key: 'look', label: 'вид', kind: 'full' },
    { key: 'uses', label: 'использований', num: true },
    { key: 'act', label: '', kind: 'act' },
  ];

  it('заголовок карточки — колонка title, действия — внизу, остальное с подписями по порядку', () => {
    const p = cardParts(cols);
    expect(p.title?.key).toBe('code');
    expect(p.act.map(c => c.key)).toEqual(['act']);
    expect(p.body.map(c => c.key)).toEqual(['label', 'look', 'uses']);
    // подпись поля в карточке — та же, что заголовок колонки таблицы
    expect(p.body[0].label).toBe('подпись');
  });

  it('без title и без действий — все колонки идут полями', () => {
    const p = cardParts([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
    expect(p.title).toBeNull();
    expect(p.act).toEqual([]);
    expect(p.body.map(c => c.key)).toEqual(['a', 'b']);
  });

  it('ни одна колонка не теряется', () => {
    const p = cardParts(cols);
    expect([p.title, ...p.body, ...p.act].filter(Boolean)).toHaveLength(cols.length);
  });

  it('кнопка действия: на телефоне 40px и во всю ширину, на десктопе плотная 26px', () => {
    expect(actBtn(true).minHeight).toBe(40);
    expect(actBtn(true).flex).toBe(1);
    expect(actBtn(false).minHeight).toBe(26);
    expect(actBtn(false).flex).toBeUndefined();
  });
});

describe('SH-13: поиск на телефоне', () => {
  it('шрифт поля на телефоне — токен 16px (иначе iOS зумит страницу), на десктопе — шкала', () => {
    expect(searchBox(true).input.fontSize).toBe('var(--fs-touch-input)');
    expect(searchBox(false).input.fontSize).toBe('var(--fs-sm)');
  });
  it('на телефоне поле во всю ширину и с тап-целью 40px', () => {
    expect(searchBox(true).wrap.minHeight).toBe(40);
    expect(searchBox(true).wrap.maxWidth).toBe('none');
  });
});

describe('SH-05: счётчик «Агенты» — агенты графа, а не учётки KC', () => {
  const ok = { k: 'ok' as const, rows: [1, 2, 3] };
  it('число — агенты графа; учётки KC — в подписи', () => {
    expect(agentsCounter(5, undefined, true, ok)).toEqual({ kind: 'n', n: 5, kcAccounts: 3 });
  });
  it('KC упал — агентов графа всё равно видно, учётки неизвестны (null), а не 0', () => {
    expect(agentsCounter(5, undefined, true, { k: 'forbidden' })).toEqual({ kind: 'n', n: 5, kcAccounts: null });
    expect(agentsCounter(5, undefined, true, { k: 'off', detail: 'x' })).toEqual({ kind: 'n', n: 5, kcAccounts: null });
  });
  it('сбой слайса agent_owners — «?», до ответа — пусто', () => {
    expect(agentsCounter(0, 'HTTP 500', true, ok)).toMatchObject({ kind: 'unk', why: 'srcErr' });
    expect(agentsCounter(0, undefined, false, ok)).toEqual({ kind: 'none' });
  });
});

describe('SH-16: подписи навигации через t()', () => {
  it('у каждой вкладки и группы есть ключ, и он есть в обеих локалях', () => {
    for (const k of ALL_TABS) {
      expect(RU[TAB_I18N[k]], k).toBeTruthy();
      expect(EN[TAB_I18N[k]], k).toBeTruthy();
    }
    for (const g of NAV_GROUPS) {
      const keys = GROUP_I18N[g.key];
      for (const key of [keys.label, keys.risk]) {
        expect(RU[key], key).toBeTruthy();
        expect(EN[key], key).toBeTruthy();
      }
      // русская локаль совпадает с подписью-дефолтом — модель и экран не разойдутся
      expect(RU[keys.label]).toBe(g.label);
      expect(RU[keys.risk]).toBe(g.risk);
      for (const [k, l] of g.tabs) expect(RU[TAB_I18N[k]]).toBe(l);
    }
  });

  it('заголовки таблиц не собираются из массива литералов мимо t()', () => {
    const re = /\[(?:\s*'[^']*',?)+\s*\]\.map\(\s*h\s*=>\s*<th/g;
    // положительный контроль: прежняя форма ловится, иначе «0 нарушителей» ничего не значит
    expect(new RegExp(re.source).test(`{['агент', 'профиль', 'владелец'].map(h => <th key={h}>{h}</th>)}`)).toBe(true);
    expect(Object.keys(ADMIN_SRC).length).toBeGreaterThan(10);
    const bad = Object.entries(ADMIN_SRC).filter(([, s]) => re.test(s)).map(([p]) => p);
    expect(bad).toEqual([]);
  });
});

describe('SH-17: lore.admin.noAgents разведён на два ключа', () => {
  it('старый общий ключ в коде не используется', () => {
    const bad = Object.entries(ADMIN_SRC).filter(([, s]) => s.includes("'lore.admin.noAgents'")).map(([p]) => p);
    expect(bad).toEqual([]);
  });
  it('«агентов в графе нет» и «никому из агентов не разрешено» — разные ключи с разным текстом', () => {
    for (const L of [RU, EN]) {
      expect(L['lore.admin.noGraphAgents']).toBeTruthy();
      expect(L['lore.admin.noAgentsAllowed']).toBeTruthy();
      expect(L['lore.admin.noGraphAgents']).not.toBe(L['lore.admin.noAgentsAllowed']);
    }
    expect(RU['lore.admin.noAgentsAllowed']).toContain('agent-full');
  });
});

describe('SH-18: цвета админки — только токены', () => {
  it('в модулях админки нет rgba()/hex', () => {
    const re = /rgba?\(|#[0-9a-fA-F]{3,8}\b(?![-\w])/;
    expect(re.test("background: 'rgba(0,0,0,.55)'")).toBe(true);
    const bad = Object.entries(ADMIN_SRC).filter(([, s]) => re.test(s.replace(/\/\/.*$/gm, ''))).map(([p]) => p);
    expect(bad).toEqual([]);
  });
});

describe('Быстрые команды', () => {
  it('Q-04: устаревшего mobilepoc-channel нет, канал — minilore-link', () => {
    const all = QUICK_GROUPS.flatMap(g => g.items.map(i => i.cmd + ' ' + i.label)).join('\n');
    expect(all).not.toContain('mobilepoc-channel');
    expect(all).toContain('minilore-link');
  });

  it('SH-16: у групп и подписей команд есть ключи в обеих локалях', () => {
    for (const g of QUICK_GROUPS) {
      expect(RU[g.titleKey], g.titleKey).toBe(g.title);
      expect(EN[g.titleKey], g.titleKey).toBeTruthy();
      for (const i of g.items) {
        expect(RU[i.labelKey], i.labelKey).toBe(i.label);
        expect(EN[i.labelKey], i.labelKey).toBeTruthy();
      }
    }
  });

  it('Q-03: без clipboard (не secure context) — «не скопировано», а не ложный успех', async () => {
    expect(await tryCopy('x', undefined)).toBe('unavailable');
    expect(await tryCopy('x', { writeText: () => Promise.reject(new Error('denied')) })).toBe('failed');
    let got = '';
    expect(await tryCopy('abc', { writeText: async (s: string) => { got = s; } })).toBe('ok');
    expect(got).toBe('abc');
  });
});
