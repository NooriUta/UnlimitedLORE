import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

/**
 * Тема Mantine, ПРИВЯЗАННАЯ к нашим токенам (ADR: узкий пилот Mantine).
 *
 * Условие, без которого библиотеку брать нельзя: Mantine несёт собственную
 * систему переменных (`--mantine-color-*`, `--mantine-font-size-*`, радиусы,
 * отступы). Если оставить её как есть, в проекте окажутся ДВЕ параллельные
 * палитры — ровно та болезнь, что уже найдена в STYLE-01: обе выглядят
 * действующими, расходятся молча, а какая победит, решает порядок импорта.
 *
 * Поэтому здесь не «настройка под наш вид», а СВЕДЕНИЕ к одному источнику:
 * значения берутся из `var(--…)` нашего `tokens.css`. Меняется палитра там —
 * меняется и Mantine, без правки этого файла. Хардкодить сюда hex нельзя:
 * это и создаст вторую систему, которую мы пытаемся не заводить.
 */

/**
 * Mantine требует ровно 10 оттенков на цвет и индексирует их 0…9.
 * У нас плоские токены без шкалы, поэтому все ступени указывают на один и тот
 * же `var(--…)`: honest degradation. Подделывать несуществующие оттенки
 * (осветлять/затемнять вычислением) значило бы придумать палитру, которой в
 * дизайне нет, и она бы разъехалась с нашей при первой же правке темы.
 */
const flat = (cssVar: string): MantineColorsTuple =>
  Array(10).fill(`var(${cssVar})`) as unknown as MantineColorsTuple;

export const mantineTheme = createTheme({
  colors: {
    acc: flat('--acc'),
    suc: flat('--suc'),
    wrn: flat('--wrn'),
    dng: flat('--dng'),
    inf: flat('--inf'),
  },
  primaryColor: 'acc',
  // Оттенок не выбирается — шкалы нет, любой индекс даёт один цвет.
  primaryShade: 5,

  fontFamily: 'var(--font)',
  fontFamilyMonospace: 'var(--mono)',
  headings: { fontFamily: 'var(--display)' },

  // Шкала T24 целиком: та же, что в tokens.css, без промежуточных значений.
  fontSizes: {
    xs: 'var(--fs-2xs)',
    sm: 'var(--fs-xs)',
    md: 'var(--fs-sm)',
    lg: 'var(--fs-base)',
    xl: 'var(--fs-md)',
  },

  radius: { xs: '3px', sm: '4px', md: '6px', lg: '8px', xl: '12px' },
  defaultRadius: 'md',


  components: {
    Modal: {
      styles: {
        content: { background: 'var(--bg1)', color: 'var(--t1)' },
        header: { background: 'var(--bg1)', color: 'var(--t1)', borderBottom: '1px solid var(--bd)' },
        title: { fontFamily: 'var(--display)', fontSize: 'var(--fs-md)' },
      },
    },
    Drawer: {
      styles: {
        content: { background: 'var(--bg1)', color: 'var(--t1)' },
        header: { background: 'var(--bg1)', color: 'var(--t1)', borderBottom: '1px solid var(--bd)' },
      },
    },
    Popover: { styles: { dropdown: { background: 'var(--bg2)', borderColor: 'var(--bd)', color: 'var(--t1)' } } },
    Menu:    { styles: { dropdown: { background: 'var(--bg2)', borderColor: 'var(--bd)', color: 'var(--t1)' } } },
    Tooltip: { styles: { tooltip: { background: 'var(--bg3)', color: 'var(--t1)', fontSize: 'var(--fs-sm)' } } },
    Input: {
      styles: {
        input: {
          background: 'var(--bg2)', borderColor: 'var(--bd)', color: 'var(--t1)',
          fontFamily: 'var(--font)', fontSize: 'var(--fs-base)',
        },
      },
    },
    InputWrapper: {
      styles: {
        label: { color: 'var(--t2)', fontSize: 'var(--fs-sm)', marginBottom: 3 },
        description: { color: 'var(--t3)', fontSize: 'var(--fs-xs)' },
        error: { color: 'var(--dng)', fontSize: 'var(--fs-xs)' },
      },
    },
  },
});

/**
 * ПРИВЯЗКА СОБСТВЕННЫХ ПЕРЕМЕННЫХ MANTINE к нашим токенам.
 *
 * Без этого библиотека рисует на своих значениях: замерено в браузере —
 * `--mantine-color-body` был `#242424` при `--bg2: #ffffff`, то есть выпадающий
 * календарь приезжал белым поверх интерфейса и жил своей жизнью. Настройка
 * `theme.other` на это не влияет вовсе — она лишь хранилище произвольных
 * значений для собственного кода, а не источник переменных.
 *
 * Значения указывают на наши `var(--…)`, поэтому переключение темы приложения
 * (тёмная/светлая, палитра amber/slate в шапке) утягивает за собой и Mantine
 * автоматически: отдельной синхронизации нет и не нужно.
 *
 * `light` и `dark` заполнены ОДИНАКОВО намеренно: наши токены сами меняются по
 * `data-mode`/`data-theme` на корне. Развести их значило бы завести вторую
 * точку переключения темы — и однажды они разойдутся.
 */
const surfaces = {
  '--mantine-color-body': 'var(--bg0)',
  '--mantine-color-text': 'var(--t1)',
  '--mantine-color-dimmed': 'var(--t3)',
  '--mantine-color-default': 'var(--bg2)',
  '--mantine-color-default-hover': 'var(--bg3)',
  '--mantine-color-default-color': 'var(--t1)',
  '--mantine-color-default-border': 'var(--bd)',
  '--mantine-color-placeholder': 'var(--t3)',
  '--mantine-color-anchor': 'var(--acc)',
  '--mantine-color-error': 'var(--dng)',
  '--mantine-color-disabled': 'var(--bg1)',
  '--mantine-color-disabled-color': 'var(--t3)',
};

export const mantineCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: surfaces,
  dark: surfaces,
});
