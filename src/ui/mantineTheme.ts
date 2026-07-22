import { createTheme, type MantineColorsTuple } from '@mantine/core';

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

  /**
   * Поверхности и текст. Mantine рисует оверлеи на своих `--mantine-color-body`
   * и `--mantine-color-text`; без этой привязки модалка приезжала бы белой на
   * тёмной теме — и это заметили бы сразу. Хуже другое: границы и приглушённый
   * текст разошлись бы с нашими незаметно.
   */
  other: {
    bodyBg: 'var(--bg0)',
    surfaceBg: 'var(--bg1)',
    borderColor: 'var(--bd)',
    textColor: 'var(--t1)',
    dimmedColor: 'var(--t3)',
  },

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
