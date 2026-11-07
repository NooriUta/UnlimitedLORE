// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-08 — выдача kit для single-file HTML:
// SeidrKit.mount(el, config, data) (D-2026-UXR-KIT-REACT, вариант «б»).
// Контракт — kit/src/core/contract.ts. Проверяем то, что приложение-потребитель
// (пилот — method.tpl «Дата-странников») получит без React у себя:
//  - запись рисуется по конфигу вида (overview, вкладки, поля, тело MD);
//  - исключение в overview/вкладке ломает только свой блок (errBlock);
//  - честные состояния: пусто (проверено) ≠ ошибка загрузки ≠ блок не проверен;
//  - выбор записи — в URL (#r=…), с фолбэком на hash;
//  - mount возвращает update/unmount и сам себя не ломает повторным вызовом.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements';
import { axeViolations } from '../test/axe';
import type { KitConfig, KitData } from '../core/contract';
import pkg from '../../package.json';
import { SeidrKit, mount, SEIDR_KIT_VERSION } from './mount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const config: KitConfig = {
  modules: [
    { id: 'method', title: 'Методология', icon: 'scroll-unfurled', status: 'active' },
    { id: 'test', title: 'Тестирование', icon: 'test-tubes', status: 'planned' },
  ],
  menu: { groups: [{ id: 'mech', title: 'Механика', tone: '--acc', items: [{ id: 'Quiz', title: 'Квизы' }] }] },
  kinds: {
    Quiz: {
      title: 'Квизы',
      icon: 'rune-stone',
      overview: (r) => `Вопрос: ${String(r.fields.question)}`,
      tabs: [
        { key: 'play', title: 'Играть', render: () => 'игровой режим' },
        { key: 'boom', title: 'Сломанная', render: () => { throw new Error('вкладка упала'); } },
      ],
      fields: [{ key: 'question', title: 'Вопрос', type: 'text' }],
    },
    Scroll: {
      title: 'Свитки',
      icon: 'scroll-quill',
      overview: () => { throw new Error('overview упал'); },
    },
  },
  statuses: {
    items: [
      { code: 'none', title: 'не смотрели', category: 'todo', icon: 'circle', color: '--t3' },
      { code: 'ok', title: 'согласовано', category: 'done', icon: 'check-mark', color: '--suc' },
    ],
  },
};

const data: KitData = {
  records: [
    { id: 'quiz-1', kind: 'Quiz', title: 'Квиз о рунах', status: 'ok', fields: { question: 'Что значит ᚠ?' } },
    { id: 'scroll-1', kind: 'Scroll', title: 'Свиток о снах', status: 'none', fields: {}, body_md: '# Сны\n\nтекст свитка' },
  ],
  edges: [],
  journal: [],
  meta: { generated_at: '2026-11-07T12:00:00Z', scope: 'method', total: 2, returned: 2 },
};

let host: HTMLElement;
let handle: ReturnType<typeof mount> | null = null;

function freshHost() {
  host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

async function doMount(d: KitData | Promise<KitData>, cfg: KitConfig = config) {
  await act(async () => { handle = mount(freshHost(), cfg, d, { lang: 'ru' }); });
  return host;
}

afterEach(() => {
  act(() => handle?.unmount());
  handle = null;
  host?.remove();
  window.location.hash = '';
});

describe('K-08 · версия выдачи', () => {
  it('SEIDR_KIT_VERSION = версия пакета @seidr/kit и = SeidrKit.version', () => {
    expect(SEIDR_KIT_VERSION).toBe(pkg.version);
    expect(SeidrKit.version).toBe(pkg.version);
    expect(SeidrKit.mount).toBe(mount);
  });

  it('выдача 0.1.0 закрывает ядро', () => {
    expect(pkg.version).toBe('0.1.0');
  });
});

describe('K-08 · mount рисует записи по конфигу', () => {
  it('список записей с видом и статусом, первая выбрана, overview и поля видны', async () => {
    const el = await doMount(data);
    expect(el.querySelector('[data-kit-mount]')?.getAttribute('data-kit-version')).toBe(pkg.version);
    const items = el.querySelectorAll('[data-kit-record-item]');
    expect(items.length).toBe(2);
    expect(el.textContent).toContain('Квиз о рунах');
    expect(el.textContent).toContain('согласовано');
    expect(el.textContent).toContain('Вопрос: Что значит ᚠ?');
    expect(el.textContent).toContain('Методология');
  });

  it('выбор записи пишет #r=… в URL и показывает её тело MD', async () => {
    const el = await doMount(data);
    const second = el.querySelectorAll<HTMLButtonElement>('[data-kit-record-item]')[1];
    await act(async () => { second.click(); });
    expect(decodeURIComponent(window.location.search + window.location.hash)).toContain('r=scroll-1');
    expect(el.querySelector('[data-kit-record]')?.getAttribute('data-kit-record')).toBe('scroll-1');
    expect(el.querySelector('.sk-prose')?.textContent).toContain('текст свитка');
  });

  it('выбор из URL восстанавливается при монтировании', async () => {
    window.history.replaceState(null, '', '/?r=scroll-1');
    const el = await doMount(data);
    expect(el.querySelector('[data-kit-record]')?.getAttribute('data-kit-record')).toBe('scroll-1');
    window.history.replaceState(null, '', '/');
  });
});

describe('K-08 · исключение в render ломает только свой блок', () => {
  it('overview бросил — errBlock этого блока, заголовок и остальное живы', async () => {
    window.history.replaceState(null, '', '/?r=scroll-1');
    const el = await doMount(data);
    const err = el.querySelector('[data-kit-block="overview"][data-state="error"]');
    expect(err?.textContent).toContain('overview упал');
    expect(el.querySelector('[data-kit-record] h2')?.textContent).toContain('Свиток о снах');
    window.history.replaceState(null, '', '/');
  });

  it('вкладка бросила — ошибка только во вкладке, другие вкладки работают', async () => {
    const el = await doMount(data);
    const tab = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === 'Сломанная')!;
    await act(async () => { tab.click(); });
    expect(el.querySelector('[data-kit-block="tab:boom"][data-state="error"]')?.textContent).toContain('вкладка упала');
    const play = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === 'Играть')!;
    await act(async () => { play.click(); });
    expect(el.textContent).toContain('игровой режим');
  });
});

describe('K-08 · честные состояния', () => {
  it('ноль записей — проверенный ноль, а не ошибка', async () => {
    const el = await doMount({ ...data, records: [], meta: { generated_at: 'x', total: 0, returned: 0 } });
    expect(el.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(el.querySelector('[data-state="error"]')).toBeNull();
  });

  it('meta.errors — блок «не смогли проверить» с причиной, записи всё равно видны', async () => {
    const el = await doMount({ ...data, meta: { ...data.meta, errors: [{ block: 'quality', reason: 'таймаут' }] } });
    const e = el.querySelector('[data-kit-meta-error="quality"]');
    expect(e?.textContent).toContain('таймаут');
    expect(el.querySelectorAll('[data-kit-record-item]').length).toBe(2);
  });

  it('meta.truncated — плашка неполной выдачи', async () => {
    const el = await doMount({ ...data, meta: { ...data.meta, total: 500, returned: 2, truncated: true } });
    expect(el.querySelector('[data-state="partial"]')).not.toBeNull();
  });

  it('данные — Promise: сначала загрузка, отказ — ошибка, а не пусто', async () => {
    let reject!: (e: unknown) => void;
    const p = new Promise<KitData>((_, rj) => { reject = rj; });
    const el = await doMount(p);
    expect(el.querySelector('[data-state="loading"]')).not.toBeNull();
    await act(async () => { reject(new Error('сеть недоступна')); await p.catch(() => {}); });
    expect(el.querySelector('[data-state="error"]')?.textContent).toContain('сеть недоступна');
    expect(el.querySelector('[data-state="empty"]')).toBeNull();
  });

  it('пустой или битый config — явная ошибка, а не белый лист', async () => {
    const el = await doMount(data, {} as KitConfig);
    expect(el.querySelector('[data-state="error"]')).not.toBeNull();
  });
});

describe('K-08 · жизненный цикл', () => {
  it('update() меняет данные, unmount() очищает узел', async () => {
    const el = await doMount(data);
    await act(async () => { handle!.update({ ...data, records: [data.records[0]] }); });
    expect(el.querySelectorAll('[data-kit-record-item]').length).toBe(1);
    act(() => handle!.unmount());
    handle = null;
    expect(el.innerHTML).toBe('');
  });

  it('mount без узла — понятная ошибка', () => {
    expect(() => mount(null as unknown as Element, config, data)).toThrow(/SeidrKit\.mount/);
  });

  it('цели касания и роли проходят axe', async () => {
    const el = await doMount(data);
    expect(await axeViolations(el)).toEqual([]);
  });
});
