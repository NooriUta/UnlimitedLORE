// Таблица связей записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-37).
//
// Замечание владелицы по v2 на проде (v1.17.4): «связи пока там, где я хотела
// бы видеть таблицы… наши любимые общие колонки». До этого вкладки связей
// рисовали список названий: ни статуса, ни вида, ни кода — то есть о связанной
// записи было известно меньше, чем о той же записи в списке.
//
// «Общие колонки» здесь значит буквально те же: «Статус», «Вид», «Код»,
// «Запись». Код и запись — разными колонками (решение владелицы 08.11).
//
// 11.11.2026 (владелица): «в паспорте, где табличный вид свёрнут под "ещё",
// должны идти стандартные сортировки, фильтры, группировки … и поиск тоже».
// Поэтому таблица — уже не свои строки, а тот же список kit, что у разделов
// (`NestedList` → `ListView`): поиск, фасеты, группировка и порядок — общие,
// своих таблица не рисует.
//
// Чего таблица НЕ делает: не додумывает. Запись, которой нет в выгрузке, не
// пропадает и не получает выдуманный статус — строка той же таблицы с кодом и
// честной пометкой, статус и вид пустые.
import { useMemo } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { kitT, type KitLang } from '../i18n';
import { NestedList } from '../list/NestedList';
import type { ListRowAction } from '../list/ListView';
import { findRecord } from './fmt';

export interface RelationTableProps {
  ctx: KitCtx;
  lang: KitLang;
  /** Кого связывает ребро. Пустой список сюда не передают: о пустоте говорит вызывающий. */
  ids: readonly string[];
  /** Отвязать; нет — действия нет (композицию отвязать нельзя). */
  onUnlink?: (target: string) => void;
  /** Метка для теста единственной связи на вкладке. */
  testId?: string;
  /** S9-05 / D14: колонки, названные приложением для этой связи; нет — общие. */
  columns?: readonly string[];
  /** Свойства ребра параллельно `ids` — ложатся в поля строки (у каждого ребра свои). */
  values?: readonly (Record<string, unknown> | undefined)[];
  /** Подписи колонок-свойств ребра. */
  fieldLabels?: Record<string, string>;
}

/** Иконка «отвязать» — из вшитого набора lucide (как прочие управляющие иконки). */
const UNLINK_ICON = 'lucide:circle-x';

export function RelationTable({ ctx, lang, ids, onUnlink, testId, columns, values, fieldLabels }: RelationTableProps) {
  const { found, missing } = useMemo(() => {
    const f: KitRecord[] = [];
    const m: string[] = [];
    ids.forEach((id, i) => {
      const r = findRecord(ctx, id);
      const v = values?.[i];
      if (r) f.push(v ? { ...r, fields: { ...r.fields, ...v } } : r); else m.push(id);
    });
    return { found: f, missing: m };
  }, [ctx, ids, values]);
  const rowActions: ListRowAction[] | undefined = onUnlink
    ? [{
      id: 'unlink',
      title: kitT(lang, 'kit.record.rel.linkBtn'),
      icon: UNLINK_ICON,
      label: r => kitT(lang, 'kit.record.rel.unlink', { title: r.title || r.id }),
      run: ([id]) => { if (id) onUnlink(id); },
    }]
    : undefined;
  return <NestedList ctx={ctx} records={found} missing={missing} rowActions={rowActions} testId={testId} className="sk-rel__table"
    columns={columns ? [...columns] : undefined} fieldLabels={fieldLabels} />;
}
