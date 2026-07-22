// Mantine требует свой PostCSS-пресет: он разворачивает миксины `light-dark()`,
// `rem()` и медиа-переменные, которыми написаны стили библиотеки. Без него
// компоненты приезжают с неразвёрнутыми функциями и ломаются молча — вёрстка
// выглядит «почти правильной».
//
// Брейкпоинты заданы теми же значениями, что Mantine использует по умолчанию:
// в проекте своя точка перелома (narrow ≈ 900px) живёт в JS, а не в CSS, и
// смешивать две системы медиа-запросов здесь незачем.
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
};
