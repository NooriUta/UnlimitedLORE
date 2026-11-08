// SPRINT_UXR_S0_SAFETY/S0-07 — исходник компонента по ИМЕНИ, а не по пути.
//
// Гварды-«линтеры» (кликабельный span без role, экран берёт раскладку из
// mobileLayout) законно читают исходник: это правило кода, его не видно в DOM.
// Хрупким было другое — привязка к пути файла: перенос компонента в другую
// папку ронял тест при работающем коде. Здесь файл ищется по тому, где объявлен
// компонент, поэтому переезд файла тест не трогает, а пропажа компонента —
// громкая ошибка с его именем.

const CORPUS = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const isTest = (path: string) => /\.(test|spec)\.tsx?$/.test(path);

/** Путь файла, где объявлен компонент `name` (function / const), или null. Два определения — ошибка. */
export function findDefining(corpus: Record<string, string>, name: string): string | null {
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:default\\s+)?(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*[:=])`);
  const hits = Object.keys(corpus).filter(p => !isTest(p) && decl.test(corpus[p]));
  if (hits.length > 1) throw new Error(`компонент ${name} объявлен в нескольких файлах: ${hits.join(', ')}`);
  return hits[0] ?? null;
}

/** Исходник файла, где объявлен компонент `name`. Не найден — ошибка с именем. */
export function sourceOf(name: string): string {
  const path = findDefining(CORPUS, name);
  if (!path) throw new Error(`исходник компонента ${name} не найден`);
  return CORPUS[path];
}
