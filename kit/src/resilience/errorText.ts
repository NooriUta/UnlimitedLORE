// Общее для экрана ошибки React (ErrorBoundary, S4-00f) и голого экрана
// ошибки бандла (errorScreen, K-06): что считать падением и как его назвать.

/** Сообщения браузера, которые не означают падения приложения. */
export const BENIGN_ERRORS = [/^ResizeObserver loop/i];

export function isBenignError(message: string | undefined, error: unknown): boolean {
  return !error && BENIGN_ERRORS.some((re) => re.test(message ?? ''));
}

/** Текст ошибки для экрана: сообщение Error, строка или JSON — без «[object Object]». */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
