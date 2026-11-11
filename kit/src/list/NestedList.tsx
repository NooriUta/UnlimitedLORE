// Список записей ВНУТРИ другой записи (вкладка паспорта, таблица детей,
// связи) — со стандартным управлением списка: поиск, фильтр, группировка,
// порядок.
//
// Повод — владелица 11.11.2026: «в паспорте, где табличный вид свёрнут под
// "ещё", должны идти стандартные сортировки, фильтры, группировки … и поиск
// тоже, и вообще проверь, чтобы у всех табличных представлений они были по
// умолчанию». До этого таблицы внутри паспорта рисовали свои строки без
// управления, и на сорока строках одну находили глазами.
//
// ПОЭТОМУ ЭТО НЕ НОВАЯ ТАБЛИЦА, а тот же ListView, что у разделов: своё
// управление здесь не рисуется. Обёртка задаёт только то, чем вложенный список
// отличается от раздела:
//   • состояние в памяти, а не в адресе — адрес принадлежит разделу, и вкладка
//     паспорта не должна переписывать его фильтры;
//   • фильтр и группировка — по статусу всегда и по виду, когда видов больше
//     одного (один вид — фасет с единственным значением был бы шумом);
//   • закрытые показываются все: ребёнок или связь — это состав записи, и
//     прятать её часть по умолчанию значило бы солгать о составе.
//
// Предметных имён нет (K-14): какие записи — решает вызывающий.
import { useMemo, type ReactNode } from 'react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { ListView, type ListRowAction } from './ListView';

export interface NestedListProps {
  ctx: KitCtx;
  /** Записи списка — уже найденные; порядок сохраняется, пока не выбран свой. */
  records: readonly KitRecord[];
  /** Ссылки на записи, которых нет в выгрузке: строкой с пометкой, ничего не додумывая. */
  missing?: readonly string[];
  /** Колонки; по умолчанию «общие колонки» списка: Статус · Вид · Код · Запись. */
  columns?: string[];
  /** Действия строки (например, «отвязать») — через хуки вызывающего. */
  rowActions?: ListRowAction[];
  /** Метка для теста на обёртке. */
  testId?: string;
  className?: string;
  /** Оговорка под списком (например, «показаны 100 из 230»). */
  note?: ReactNode;
  /**
   * Свои оси фильтра и группировки (S4-SPRINT-TASKS-CONTROLS): встают ПОСЛЕ
   * умолчания (статус, вид), без дублей. Какие — решает вызывающий (K-14).
   */
  axes?: readonly string[];
}

export const NESTED_COLUMNS = ['status', 'kind', 'id', 'title'] as const;

export function NestedList({ ctx, records, missing, columns, rowActions, testId, className, note, axes: ownAxes }: NestedListProps) {
  const multiKind = useMemo(() => new Set(records.map(r => r.kind)).size > 1, [records]);
  const config: KitConfig = useMemo(() => {
    const base = multiKind ? ['status', 'kind'] : ['status'];
    const axes = [...base, ...(ownAxes ?? []).filter(a => !base.includes(a))];
    return {
      ...ctx.config,
      list: {
        views: ['list'],
        columns: columns ?? [...NESTED_COLUMNS],
        filters: axes,
        groupings: axes,
        showClosed: 'all',
      },
    };
  }, [ctx.config, columns, multiKind, ownAxes]);
  const data = useMemo(() => ({ ...ctx.data, records: [...records] }), [ctx.data, records]);
  return (
    <div className={['sk-nested', className].filter(Boolean).join(' ')} data-testid={testId}>
      <ListView
        config={config}
        data={data}
        href={ctx.href}
        ctx={ctx}
        urlState={false}
        rowActions={rowActions}
        missing={missing}
      />
      {note && <p className="sk-nested__note" role="status">{note}</p>}
    </div>
  );
}
