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
