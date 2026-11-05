// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 — раскладка экранов LORE на телефоне.
//
// Тот же приём, что adminLayout.ts: стиль контейнера и панелей — чистые функции
// от `narrow`, чтобы правило держалось тестом (mobileLayout.test.ts), а не
// глазами на стенде. Десктопная ветка (narrow=false) повторяет прежние значения
// экранов один в один — менять десктоп эта задача не должна.
//
// Правила, которые здесь закреплены:
//  1. Контейнер с overflow:hidden сам раскладывает детей (flex/grid), а
//     прокручиваемая область получает ограниченную высоту (flex:1 + minHeight:0).
//  2. Две колонки фиксированной ширины в 375px не помещаются по построению —
//     на телефоне либо одна колонка, либо «одна панель + ← назад».
//  3. Лента вкладок шире экрана листается вбок, а не распирает панель.

/** Одна колонка, которая не распирается содержимым (minmax(0,…) вместо 1fr). */
export const ONE_COL = 'minmax(0, 1fr)';

/**
 * «Список → деталь → назад». Десктоп: обе панели рядом, кнопки назад нет.
 * Телефон: ровно одна панель — деталь, когда она открыта, иначе список.
 */
export function masterDetailPanes(narrow: boolean, hasDetail: boolean) {
  if (!narrow) return { showList: true, showDetail: true, showBack: false };
  return { showList: !hasDetail, showDetail: hasDetail, showBack: hasDetail };
}

/** Лента вкладок/чипов: одна строка, листается вбок, не сжимается по высоте. */
export const scrollStrip = {
  overflowX: 'auto' as const, overflowY: 'hidden' as const,
  flexWrap: 'nowrap' as const, flexShrink: 0, scrollbarWidth: 'thin' as const,
};
/** Элемент ленты: не сжимается и не переносит подпись. */
export const stripItem = { flexShrink: 0, whiteSpace: 'nowrap' as const };

/** Шапка с заголовком и кнопками: на любой ширине переносится, а не уезжает за край. */
export function wrapHeader(narrow: boolean) {
  return { flexWrap: 'wrap' as const, rowGap: 6, padding: narrow ? '8px 12px' : '12px 20px' };
}

// ── TYR · отчёты (tyr.css .layout-reports) ─────────────────────────────────
/**
 * На телефоне сетка отчётов была `auto minmax(0,1fr)`: .sidebar росла по длине
 * истории прогонов, и отчёту доставалось 0px. Теперь панель одна, и её строка —
 * minmax(0,1fr): она сама ограничена по высоте и прокручивается внутри.
 */
export function tyrReportsLayout(narrow: boolean, hasRun: boolean) {
  const p = masterDetailPanes(narrow, hasRun);
  return { ...p, gridTemplateRows: narrow ? ONE_COL : undefined };
}

// ── Timeline ──────────────────────────────────────────────────────────────
/**
 * Строка ленты: дата 80 + тип 62 + ref 130 + заголовок ≈ 354px, заголовку на
 * 375px места не оставалось. Телефон: строка переносится, заголовок — своей
 * строкой на всю ширину, подпись типа прячется (тип и так несёт цвет иконки).
 */
export function timelineRow(narrow: boolean) {
  return narrow
    ? { row: { flexWrap: 'wrap' as const, rowGap: 2, padding: '7px 12px' },
        ref: { minWidth: 0, flexShrink: 1 },
        title: { flexBasis: '100%', whiteSpace: 'normal' as const },
        showKind: false }
    : { row: {}, ref: {}, title: {}, showKind: true };
}

// ── Evolution (SCD2-история) ──────────────────────────────────────────────
/** Список 220px слева: на телефоне — одна панель на всю ширину. */
export function evolutionPanes(narrow: boolean, hasEntity: boolean) {
  const p = masterDetailPanes(narrow, hasEntity);
  return { ...p, listWidth: narrow ? '100%' : 220, listBorderRight: !narrow };
}

// ── BRAGI · план ──────────────────────────────────────────────────────────
/**
 * `1.7fr 1fr` + паддинги карточки оставляли ячейке календаря ≈20px. Телефон:
 * карточки друг под другом, у календаря узкие зазоры и паддинги, в ячейке
 * вместо «канал · заголовок» — только буква канала (заголовок в title).
 */
export function bragiPlanLayout(narrow: boolean) {
  return narrow
    ? { gridCols: ONE_COL, calCols: 'repeat(7, minmax(0, 1fr))', calGap: 2,
        cardPad: '10px 8px', cellPad: 2, cellMinH: 52, compactChips: true }
    : { gridCols: '1.7fr 1fr', calCols: 'repeat(7, 1fr)', calGap: 6,
        cardPad: '16px 18px', cellPad: 6, cellMinH: 78, compactChips: false };
}

// ── Паспорт компонента ────────────────────────────────────────────────────
/**
 * Верх паспорта — фиксированная высота (280, тянется ручкой). С overflow:hidden
 * открытая форма редактирования уходила под край, и «Сохранить» было не
 * достать. Десктоп: высота та же, но верх прокручивается. Телефон: высоты нет
 * вовсе — паспорт и читалка идут одной колонкой с общей прокруткой, ручка
 * ресайза не рисуется (тянуть нечего).
 */
export function passportLayout(narrow: boolean, topHeight: number) {
  if (narrow) {
    return {
      root: { overflowY: 'auto' as const, overflowX: 'hidden' as const },
      top: { height: 'auto' as const, flexShrink: 0, overflow: 'visible' as const },
      reader: { flex: 'none' as const, overflow: 'visible' as const },
      readerScroll: { flex: 'none' as const, overflowY: 'visible' as const },
      showHandle: false,
    };
  }
  return {
    root: {},
    top: { height: topHeight, flexShrink: 0, overflowY: 'auto' as const, overflowX: 'hidden' as const },
    reader: {},
    readerScroll: {},
    showHandle: true,
  };
}

// ── Biblio (граф источников) ──────────────────────────────────────────────
/**
 * Панель деталей 300px поверх холста + холст `right: 300` — на 375px холсту
 * оставалось ≈0. Телефон: открытая панель занимает всю область (одна панель,
 * «← назад» закрывает её), холст под ней не сжимается.
 */
export function biblioPanes(narrow: boolean, hasPanel: boolean) {
  return {
    canvasRight: !narrow && hasPanel ? 300 : 0,
    panel: narrow ? { left: 0, width: 'auto' as const } : { width: 300 },
    showBack: narrow && hasPanel,
  };
}

// ── Вехи ──────────────────────────────────────────────────────────────────
/** Две колонки спринтов вехи (`1fr 1fr`): на телефоне — одна. */
export function milestonesTwoCol(narrow: boolean) {
  return { gridTemplateColumns: narrow ? ONE_COL : '1fr 1fr' };
}
