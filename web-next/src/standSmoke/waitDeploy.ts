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
