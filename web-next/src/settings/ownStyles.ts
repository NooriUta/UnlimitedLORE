// Свои стили установки, известные приложению (SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE, решение 1а).
// Токены приходят из модели (/lore/model → palettes.entries[].tokens, их проверил сервер); применение настроек
// (applySettings) берёт отсюда токены выбранного своего стиля. Модель ещё не пришла — стиля нет, действует
// база amber forest; когда пришла, AccountMenu применяет настройки заново.
import type { OwnStyleTokens } from '@seidr/kit';

let styles: Record<string, OwnStyleTokens> = {};

export function setOwnStyles(next: Record<string, OwnStyleTokens>): void {
  styles = { ...next };
}

export function ownStyle(code: string): OwnStyleTokens | null {
  return Object.prototype.hasOwnProperty.call(styles, code) ? styles[code] : null;
}
