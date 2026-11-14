// PU-23 — правило раскрытия строки списка в одном месте (владелица 14.11.2026, SPRINT_UXR_POLISH_UAT_1113/PU-23):
// «список при наличии дочернего элемента встроит его дочернюю таблицу — так же, как список со
// своими полями, маппингами и отображениями, — если объекты разные. И унифицированно, если это
// иерархия (ссылка сама на себя однотипных объектов)».
//
//   • дети ДРУГОГО типа (спринт → задачи, веха → спринты) — вложенная таблица дочернего типа: конфиг
//     его экрана из LIST_SCREENS (колонки, подписи, статусы), ссылка на паспорт, смена статуса;
//   • дети ТОГО ЖЕ типа (компонент → подкомпоненты) — строки той же таблицы, в тех же колонках
//     (kit expand.rows).
//
// Тип ребёнка — из объявления `nested.children.kind`, иначе из `kind` загруженных записей.
import type { ReactNode } from 'react';
import { ListNestedTable, StatusChip } from '@seidr/kit';
import type { KitConfig, KitLang, KitRecord, ListExpand, ListExpandRows } from '@seidr/kit';
import { appT } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import type { LoreClient } from '../sprints/loreClient';
import { LIST_SCREENS, type ListNested, type ListScreenId } from './screens';

export type ChildMode = 'table' | 'rows';

/** Правило: тип ребёнка ≠ тип родителя — вложенная таблица; тот же — строки той же таблицы. */
export function childMode(parentType: string, childKind: string): ChildMode {
  return childKind === parentType ? 'rows' : 'table';
}

/** Экран списка типа — тот, чей modelType равен типу. */
export function childScreenOf(kind: string | undefined): ListScreenId | undefined {
  if (!kind) return undefined;
  return (Object.keys(LIST_SCREENS) as ListScreenId[]).find(id => (LIST_SCREENS[id] as { modelType?: string }).modelType === kind);
}

/** Типы, у которых клиент умеет сменить статус из списка (loreClient.setStatus). */
const STATUS_KINDS = new Set(['task', 'sprint']);

function NestedChildren({ parent, kind, rows, config, client, lang }: {
  parent: KitRecord; kind: string; rows: ListExpandRows; config: KitConfig; client: LoreClient; lang: KitLang;
}) {
  const href = recordHref(kind, '_') ? (id: string) => recordHref(kind, id) ?? '' : undefined;
  const cellOf = STATUS_KINDS.has(kind)
    ? (col: string, r: KitRecord): ReactNode | undefined => (col === 'status'
      ? <StatusChip record={r} config={config} compact save={c => client.setStatus(kind as 'task' | 'sprint', c.id, String(c.to))} />
      : undefined)
    : undefined;
  const label = appT(lang, 'lists.nested.label', { kind: config.kinds[kind]?.title ?? kind, title: parent.title });
  return <ListNestedTable config={config} rows={rows} label={label} href={href} cellOf={cellOf} />;
}

export interface BuildExpandArgs {
  nested: ListNested;
  client: LoreClient;
  /** Дети раскрытой строки (useChildRows); undefined — у экрана детей нет. */
  childRows: (r: KitRecord) => ListExpandRows | undefined;
  /** Конфиг экрана дочернего типа (со статусами модели, если загружены). */
  childConfigOf: (kind: string) => KitConfig | undefined;
  lang: KitLang;
}

/** Раскрытие строки экрана по правилу PU-23. */
export function buildExpand({ nested, client, childRows, childConfigOf, lang }: BuildExpandArgs): ListExpand {
  const children = nested.children;
  // Как рисовать детей этой строки: таблица своего типа, строки той же таблицы или (детей не
  // объявлено) прежнее содержимое nested.render.
  const plan = (r: KitRecord): { mode: ChildMode; kind?: string; rows?: ListExpandRows; config?: KitConfig } | null => {
    if (!children) return null;
    const rows = childRows(r);
    const kind = children.kind ?? rows?.records[0]?.kind;
    if (!kind) return { mode: 'rows', rows };
    const mode = childMode(r.kind, kind);
    const config = mode === 'table' ? childConfigOf(kind) : undefined;
    // Экрана дочернего типа нет — показать нечем, кроме строк той же таблицы (с «н/п» в чужих колонках).
    return mode === 'table' && !config ? { mode: 'rows', kind, rows } : { mode, kind, rows, config };
  };
  return {
    render: r => {
      const p = plan(r);
      if (p?.mode === 'table' && p.kind && p.config) {
        return <NestedChildren parent={r} kind={p.kind} rows={p.rows ?? { state: 'loading', records: [] }} config={p.config} client={client} lang={lang} />;
      }
      return nested.render(r.id, client);
    },
    ...(children ? {
      rows: (r: KitRecord) => {
        const p = plan(r);
        return p?.mode === 'rows' ? p.rows : undefined;
      },
      ...(children.cell ? { childCell: (col: string, child: KitRecord) => children.cell!(col, child, client) } : {}),
    } : {}),
  };
}
