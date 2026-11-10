// @vitest-environment jsdom
// Правило групп при большой выдаче (SPRINT_UXR_S9_SCALE_OPT/S9-02).
//
// Замер третьего круга критики: группировка по релизу даёт 142 группы, и все
// раскрыты (`docs/reports/lore-ux-critique-round3-scale-2026-11-08.html`).
//
// Проба 09.11 перед работой: бюджет групп в kit УЖЕ есть
// (`LIST_BUDGET = {perGroup: 50, maxGroups: 20, topGroups: 10}`), и `groupBy`
// сворачивает хвост в «Прочие». Поэтому первый тест — положительный контроль
// того, что уже работает: переписывать работающее нельзя, нужно понять, чего
// действительно нет.
//
// А нет двух вещей из состава задачи:
//   • **поиска внутри группировки** — при десяти группах плюс «Прочие» нужный
//     релиз всё равно ищут глазами;
//   • **свёрнутости по умолчанию у группировок по релизу и спринту.** Сейчас
//     свёрнуто ТОЛЬКО когда появилась группа «Прочие» (`collapsedByDefault`
//     смотрит на `g.other`). Пятнадцать релизов — порога нет, «Прочих» нет, и
//     все пятнадцать раскрыты: это та же стена строк, из которой задача и
//     выросла, только чуть ниже.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { KitLangProvider } from '../i18n';
import { ListView } from './ListView';
import { LIST_BUDGET } from './listModel';
import type { KitConfig, KitData, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

/** n релизов по 3 записи: столько групп, сколько релизов. */
function dataWith(releases: number): KitData {
  const records: KitRecord[] = [];
  for (let r = 0; r < releases; r++) {
    for (let i = 0; i < 3; i++) {
      records.push({
        id: `S-${r}-${i}`, kind: 'sprint', title: `Спринт ${r}.${i}`, status: 'active',
        fields: { release: `v1.${r}.0` },
      });
    }
  }
  return { records, edges: [], journal: [], meta: { generated_at: 'x' } };
}

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'active', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--acc)' }] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [{ key: 'release', title: 'Релиз', type: 'ref' }] } },
  list: { views: ['list'], groupings: ['release'], columns: ['title', 'status'] },
};

const state = { view: 'list' as const, quick: null, group: 'release', sort: null, filters: {}, ops: {}, text: '' };

const show = (releases: number) => render(
  <ListView config={config} data={dataWith(releases)} state={state} onStateChange={() => {}} />,
);

/** Тот же список, но разрез назван свёрнутым по умолчанию (S9-02). */
const showCollapsed = (releases: number) => render(
  <ListView
    config={{ ...config, list: { ...config.list!, collapsedGroupings: ['release'] } }}
    data={dataWith(releases)} state={state} onStateChange={() => {}}
  />,
);

const groupHeads = () => [...document.querySelectorAll('.sk-list__ghead')];
// Группы — строки таблицы с кнопкой-шевроном; раскрытость в aria-expanded.
const openGroups = () => [...document.querySelectorAll('.sk-list__gbtn[aria-expanded="true"]')];

describe('S9-02 · бюджет групп', () => {
  it('положительный контроль: при 5 релизах группы есть и не свёрнуты', () => {
    show(5);
    expect(groupHeads().length).toBe(5);
  });

  it('142 релиза — показано не 142 группы, а топ-10 и «Прочие» (уже работало)', () => {
    show(142);
    expect(groupHeads().length).toBe(LIST_BUDGET.topGroups + 1);
    expect(document.body.textContent).toMatch(/Прочие/);
  });

  it('142 релиза — все группы свёрнуты, стены строк нет (уже работало)', () => {
    show(142);
    expect(openGroups().length).toBe(0);
  });

  it('15 релизов без настройки — раскрыты: прежнее поведение других приложений не меняем', () => {
    show(15);
    expect(groupHeads().length).toBe(15);
    expect(openGroups().length).toBe(15);
  });

  it('разрез назван свёрнутым — 15 групп свёрнуты с первого показа', () => {
    showCollapsed(15);
    expect(groupHeads().length).toBe(15);
    expect(openGroups().length).toBe(0);
  });

  it('поиск по группам есть, когда групп стало много', () => {
    show(15);
    expect(screen.queryByRole('searchbox', { name: /групп/i })).toBeTruthy();
  });

  it('мало групп — поиска нет: искать нечего', () => {
    show(5);
    expect(screen.queryByRole('searchbox', { name: /групп/i })).toBeNull();
  });
});

// Поиск ищет по ВСЕМ группам, а не по показанным. При 142 релизах видно 10 и
// «Прочие», и нужный релиз почти наверняка в «Прочих» — поиск по десяти
// видимым был бы обманом.
describe('S9-02 · поиск по группам', () => {
  const type = (q: string) => {
    const box = screen.getByRole('searchbox', { name: /групп/i });
    fireEvent.change(box, { target: { value: q } });
    return box;
  };

  it('положительный контроль: без запроса видно топ-10 и «Прочие»', () => {
    show(142);
    expect(groupHeads().length).toBe(LIST_BUDGET.topGroups + 1);
  });

  it('находит группу, которая была спрятана в «Прочих»', () => {
    show(142);
    // v1.141.0 — последний релиз, в топ-10 по размеру он не попадает.
    type('v1.141.0');
    const titles = groupHeads().map(h => h.textContent ?? '');
    expect(titles.some(t => t.includes('v1.141.0'))).toBe(true);
    expect(document.body.textContent).not.toMatch(/Прочие/);
  });

  it('частичный запрос оставляет только подходящие группы', () => {
    show(142);
    type('v1.13');
    // v1.13.0 и v1.130.0…v1.139.0 — одиннадцать штук, и все они подходят.
    const titles = groupHeads().map(h => h.textContent ?? '');
    expect(titles.length).toBeGreaterThan(1);
    expect(titles.every(t => t.includes('v1.13'))).toBe(true);
  });

  it('не нашлось — сказано словами и повторён запрос, а не пустая таблица', () => {
    show(142);
    type('такого релиза нет');
    expect(groupHeads().length).toBe(0);
    // Строк «Показано N из M» тоже role=status, поэтому ищем свою по месту.
    const note = document.querySelector('.sk-list__gfind-empty');
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toMatch(/Ни одна группа не подходит/);
    expect(note?.textContent).toMatch(/такого релиза нет/);
  });

  it('запрос стёрли — вернулись топ-10 и «Прочие»', () => {
    show(142);
    type('v1.141.0');
    type('');
    expect(groupHeads().length).toBe(LIST_BUDGET.topGroups + 1);
  });

  it('найденных групп больше бюджета — тот же срез в «Прочие», а не стена', () => {
    show(142);
    type('v1.1');
    // v1.1.0, v1.10…v1.19, v1.100…v1.141 — заметно больше двадцати.
    expect(groupHeads().length).toBe(LIST_BUDGET.topGroups + 1);
    expect(document.body.textContent).toMatch(/Прочие/);
  });
});

// Честные состояния потолка (S9-02, вторая половина задачи).
//
// Проба 10.11 показала, чего не хватало после первого захода: потолок есть, но
// он молчит о себе.
//   • «Прочие» называли только число групп; сколько там СТРОК, читалось из
//     общего счётчика группы рядом — то есть число было, но не было сказано,
//     что оно про спрятанное. «Прочие» без строк читается как «мелочь», а в
//     них при 142 релизах лежит 396 строк из 426 — почти вся выдача.
//   • Про то, что топ-10 посчитан по ЗАГРУЖЕННОЙ странице, не говорилось
//     вовсе. При обрезанной выдаче «десять самых больших» — неправда: это
//     десять самых больших среди загруженного, а в полной выдаче порядок
//     групп может быть другим.
//   • Сколько всего групп (из чего выбран топ) на экране не было: 10 и
//     «Прочие» не говорят «из 142».

/** Та же выдача, но сервер сказал, что обрезал её. */
const showTruncated = (releases: number, total = 5000) => {
  const d = dataWith(releases);
  return render(
    <ListView
      config={config}
      data={{ ...d, meta: { generated_at: 'x', total, truncated: true } }}
      state={state} onStateChange={() => {}}
    />,
  );
};

const otherHead = () => groupHeads().find(h => h.getAttribute('data-group-key')?.includes('other'));
const capNote = () => document.querySelector('.sk-list__gcap');

describe('S9-02 · «Прочие» называют, сколько спрятано', () => {
  it('142 релиза: «Прочие» называют и число групп, и число строк в них', () => {
    show(142);
    const txt = otherHead()?.textContent ?? '';
    // 142 группы по 3 записи: показаны 10 (30 строк), спрятаны 132 (396 строк).
    expect(txt).toMatch(/132 групп/);
    expect(txt).toMatch(/396 строк/);
  });

  it('число склоняется: 21 группа и 63 строки, а не «21 групп»', () => {
    show(31);
    const txt = otherHead()?.textContent ?? '';
    expect(txt).toMatch(/21 группа(?!х)/);
    expect(txt).toMatch(/63 строки/);
  });

  it('«Прочие» раскрываются: спрятанное достижимо, а не отрезано', () => {
    show(142);
    expect(document.querySelectorAll('[data-record-id]').length).toBe(0);
    fireEvent.click(otherHead()!.querySelector('.sk-list__gbtn')!);
    // Раскрылось: строки «Прочих» показаны (первые 50 — потолок на группу, S9-01).
    expect(document.querySelectorAll('[data-record-id]').length).toBe(LIST_BUDGET.perGroup);
  });

  it('en: «Other» тоже называет группы и строки', () => {
    render(
      <KitLangProvider lang="en">
        <ListView config={config} data={dataWith(142)} state={state} onStateChange={() => {}} />
      </KitLangProvider>,
    );
    const txt = otherHead()?.textContent ?? '';
    expect(txt).toMatch(/132 groups/);
    expect(txt).toMatch(/396 rows/);
  });
});

describe('S9-02 · из чего выбран топ и по чему посчитан', () => {
  it('потолок сработал — сказано, сколько групп всего', () => {
    show(142);
    const note = capNote();
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toMatch(/10/);
    expect(note?.textContent).toMatch(/142/);
  });

  it('выдача полная — про обрезку не говорим', () => {
    show(142);
    expect(capNote()?.textContent).not.toMatch(/обрезан/);
  });

  it('выдача обрезана сервером — «топ-10 среди загруженного», а не «десять самых больших»', () => {
    showTruncated(142);
    const note = capNote();
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toMatch(/обрезан/);
    expect(note?.textContent).toMatch(/загруж/);
  });

  it('групп мало, но выдача обрезана — группы всё равно посчитаны по загруженному', () => {
    showTruncated(5);
    expect(capNote()?.textContent).toMatch(/загруж/);
  });

  it('групп мало и выдача полная — оговорки нет: говорить нечего', () => {
    show(5);
    expect(capNote()).toBeNull();
  });

  it('без группировки оговорки нет', () => {
    render(
      <ListView config={config} data={dataWith(142)} state={{ ...state, group: null }} onStateChange={() => {}} />,
    );
    expect(capNote()).toBeNull();
  });

  it('при поиске топ выбран из НАЙДЕННЫХ групп, и число названо их', () => {
    show(142);
    const box = screen.getByRole('searchbox', { name: /групп/i });
    fireEvent.change(box, { target: { value: 'v1.1' } });
    // v1.1.0, v1.10…v1.19 (10), v1.100…v1.141 (42) — 53 группы.
    expect(capNote()?.textContent).toMatch(/53/);
  });
});
