import { describe, expect, it } from 'vitest';
import {
  ONE_COL, biblioPanes, bragiPlanLayout, evolutionPanes, masterDetailPanes, milestonesTwoCol,
  passportLayout, scrollStrip, stripItem, timelineRow, tyrReportsLayout, wrapHeader,
} from './mobileLayout';
import { clamp, dragHandleTouch, startPointerDrag } from './pointerDrag';
import { projectPickerInMore, whereAmILabel } from '../layout/shellLayout';

// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 — аудит мобильной раскладки 05.11.2026.
// Каждый экран из аудита держал на телефоне фиксированную колонку или высоту:
// основное содержимое получало 0px или уезжало за край. Правило одно на все:
// на телефоне одна колонка либо одна панель с «← назад»; десктоп — как был.

describe('AH-08 · master-detail: на телефоне ровно одна панель', () => {
  it('десктоп — обе панели, без «назад»', () => {
    expect(masterDetailPanes(false, true)).toEqual({ showList: true, showDetail: true, showBack: false });
    expect(masterDetailPanes(false, false)).toEqual({ showList: true, showDetail: true, showBack: false });
  });
  it('телефон без выбора — только список', () => {
    expect(masterDetailPanes(true, false)).toEqual({ showList: true, showDetail: false, showBack: false });
  });
  it('телефон с выбором — только деталь и «← назад»', () => {
    expect(masterDetailPanes(true, true)).toEqual({ showList: false, showDetail: true, showBack: true });
  });
});

describe('AH-08 · TYR-отчёты: сайдбар не съедает отчёт', () => {
  it('телефон: строка сетки ограничена (minmax(0,1fr)), а не auto по длине истории', () => {
    for (const hasRun of [true, false]) {
      const l = tyrReportsLayout(true, hasRun);
      expect(l.gridTemplateRows).toBe(ONE_COL);
      expect(Number(l.showList) + Number(l.showDetail)).toBe(1);
    }
  });
  it('телефон с прогоном — виден отчёт, не список', () => {
    const l = tyrReportsLayout(true, true);
    expect(l.showDetail).toBe(true);
    expect(l.showList).toBe(false);
    expect(l.showBack).toBe(true);
  });
  it('десктоп: CSS-сетка 280px | 1fr не переопределяется', () => {
    expect(tyrReportsLayout(false, true).gridTemplateRows).toBeUndefined();
  });
});

describe('AH-08 · Timeline: заголовку хватает места на 375px', () => {
  it('телефон: строка переносится, заголовок — своей строкой, подпись типа скрыта', () => {
    const r = timelineRow(true);
    expect(r.row.flexWrap).toBe('wrap');
    expect(r.title.flexBasis).toBe('100%');
    expect(r.showKind).toBe(false);
    expect(r.ref.minWidth).toBe(0);
  });
  it('десктоп: ничего не переопределяется', () => {
    const r = timelineRow(false);
    expect(r.row).toEqual({});
    expect(r.title).toEqual({});
    expect(r.showKind).toBe(true);
  });
});

describe('AH-08 · Evolution: список 220px сворачивается', () => {
  it('телефон: список на всю ширину и исчезает, когда открыта история', () => {
    expect(evolutionPanes(true, false)).toMatchObject({ showList: true, showDetail: false, listWidth: '100%' });
    expect(evolutionPanes(true, true)).toMatchObject({ showList: false, showDetail: true, showBack: true });
  });
  it('десктоп: прежние 220px с границей справа', () => {
    expect(evolutionPanes(false, true)).toMatchObject({ showList: true, showDetail: true, listWidth: 220, listBorderRight: true });
  });
});

describe('AH-08 · BRAGI-план: календарь не сжимается до 20px', () => {
  it('телефон: карточки одной колонкой, календарь без распирания', () => {
    const l = bragiPlanLayout(true);
    expect(l.gridCols).toBe(ONE_COL);
    expect(l.calCols).toBe('repeat(7, minmax(0, 1fr))');
    expect(l.compactChips).toBe(true);
    expect(l.calGap).toBeLessThan(bragiPlanLayout(false).calGap);
  });
  it('десктоп: прежние 1.7fr 1fr и 7×1fr', () => {
    const l = bragiPlanLayout(false);
    expect(l.gridCols).toBe('1.7fr 1fr');
    expect(l.calCols).toBe('repeat(7, 1fr)');
    expect(l.cellMinH).toBe(78);
  });
});

describe('AH-08 · паспорт компонента: «Сохранить» достижимо', () => {
  it('десктоп: верх фиксированной высоты ПРОКРУЧИВАЕТСЯ, а не режет форму', () => {
    const l = passportLayout(false, 280);
    expect(l.top.height).toBe(280);
    expect(l.top.overflowY).toBe('auto');
    expect(l.showHandle).toBe(true);
  });
  it('телефон: без фиксированной высоты, одна прокрутка на весь паспорт, ручки нет', () => {
    const l = passportLayout(true, 280);
    expect(l.top.height).toBe('auto');
    expect(l.top.overflow).toBe('visible');
    expect(l.root.overflowY).toBe('auto');
    expect(l.showHandle).toBe(false);
  });
});

describe('AH-08 · Biblio: холст не схлопывается под панелью 300px', () => {
  it('десктоп: панель 300px справа, холст отступает на неё', () => {
    expect(biblioPanes(false, true)).toEqual({ canvasRight: 300, panel: { width: 300 }, showBack: false });
    expect(biblioPanes(false, false).canvasRight).toBe(0);
  });
  it('телефон: холст во всю ширину, панель — на всю область с «← назад»', () => {
    const p = biblioPanes(true, true);
    expect(p.canvasRight).toBe(0);
    expect(p.panel).toEqual({ left: 0, width: 'auto' });
    expect(p.showBack).toBe(true);
  });
});

describe('AH-08 · ленты и шапки', () => {
  it('лента вкладок (аналитика) листается вбок, вкладки не сжимаются', () => {
    expect(scrollStrip.overflowX).toBe('auto');
    expect(scrollStrip.flexWrap).toBe('nowrap');
    expect(scrollStrip.flexShrink).toBe(0);
    expect(stripItem.flexShrink).toBe(0);
    expect(stripItem.whiteSpace).toBe('nowrap');
  });
  it('шапка редактора публикации переносится; десктоп сохраняет паддинг 12px 20px', () => {
    expect(wrapHeader(true).flexWrap).toBe('wrap');
    expect(wrapHeader(false).flexWrap).toBe('wrap');
    expect(wrapHeader(false).padding).toBe('12px 20px');
  });
  it('вехи: 1fr 1fr только на десктопе', () => {
    expect(milestonesTwoCol(false).gridTemplateColumns).toBe('1fr 1fr');
    expect(milestonesTwoCol(true).gridTemplateColumns).toBe(ONE_COL);
  });
});

describe('AH-08 · оболочка: «где я» и проект на телефоне', () => {
  it('выбор проекта на телефоне живёт в меню «⋯», на десктопе — в шапке', () => {
    expect(projectPickerInMore(true)).toBe(true);
    expect(projectPickerInMore(false)).toBe(false);
  });
  it('на телефоне название раздела показывается текстом: глава в Forseti, иначе пространство', () => {
    expect(whereAmILabel({ narrow: true, inProjects: true, chapter: 'Как делаем', space: 'Forseti' })).toBe('Как делаем');
    expect(whereAmILabel({ narrow: true, inProjects: false, chapter: 'Как делаем', space: 'Bragi' })).toBe('Bragi');
  });
  it('на десктопе в Forseti подпись не нужна — главы видны строкой', () => {
    expect(whereAmILabel({ narrow: false, inProjects: true, chapter: 'Как делаем', space: 'Forseti' })).toBe('Forseti');
  });
});

// Ручки ресайза плана и паспорта слушали только мышь — пальцем их не сдвинуть.
describe('AH-08 · ресайз принимает pointer events', () => {
  const pe = (type: string, x: number, y: number) => Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 7 });

  it('pointermove двигает, pointerup завершает и снимает слушатели', () => {
    const target = new EventTarget();
    const deltas: number[] = [];
    let ended = 0;
    let captured: number | null = null;
    let prevented = false;
    startPointerDrag(
      { clientX: 10, clientY: 100, pointerId: 7, preventDefault: () => { prevented = true; },
        currentTarget: { setPointerCapture: (id: number) => { captured = id; } } },
      { axis: 'y', onDelta: d => deltas.push(d), onEnd: () => { ended++; } },
      target,
    );
    expect(prevented).toBe(true);
    expect(captured).toBe(7);
    target.dispatchEvent(pe('pointermove', 10, 130));
    target.dispatchEvent(pe('pointermove', 10, 80));
    expect(deltas).toEqual([30, -20]);
    target.dispatchEvent(pe('pointerup', 10, 80));
    expect(ended).toBe(1);
    target.dispatchEvent(pe('pointermove', 10, 200));
    expect(deltas).toEqual([30, -20]);
  });

  it('ось x считает смещение по clientX; pointercancel тоже завершает жест', () => {
    const target = new EventTarget();
    const deltas: number[] = [];
    let ended = 0;
    startPointerDrag({ clientX: 50, clientY: 0, pointerId: 1, preventDefault: () => {} },
      { axis: 'x', onDelta: d => deltas.push(d), onEnd: () => { ended++; } }, target);
    target.dispatchEvent(pe('pointermove', 75, 999));
    target.dispatchEvent(pe('pointercancel', 75, 999));
    expect(deltas).toEqual([25]);
    expect(ended).toBe(1);
  });

  it('мышиные события жест не двигают — слушаем pointer, не mouse', () => {
    const target = new EventTarget();
    const deltas: number[] = [];
    startPointerDrag({ clientX: 0, clientY: 0, pointerId: 1, preventDefault: () => {} },
      { axis: 'y', onDelta: d => deltas.push(d) }, target);
    target.dispatchEvent(pe('mousemove', 0, 40));
    expect(deltas).toEqual([]);
  });

  it('ручка запрещает браузеру забирать жест под прокрутку; clamp держит границы', () => {
    expect(dragHandleTouch.touchAction).toBe('none');
    expect(clamp(700, 120, 600)).toBe(600);
    expect(clamp(50, 120, 600)).toBe(120);
    expect(clamp(300, 120, 600)).toBe(300);
  });
});
