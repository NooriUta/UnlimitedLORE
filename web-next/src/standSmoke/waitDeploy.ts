// E2E-STAND: ждать, пока стенд отдаст ожидаемый коммит (/lore/version → commit), и только
// потом гнать смоук. Push в preprod запускает и выкатку (lore-cd.yml), и смоук; без ожидания
// смоук проверил бы прошлую сборку и выдал бы её зелёный за новую.

export interface DeployState { reached: boolean; seen: string | null }

/** Хэш короче 7 знаков — не опознание сборки. */
const MIN_SHA = 7;

export function deployState(httpStatus: number, body: unknown, expected: string): DeployState {
  const raw = body && typeof body === 'object' ? (body as { commit?: unknown }).commit : undefined;
  const seen = typeof raw === 'string' && raw ? raw : null;
  const a = (seen ?? '').toLowerCase();
  const b = expected.trim().toLowerCase();
  const reached = httpStatus === 200 && a.length >= MIN_SHA && b.length >= MIN_SHA
    && (a.startsWith(b) || b.startsWith(a));
  return { reached, seen };
}

/** Сколько раз за одно ожидание можно войти заново: токен живёт ~15 мин, ожидание — до 40. */
export const MAX_RELOGINS = 6;

/**
 * 401 — токен сохранённого входа истёк (прогон 9017, 18.11.2026: 15 мин выкатки в очереди — и до конца ожидания
 * сплошные 401). Повод войти заново, пока не исчерпан запас; иначе — честный отказ по сроку.
 */
export function shouldRelogin(httpStatus: number, reloginsDone: number): boolean {
  return httpStatus === 401 && reloginsDone < MAX_RELOGINS;
}

/**
 * Изменились только документы: файлы *.md и всё под docs/. Тогда выкатка сборку не меняет, и стенд на прошлом
 * коммите — это и есть сборка головы. Прогон 9044 (19.11.2026): мерж #1600 правил одно RELEASE-v1.17.28.md, стенд
 * остался на 03de99d0, смоук 40 мин ждал d8c099e6 и упал без единого сценария. Пустой список — «не знаем», не «да».
 */
/**
 * Выкатывает ли CD бэкенд для этого набора правок — по выводу `.github/scripts/ci-scope.sh cd` (правило одно с CD,
 * здесь только чтение). false — бэкенд не пересобирается, /lore/version законно остаётся на прежнем коммите
 * (прогон 37943, 19.11.2026: правки только тестов). null — вывод не разобран, ждём как раньше.
 */
export function backendDeployExpected(scopeOutput: string): boolean | null {
  const m = /^backend=(true|false)\s*$/m.exec(scopeOutput);
  return m ? m[1] === 'true' : null;
}

export function docsOnlyChange(files: string[]): boolean {
  return files.length > 0 && files.every(f => /\.md$/i.test(f) || f.startsWith('docs/'));
}
