// Что из личных настроек УЖЕ применено к документу (S4-02, S5-14).
//
// Настройки приходят с сервера (`useSettings`) и ложатся атрибутами на корень
// (`applySettings`). Но экраны живут далеко от панели настроек: список и
// паспорт рисуются в другом месте дерева и состояние настроек не получают.
//
// Находка CJM на проде 09.11.2026: `data-read-nav` и `data-right-column` не
// читал НИКТО — ни kit, ни web-next, ни CSS. То есть «Правая колонка записи» и
// «Меню при чтении записи» сохранялись и не меняли ничего, а в панели рядом
// стоял ВТОРОЙ блок про то же самое (режим чтения kit) со своим значением.
// Человек видел две правды, и обе были мёртвыми.
//
// Поэтому чтение здесь — из того же места, куда настройка применена. Один
// источник: что применено, то и прочитано. Состояние настроек НЕ дублируется в
// каждый экран пропсами — иначе появилась бы третья правда.
export type RightColumn = 'auto' | 'open' | 'closed';

/** Где искать атрибуты; null — документа нет (сервер, тесты). */
type Host = { getAttribute(name: string): string | null } | null;

function host(given?: Host): Host {
  if (given !== undefined) return given;
  return typeof document === 'undefined' ? null : document.documentElement;
}

/**
 * Правая колонка записи по выбору человека.
 *
 * `auto` — выбора НЕ БЫЛО: решает экран. Подменять молчание на «закрыто»
 * нельзя — человек не выбирал закрыть.
 */
export function appliedRightColumn(given?: Host): RightColumn {
  const v = host(given)?.getAttribute('data-right-column');
  return v === 'open' || v === 'closed' ? v : 'auto';
}

/** Сворачивать ли меню оболочки, пока открыта запись (D-2026-UXR-READ-COLLAPSE). */
export function appliedCollapseNavOnRead(given?: Host): boolean {
  return host(given)?.getAttribute('data-read-nav') === 'collapse';
}

/** Карточки Peek по наведению (S9-10). Нет атрибута — включено: человек не выключал. */
export function appliedPeekHover(given?: Host): boolean {
  return host(given)?.getAttribute('data-peek-hover') !== 'off';
}

/** Показывать ли технические сведения (S4-TECH-NOTES). Атрибута нет — нет. */
export function appliedShowTech(given?: Host): boolean {
  return host(given)?.getAttribute('data-show-tech') === 'on';
}
