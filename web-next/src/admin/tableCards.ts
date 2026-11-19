// Таблицы админки на телефоне — карточками (админка 1.18, снимки с ryzenai 19.11: на 390 px таблицы были шире
// экрана и резали колонки — «Агенты» 374→1294, «Журнал» 374→1036, «Флаги» 374→628).
//
// Раскладку делает CSS (Admin.css, порог kit NARROW_QUERY): строка — карточка, клетка — блок. Чтобы клетка
// в карточке не осталась без имени колонки, ей нужна подпись: здесь заголовок колонки копируется в data-label
// каждой клетки, и CSS рисует его над значением. Один механизм на все таблицы админки — экраны ничего не размечают.
import { useEffect, type RefObject } from 'react';

/** Подписать клетки таблиц .adm-table под корнем заголовками колонок (с учётом colSpan). */
export function labelTableCells(root: ParentNode): void {
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table.adm-table'))) {
    const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
    if (!headRow) continue;
    const heads: string[] = [];
    for (const th of Array.from(headRow.cells)) {
      const text = (th.textContent ?? '').replace(/\s+/g, ' ').trim();
      for (let i = 0; i < Math.max(1, th.colSpan); i++) heads.push(text);
    }
    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        let col = 0;
        for (const cell of Array.from(row.cells)) {
          // клетка на несколько колонок (раскрытая панель строки) — не колонка, подпись ей не нужна
          const label = cell.colSpan > 1 ? '' : heads[col] ?? '';
          if (label) {
            if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
          } else if (cell.hasAttribute('data-label')) {
            cell.removeAttribute('data-label');
          }
          col += Math.max(1, cell.colSpan);
        }
      }
    }
  }
}

/** Держит подписи клеток в актуальном виде, пока экран меняет таблицы (загрузка, фильтр, «Показать ещё»). */
export function useTableCardLabels(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    labelTableCells(root);
    if (typeof MutationObserver === 'undefined') return;
    // Только состав и текст: свои же атрибуты data-label наблюдатель не видит — петли нет.
    const mo = new MutationObserver(() => labelTableCells(root));
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [ref]);
}
