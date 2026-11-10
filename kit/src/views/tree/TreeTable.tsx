// Иерархия таблицей: дерево с ОДИНАКОВЫМИ столбцами на всех уровнях
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED, развитие K-09).
//
// Контракт владелицы: вложенное показывается блоком своего вида (`KindBlock`),
// и ровно одно исключение — ИЕРАРХИЯ: её рисуют деревом с одинаковыми
// столбцами на всех уровнях. Уровень 1 → уровень 2 → уровень 3; среднего
// уровня может не быть вовсе — тогда третий встаёт на второй, и разметка не
// меняется.
//
// Что здесь переиспользовано, а не написано заново:
//   • сборка дерева из ПЛОСКОГО списка — `buildTree` (K-09): разрыв циклов,
//     запись с ненайденным родителем не теряется, порядок детей устойчив;
//   • ячейки — `KindCell` вида (S4-TREE-NESTED): та же ячейка, что у строки
//     вложенного блока, поэтому «одинаковые столбцы» значит буквально
//     одинаковые, а не похожие. Статус — `StatusSlot`: плашка или кнопка по
//     правам, как в паспорте;
//   • подписи столбцов — `groupKeyTitle` (S4-06), словарь списка;
//   • шапка группы — классы групп списка (`.sk-list__ghead`, `.sk-list__gbtn`,
//     `.sk-list__gtitle`, `.sk-list__gcount`): своих украшений группа не
//     заводит.
//
// Уровни приходят ДАННЫМИ (K-14): kit не знает, что лежит на уровне 1 и что на
// уровне 3, и предметных имён в этом файле нет ни одного.
//
// Честные состояния уровня — половина этой работы. `levelState` приходит рядом с
// рядами, той же формой, что `parts[].state` фасада:
//   • `none` — ПРОВЕРЕНО, что уровня нет: он пропускается молча, записи глубже
//     встают на его место. Оговорка здесь была бы шумом;
//   • `denied` — уровень есть, но его не отдали: ждать нечего, надо просить
//     доступ. Пропустить молча нельзя — иначе дерево выглядит полным;
//   • `error` — не смогли прочитать: ветви могут быть неполными, и это чинится;
//   • `truncated` — отдали не всё: часть записей уровня в выдачу не попала;
//   • незнакомое состояние — тоже вслух, вместе с самим значением (правило
//     `dataStateOf`): пропустить его значило бы объявить уровень исправным,
//     ничего о нём не зная.
// Записи, чей родитель НАЗВАН, но в выдачу не попал (обычный спутник `denied` и
// `error`), не всплывают молча в корень: они уходят в отдельную группу с явной
// подписью. Иначе запись третьего уровня притворилась бы записью первого.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { KitCtx, KitRecord } from '../../core/contract';
import { ICON_CANON } from '../../elements/iconCanon';
import { IconButton } from '../../elements/IconButton';
import { EmptyState } from '../../states/StateViews';
import { KindCell, kindColumnTitle } from '../../record/KindBlock';
import { kitT, useKitLang, type KitLang } from '../../i18n';
import { buildTree, type TreeNode } from './treeModel';

/** Уровень иерархии: вид его записей и можно ли уровню отсутствовать. */
export interface TreeLevel {
  /** Ключ `config.kinds` — какой вид лежит на этом уровне. */
  kind: string;
  /** Уровня может не быть в данных: тогда следующий встаёт на его место. */
  optional?: boolean;
}

/**
 * Состояние уровня — та же форма, что у `parts[].state` фасада. `ok` и
 * отсутствие ключа равны: сказать нечего.
 */
export type TreeLevelState = 'ok' | 'none' | 'denied' | 'error' | 'truncated';

/** Ряд как его отдаёт источник: ПЛОСКИМ списком, сборка дерева — здесь. */
export interface TreeFlatRow {
  key: string;
  kind: string;
  parent: string | null;
  title?: string;
  status?: string;
  /** Остальное — поля записи; столбец `fields.<ключ>` берёт их отсюда. */
  [field: string]: unknown;
}

/** Строка отрисовки: запись или шапка группы. */
export type TreeTableLine =
  | { type: 'record'; record: KitRecord; level: number; kids: number; collapsed: boolean }
  | { type: 'group'; group: 'outside' | 'orphan'; level: number; kind: string | null; count: number; id: string };

const PARENT_KEY = '__parent';
/** Порядок детей — тот, в котором ряды пришли: своего порядка таблица не выдумывает. */
const ORDER_KEY = '__order';

function toRecord(row: TreeFlatRow): KitRecord {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'key' || k === 'kind' || k === 'parent' || k === 'title' || k === 'status') continue;
    fields[k] = v;
  }
  fields[PARENT_KEY] = row.parent ?? null;
  return {
    id: row.key,
    kind: row.kind,
    title: typeof row.title === 'string' ? row.title : row.key,
    status: typeof row.status === 'string' ? row.status : '',
    fields,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

/** Индекс уровня по виду записи; вида нет в `levels` — `-1`. */
function levelIndexOf(levels: readonly TreeLevel[], kind: string): number {
  return levels.findIndex(l => l.kind === kind);
}

/**
 * Строки отрисовки из ПЛОСКОГО списка.
 *
 * Уровень строки — её место в иерархии (глубина), а НЕ номер её вида в
 * `levels`: именно поэтому пропавший средний уровень не требует особого кода —
 * записи глубже оказываются на его месте сами.
 *
 * Группа «вне уровня» появляется только там, где у ОДНОГО родителя есть и
 * записи промежуточного уровня, и записи уровня глубже: «то, у чего
 * промежуточного уровня нет» и «первый промежуточный уровень» — разные
 * вещи, и слить их значило бы соврать. Промежуточных нет ни у кого — группы
 * нет: подпись без выбора ничего не сообщает.
 */
export function treeTableLines(
  rows: readonly TreeFlatRow[],
  levels: readonly TreeLevel[],
  collapsed: ReadonlySet<string> | null,
): TreeTableLine[] {
  if (levels.length === 0) return [];
  const records = rows.map(toRecord);
  records.forEach((r, i) => { r.fields[ORDER_KEY] = i; });
  const model = buildTree(records, { parent: PARENT_KEY, order: ORDER_KEY });
  const out: TreeTableLine[] = [];
  const isCollapsed = (id: string) => !!collapsed?.has(id);

  /**
   * `parentIndex` — номер уровня РОДИТЕЛЯ в `levels` (−1 у корней). Ожидаемый
   * вид детей берётся от него, а не от первого ребёнка: иначе достаточно было
   * бы, чтобы запись «вне уровня» пришла в списке первой, и уровни поменялись
   * бы местами.
   */
  const walk = (list: readonly TreeNode[], level: number, parentIndex: number) => {
    const expected = parentIndex >= -1 ? levels[parentIndex + 1] : undefined;
    const atLevel = expected ? list.filter(n => n.record.kind === expected.kind) : [];
    const deeper = expected ? list.filter(n => n.record.kind !== expected.kind) : [...list];
    const split = atLevel.length > 0 && deeper.length > 0;

    const emit = (n: TreeNode, lvl: number) => {
      const kids = n.children.length;
      const shut = isCollapsed(n.id);
      out.push({ type: 'record', record: n.record, level: lvl, kids, collapsed: shut });
      // Вид узла не описан в `levels` — чего ждать от его детей, неизвестно, и
      // выдумывать это нельзя: уровень просто не делится на группы.
      const own = levelIndexOf(levels, n.record.kind);
      if (kids && !shut) walk(n.children, lvl + 1, own < 0 ? -2 : own);
    };

    if (!split) {
      for (const n of list) emit(n, level);
      return;
    }
    for (const n of atLevel) emit(n, level);
    const parentId = deeper[0].parentId ?? 'root';
    // Группа ЗАНИМАЕТ место пропущенного уровня, поэтому записи под ней лежат
    // уровнем ниже — там же, где их соседи, у которых этот уровень есть.
    // Иначе одна и та же запись оказывалась бы то на втором уровне, то на
    // третьем, и столбцы разъехались бы по отступу.
    out.push({
      type: 'group',
      group: 'outside',
      level,
      kind: expected?.kind ?? null,
      count: deeper.length,
      id: `outside:${parentId}`,
    });
    for (const n of deeper) emit(n, level + 1);
  };

  // Корни и «сироты» — РАЗНОЕ. Сирота назвала родителя, которого в выдаче нет;
  // показать её рядом с настоящими корнями значило бы выдать её за запись
  // первого уровня.
  const real = model.roots.filter(n => !n.orphan);
  const orphans = model.roots.filter(n => !!n.orphan);
  walk(real, 1, -1);
  if (orphans.length) {
    out.push({ type: 'group', group: 'orphan', level: 1, kind: null, count: orphans.length, id: 'orphan' });
    // Уровень сироты неизвестен (родителя не выдали) — она идёт под своей
    // группой, а не притворяется записью первого уровня.
    walk(orphans, 2, -2);
  }
  return out;
}

export interface TreeTableProps {
  /** Уровни иерархии по порядку; пусто — рисовать нечего, и об этом говорим. */
  levels: readonly TreeLevel[];
  /** Столбцы — ОДНИ на все уровни (в языке столбцов списка: `status`, `id`, `title`, `fields.<ключ>`). */
  columns: readonly string[];
  /** Ряды ПЛОСКИМ списком: `{key, kind, parent, …поля}`. */
  rows: readonly TreeFlatRow[];
  /** Состояние уровня по его виду; нет ключа — сказать нечего. */
  levelState?: Record<string, TreeLevelState>;
  ctx: KitCtx;
  className?: string;
}

/**
 * Слова для состояния уровня. `ok` и `none` молчат — сказать нечего (и это
 * проверено источником).
 *
 * Исключение — `present`: источник сказал «уровня нет», а ряды этого вида в
 * выдаче есть. Это противоречие двух утверждений, и сгладить его нельзя:
 * показать записи молча значит согласиться сразу с обоими.
 */
function levelNote(lang: KitLang, state: TreeLevelState, level: string, present: boolean): string | null {
  switch (state) {
    case 'ok':
      return null;
    case 'none':
      return present ? kitT(lang, 'kit.ttab.level.noneContradicted', { level }) : null;
    case 'denied': return kitT(lang, 'kit.ttab.level.denied', { level });
    case 'error': return kitT(lang, 'kit.ttab.level.error', { level });
    case 'truncated': return kitT(lang, 'kit.ttab.level.truncated', { level });
    default: return kitT(lang, 'kit.ttab.level.unknown', { level, state: String(state) });
  }
}

export function TreeTable({ levels, columns, rows, levelState, ctx, className }: TreeTableProps) {
  const lang = useKitLang();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const lines = useMemo(() => treeTableLines(rows, levels, collapsed), [rows, levels, collapsed]);
  const kindTitle = (kind: string | null) => (kind ? ctx.config.kinds[kind]?.title ?? kind : '');

  const present = useMemo(() => new Set(rows.map(r => r.kind)), [rows]);
  const notes = levels
    .map(l => {
      const state = levelState?.[l.kind] ?? 'ok';
      return {
        kind: l.kind,
        note: levelNote(lang, state, kindTitle(l.kind), present.has(l.kind)),
        // Противоречие — своё состояние на экране: «нет» и «вот они» это не «нет».
        state: state === 'none' && present.has(l.kind) ? 'none-contradicted' : state,
      };
    })
    .filter((n): n is { kind: string; note: string; state: string } => !!n.note);

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (levels.length === 0) {
    return (
      <div className={['sk-ttab', className].filter(Boolean).join(' ')} data-state="no-levels">
        <div className="sk-state sk-state--error" role="alert">
          <p className="sk-state__title">{kitT(lang, 'kit.ttab.noLevels')}</p>
          <p className="sk-state__hint">{kitT(lang, 'kit.ttab.noLevelsHint')}</p>
        </div>
      </div>
    );
  }

  const span = Math.max(1, columns.length);

  // Таблица остаётся таблицей, а не `role="treegrid"`: treegrid обещает ходьбу
  // стрелками по ячейкам, которой здесь пока нет, а роль без поведения — то же
  // пустое обещание, что кнопка, отказывающая при нажатии. Уровень и свёртку
  // чтец берёт с самих строк (`aria-level`, `aria-expanded`) — в role="row" они
  // разрешены. Роуминг-фокус по строкам есть в TreeView (K-09): перенести его
  // сюда и тогда же сменить роль.
  return (
    <div className={['sk-ttab', className].filter(Boolean).join(' ')} data-levels={levels.length}>
      {notes.map(n => (
        <p key={n.kind} className="sk-ttab__note" data-state={n.state} data-level-kind={n.kind} role="status">{n.note}</p>
      ))}
      {rows.length === 0 ? (
        <EmptyState compact title={kitT(lang, 'kit.ttab.empty')} hint={kitT(lang, 'kit.ttab.emptyHint')} />
      ) : (
        <table className="sk-list__table sk-ttab__table" aria-label={kitT(lang, 'kit.ttab.label')}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c} scope="col" className="sk-list__th">{kindColumnTitle(ctx, lang, c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              if (line.type === 'group') {
                const title = line.group === 'orphan'
                  ? kitT(lang, 'kit.ttab.orphan')
                  : kitT(lang, 'kit.ttab.outside', { level: kindTitle(line.kind) });
                return (
                  <tr
                    key={line.id}
                    className="sk-list__ghead sk-ttab__group"
                    data-line="group"
                    data-group={line.group}
                    aria-level={line.level}
                  >
                    <th scope="colgroup" colSpan={span}>
                      <span className="sk-ttab__nest" style={{ '--tree-depth': line.level - 1 } as CSSProperties}>
                        <span className="sk-list__gtitle">{title}</span>
                        <span className="sk-list__gcount">{line.count}</span>
                      </span>
                    </th>
                  </tr>
                );
              }
              const r = line.record;
              return (
                <tr
                  key={r.id}
                  className="sk-list__row sk-ttab__row"
                  data-line="record"
                  data-id={r.id}
                  data-kind={r.kind}
                  aria-level={line.level}
                  aria-expanded={line.kids > 0 ? !line.collapsed : undefined}
                >
                  {columns.map((c, i) => (
                    <td key={c} className="sk-list__td">
                      {i === 0 ? (
                        <span className="sk-ttab__nest" style={{ '--tree-depth': line.level - 1 } as CSSProperties}>
                          {line.kids > 0 ? (
                            <IconButton
                              icon={ICON_CANON.ctlTreeToggle}
                              iconSize={12}
                              className={['sk-ttab__toggle', line.collapsed ? '' : 'is-open'].filter(Boolean).join(' ')}
                              label={kitT(lang, line.collapsed ? 'kit.tree.expand' : 'kit.tree.collapse', { title: r.title })}
                              onClick={() => toggle(r.id)}
                            />
                          ) : (
                            <span className="sk-ttab__spacer" aria-hidden="true" />
                          )}
                          <KindCell col={c} record={r} ctx={ctx} lang={lang} />
                        </span>
                      ) : (
                        <KindCell col={c} record={r} ctx={ctx} lang={lang} />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
