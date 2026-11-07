// STYLE-01 для v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a): правила одни на kit и
// web-next. Строже v1: унаследованных исключений нет — любое число в
// fontSize/font-size и любой сырой цвет вне файла токенов (seidr.css) запрещён.
// Экспортируется как @seidr/kit/style-guard, чтобы каждый потребитель kit мог
// поставить у себя тот же гвард, а не копию правил.

/** Правила — регулярки, а не проверки на месте: так их можно проверить положительным контролем. */
export const STYLE_RULES = {
  tsxFontSize: /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px|rem|em)?['"]?(?=[,\s}])/g,
  cssFontSize: /font-size:\s*\d+(?:\.\d+)?(?:px|rem|em|pt)\b/g,
  cssFontShorthand: /\bfont:\s*[^;]*?\b\d+(?:\.\d+)?(?:px|rem|em|pt)\b/g,
  hex: /#[0-9a-fA-F]{3,8}\b(?![\w-])/g,
  rgb: /\b(?:rgba?|hsla?)\(/g,
} as const;

/** Комментарии не считаются: в них законно цитируют прежние значения. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Нарушения правила по набору файлов: `путь: найденное, …`; skip — файлы-исключения. */
export function styleViolations(
  files: Record<string, string>,
  rule: RegExp,
  skip: (path: string) => boolean = () => false,
): string[] {
  const out: string[] = [];
  for (const [path, src] of Object.entries(files)) {
    if (skip(path)) continue;
    const found = stripComments(src).match(rule);
    if (found) out.push(`${path}: ${[...new Set(found)].join(', ')}`);
  }
  return out;
}
