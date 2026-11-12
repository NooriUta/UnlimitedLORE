// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04 — строки слайсов LORE → записи kit и
// честная полнота: «Показано N из M» kit считает по meta, которую собираем
// здесь из метаданных S1 (truncated / page / hint).
import { describe, expect, it } from 'vitest';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { hasGameIcon, registerGameIcons } from '@seidr/kit';
import { adrRecord, normStatus, sliceToKitData, sprintRecord } from './records';
import { LIST_SCREENS } from './screens';

registerGameIcons(gameIcons);

describe('normStatus', () => {
  it('эмодзи и регистр снимаются, пробелы → «_»', () => {
    expect(normStatus('📋 PLANNED')).toBe('planned');
    expect(normStatus('✅ DONE')).toBe('done');
    expect(normStatus('🚀 READY FOR DEPLOY')).toBe('ready_for_deploy');
    expect(normStatus('accepted')).toBe('accepted');
    expect(normStatus(null)).toBe('');
  });
});

describe('строки слайсов → KitRecord', () => {
  // Переписано 09.11 (S4-05): многозначные поля больше НЕ склеиваются в строку.
  // Склейка теряла данные — фильтр по одному релизу не находил спринт с двумя,
  // а фасет показывал «LORE, FORSETI» одним значением. Подробный разбор и
  // проверки фильтра — в `multiValue.test.ts`.
  it('спринт: код, имя, статус, проекты/компоненты/релизы списками, приоритет', () => {
    const r = sprintRecord({
      sprint_id: 'SPRINT_X', name: 'Икс', status_raw: '🔄 ACTIVE', priority: 2,
      git_projects: ['NooriUta/UnlimitedLORE'], components: ['FORSETI', 'OMILORE'], release_ids: [],
      valid_from: '2026-11-01T10:00:00',
    });
    expect(r).toMatchObject({ id: 'SPRINT_X', kind: 'sprint', title: 'Икс', status: 'active', updated_at: '2026-11-01T10:00:00' });
    expect(r.fields).toMatchObject({ project: ['NooriUta/UnlimitedLORE'], components: ['FORSETI', 'OMILORE'], release: [], priority: 2 });
  });

  it('спринт без имени — заголовок = код (пустая строка списка не нужна)', () => {
    expect(sprintRecord({ sprint_id: 'S1', name: null }).title).toBe('S1');
  });

  it('ADR: статус в нижнем регистре, число решений — числом', () => {
    const r = adrRecord({ adr_id: 'ADR-1', name: 'Один', status: 'ACCEPTED', component: 'FORSETI', decision_count: 0, tags: ['ui'] });
    expect(r).toMatchObject({ id: 'ADR-1', kind: 'adr', status: 'accepted' });
    expect(r.fields).toMatchObject({ component: 'FORSETI', decisions: 0, tags: ['ui'] });
  });
});

describe('sliceToKitData — полнота из метаданных S1', () => {
  const map = (row: { id: string }) => ({ id: row.id, kind: 'x', title: row.id, status: '', fields: {} });
  const rows = [{ id: 'a' }, { id: 'b' }];

  it('полная выдача: total = число строк, не обрезано', () => {
    const d = sliceToKitData({ rows }, map, '2026-11-07T00:00:00Z');
    expect(d.records).toHaveLength(2);
    expect(d.meta).toMatchObject({ total: 2, returned: 2, truncated: false, generated_at: '2026-11-07T00:00:00Z' });
  });

  it('потолок сервера (truncated:true) — обрезано, итог неизвестен (page.total — уже обрезанное)', () => {
    const d = sliceToKitData({ rows, truncated: true, limit: 2, page: { limit: 2, offset: 0, total: 2, has_more: false } }, map, 't');
    expect(d.meta.truncated).toBe(true);
    expect(d.meta.total).toBeUndefined();
  });

  it('страница (has_more) — итог из page.total', () => {
    const d = sliceToKitData({ rows, page: { limit: 2, offset: 0, total: 9, has_more: true } }, map, 't');
    expect(d.meta).toMatchObject({ truncated: true, total: 9 });
  });

  it('truncated:"unknown" — полноту проверить нечем: обрезано без итога', () => {
    const d = sliceToKitData({ rows, truncated: 'unknown' }, map, 't');
    expect(d.meta.truncated).toBe(true);
    expect(d.meta.total).toBeUndefined();
  });
});

describe('конфиги экранов списков', () => {
  // 09.11: добавлен раздел «Задачи» (S4-V2-SECTIONS) — пункт в меню был с самого
  // начала, а экрана под ним не было. Список экранов перечислен явно намеренно:
  // так видно, когда появляется новый, и его иконки тоже проверяются.
  // 09.11: все одиннадцать разделов v1 собраны (S4-V2-SECTIONS). Список
  // перечислен явно намеренно: так видно, когда появляется новый, и его иконки
  // тоже проверяются.
  it('все одиннадцать разделов на месте; иконки статусов, вида и «Быстро» есть в наборе game-icons', () => {
    expect(Object.keys(LIST_SCREENS)).toEqual([
      'sprints', 'adrs', 'tasks',
      'decisions', 'specs', 'questions', 'milestones', 'releases', 'components', 'projects', 'tech', 'features',
      // S4-PRODUCTS-NODE: нода «Продукт».
      'products', 'actors', 'pains', 'gains', 'jobs',
    ]);
    for (const lang of ['ru', 'en'] as const) {
      for (const s of Object.values(LIST_SCREENS)) {
        const c = s.config(lang);
        for (const it of c.statuses.items) expect(hasGameIcon(it.icon), `${s.slice}:${it.code}`).toBe(true);
        for (const k of Object.values(c.kinds)) expect(hasGameIcon(k.icon)).toBe(true);
        for (const ic of Object.values(s.quickIcons)) expect(hasGameIcon(ic), ic).toBe(true);
        expect(c.list?.quick?.length, s.slice).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Фасет статуса — РОВНО там, где есть статусная ось.
   *
   * Было «фасет status у каждого раздела», и для четырёх типов это стало
   * неправдой: у вех, релизов, компонентов и технологий статуса нет ни в одном
   * поле среза (замер 09.11). Пустой фасет — обещание фильтра, которого нет,
   * поэтому проверяется равенство в ДВЕ стороны: есть ось → есть фасет; нет оси
   * → нет ни фасета, ни колонки, ни разреза по статусу.
   */
  it('фасет и колонка статуса есть ровно там, где есть статусная ось', () => {
    // S4-29 (53а): у проекта статуса нет — справочник git-проектов.
    // S4-PRODUCTS-NODE: продукты и профиль клиента — справочники, статусной оси нет.
    const noAxis = ['milestones', 'releases', 'components', 'projects', 'tech', 'products', 'actors', 'pains', 'gains', 'jobs'] as const;
    for (const [id, s] of Object.entries(LIST_SCREENS)) {
      const c = s.config('ru');
      const hasAxis = c.statuses.items.length > 0;
      expect(hasAxis, `${id}: ось статусов ${hasAxis ? 'есть' : 'пуста'}`).toBe(!(noAxis as readonly string[]).includes(id));
      expect(c.list?.filters?.includes('status') ?? false, `${id}: фасет статуса`).toBe(hasAxis);
      expect(c.list?.columns?.includes('status') ?? false, `${id}: колонка статуса`).toBe(hasAxis);
      expect(c.list?.groupings?.includes('status') ?? false, `${id}: разрез по статусу`).toBe(hasAxis);
    }
  });
});

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-27: в прототипе v4 вид раздела по умолчанию —
// «открытые, закрытые внизу». kit нейтрален (умолчание «все»), поэтому режим
// задают конфиги разделов LORE. Что закрыто, решает словарь: у ADR «принято» — открытое.
describe('конфиги разделов: закрытые — внизу, свёрнуты', () => {
  it('спринты и ADR включают list.showClosed = below', () => {
    for (const id of ['sprints', 'adrs'] as const) {
      expect(LIST_SCREENS[id].config('ru').list?.showClosed, id).toBe('below');
    }
  });
  it('у ADR «принято» и «предложено» — открытые категории, «отклонено» — закрытая', () => {
    const cat = (code: string) => LIST_SCREENS.adrs.config('ru').statuses.items.find(s => s.code === code)?.category;
    expect(cat('accepted')).toBe('active');
    expect(cat('proposed')).toBe('active');
    expect(cat('rejected')).toBe('cancelled');
  });
});
