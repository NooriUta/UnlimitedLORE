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
