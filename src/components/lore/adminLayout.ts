// Раскладка оболочки админки — вынесена из LoreAdminPanel.tsx, чтобы правило
// прокрутки на узком экране держалось тестом (adminLayout.test.ts).
// Правило: контейнер с overflow:hidden обязан раскладывать детей сам (flex/grid),
// а прокручиваемая область — получать ограниченную высоту (flex:1 + minHeight:0).
// display:block здесь давал main высоту по контенту, и на телефоне не было скролла.

export const adminShell = (narrow: boolean) => ({
  display: narrow ? 'flex' : 'grid',
  flexDirection: 'column' as const,
  gridTemplateColumns: '212px 1fr',
  gap: 0, flex: 1, minHeight: 0, overflow: 'hidden' as const,
});

// На узком экране навигация — одна строка, листается вбок: перенос в несколько
// рядов съедал верх экрана, а сжатие flex-колонкой обрезало бы кнопки.
export const adminSide = (narrow: boolean) => ({
  background: 'var(--bg1)', padding: narrow ? '8px 10px' : '12px 8px',
  borderRight: narrow ? 'none' : '1px solid var(--bd)',
  borderBottom: narrow ? '1px solid var(--bd)' : 'none',
  display: 'flex', flexDirection: (narrow ? 'row' : 'column') as 'row' | 'column',
  gap: narrow ? 14 : 16, overflowX: 'auto' as const, flexWrap: 'nowrap' as const,
  flexShrink: 0,
});

export const adminMain = { padding: '12px 16px', minWidth: 0, minHeight: 0, flex: 1, overflowY: 'auto' as const };

// AH-05 (прототип admin-v2). Телефон: над содержимым — строка «где я» и лента
// вкладок с подписями групп (вариант A). Лента — то же правило, что adminSide(true):
// одна строка, листается вбок, не сжимается.
export const adminStrip = {
  display: 'flex', alignItems: 'center' as const, gap: 4, padding: '6px 12px',
  overflowX: 'auto' as const, flexWrap: 'nowrap' as const, flexShrink: 0,
  scrollSnapType: 'x proximity', scrollbarWidth: 'none' as const,
};

/** Тап-цель: на телефоне 40px (палец), на десктопе 26px (плотный IDE-UI). */
export const tapMin = (narrow: boolean) => (narrow ? 40 : 26);

/** «Люди»: десктоп — список | карточка рядом; телефон — одна колонка. */
export const peopleSplit = (narrow: boolean, hasCard: boolean) => ({
  display: 'grid', gap: 12, alignItems: 'start' as const,
  gridTemplateColumns: !narrow && hasCard ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)',
});

/** На телефоне открытая карточка занимает экран целиком — список не рисуется. */
export const showPeopleList = (narrow: boolean, hasCard: boolean) => !(narrow && hasCard);

/** AH-05 п.2: кнопка действия — на телефоне 40px и делит ширину карточки, на десктопе плотная. */
export const actBtn = (narrow: boolean) => ({
  minHeight: tapMin(narrow), flex: narrow ? 1 : undefined,
  display: 'inline-flex', alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4,
});

/**
 * SH-13: поле поиска. На телефоне — во всю ширину, тап-цель 40px и шрифт 16px:
 * iOS приближает страницу при фокусе на поле со шрифтом меньше 16px, и после
 * ввода админка остаётся увеличенной. 16px — отдельный токен (--fs-touch-input),
 * а не ступень шкалы: он нужен ровно полям ввода на сенсорном экране.
 */
export const searchBox = (narrow: boolean) => ({
  wrap: {
    display: 'flex', alignItems: 'center' as const, gap: 6, flex: 1, minWidth: narrow ? 0 : 150,
    maxWidth: narrow ? 'none' : 300, flexBasis: narrow ? '100%' : undefined,
    minHeight: tapMin(narrow), padding: '0 8px', borderRadius: 5,
    border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t3)',
  },
  input: {
    flex: 1, minWidth: 0, border: 'none', background: 'none', outline: 'none', color: 'var(--t1)',
    fontFamily: 'inherit', fontSize: narrow ? 'var(--fs-touch-input)' : 'var(--fs-sm)', padding: '3px 0',
  },
});
