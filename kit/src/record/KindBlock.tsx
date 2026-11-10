// Вложенный блок ВИДА (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED).
//
// Контракт владелицы: «зависимый объект показывается вложенным блоком СВОЕГО
// вида: тот же рендер, что у его паспорта или строки. Заново у родителя его не
// рисуют».
//
// Отсюда главное требование к этому файлу: он НЕ ЗАВОДИТ третий рендер. Он
// собирает запись из того, что в kit уже есть:
//   • `as="full"` — тело паспорта реэкспортом из RecordView (`RecordBodyOverview`,
//     `RecordBodyFields`): те же разделы данными, те же свойства, та же
//     разметка `.sk-rec-sections` / `.sk-rec-fields`;
//   • `as="row"` / `as="card"` — классы строки списка (`.sk-list__table/__row/__td`)
//     и карточки (`.sk-cards__*`). Вид приходит из единого CSS-слоя (S4-00e),
//     поэтому «тот же рендер» здесь — не похожий, а буквально тот же слой.
//
// Чего тут нет и почему: своя отрисовка строки списка внутри `ListView`
// замкнута на его состояние (выделение, курсор, раскрытие), и вытащить её
// можно только правкой `ListView.tsx`. Пока она не вынесена, ячейки строки и
// карточки собираются ЗДЕСЬ из тех же первокирпичиков, что у списка:
// `StatusSlot`, `Pill`, `RecordRef`, `fieldValue` + подписи `groupKeyTitle`.
// Это одна функция ячейки на вложенный блок и на дерево (TreeTable зовёт
// `KindCell`), то есть ячейка одна, а не по одной на каждое место.
//
// Вида НЕТ в конфиге — честный отказ словами. Пустой блок читается как «данных
// нет», а это другое утверждение: данные есть, показать их нечем, и виноват
// конфиг приложения, а не выдача.
import type { ReactNode } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { Pill } from '../elements/Pill';
import { kitDay } from '../core/fmtValue';
import { fieldValue } from '../list/listModel';
import { fieldValueTitle, groupKeyTitle } from '../list/groupLabel';
import { kitT, useKitLang, type KitLang } from '../i18n';
import { StatusSlot } from './StatusSlot';
import { valueText } from './fmt';
import { RecordBodyFields, RecordBodyOverview } from './RecordView';

/** Как показан вложенный блок: строкой раздела, карточкой или телом паспорта. */
export type KindBlockAs = 'row' | 'card' | 'full';

export interface KindBlockProps {
  record: KitRecord;
  ctx: KitCtx;
  as: KindBlockAs;
  className?: string;
}

/** Подпись столбца — та же, что у списка (S4-06): один словарь на все места. */
export function kindColumnTitle(ctx: KitCtx, lang: KitLang, col: string): string {
  return groupKeyTitle(ctx.config, lang, col);
}

/**
 * Ячейка вида: один столбец одной записи.
 *
 * Статус — через `StatusSlot`, то есть плашка или кнопка по правам, ровно как в
 * паспорте (S4-STATUS-AXIS-CONFIG). Остальное — чтение: вложенный блок не
 * заводит своих путей записи.
 */
export function KindCell({ col, record, ctx, lang }: { col: string; record: KitRecord; ctx: KitCtx; lang: KitLang }): ReactNode {
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  if (col === 'status') return <StatusSlot record={record} ctx={ctx} unknownTitle={t('kit.record.status.unknown')} compact />;
  if (col === 'id') return <Pill variant="id">{record.id}</Pill>;
  // Название — ссылкой класса списка (`.sk-list__title`), как в строке раздела;
  // `title+id` добавляет к ней пилюлю кода — тем же составом, что у списка.
  if (col === 'title' || col === 'title+id') {
    const link = <a className="sk-list__title" href={ctx.href(record.id)}>{record.title || record.id}</a>;
    return col === 'title+id' ? <>{link} <Pill variant="id">{record.id}</Pill></> : link;
  }
  if (col === 'kind') return <span>{fieldValueTitle(ctx.config, lang, 'kind', record.kind)}</span>;
  if (col === 'updated_at') {
    const d = kitDay(record.updated_at);
    // Дата, которую не разобрали, показывается как пришла: выдуманная дата хуже сырой.
    return <span className="sk-list__mono">{d?.ok ? d.text : (record.updated_at ?? '—')}</span>;
  }
  const v = fieldValue(record, col);
  if (v === null || v === undefined || v === '') return <span className="sk-rec-fields__none">—</span>;
  if (Array.isArray(v)) return <span>{v.map(x => valueText(x)).join(', ')}</span>;
  return <span>{valueText(v)}</span>;
}

/**
 * Столбцы строки вида: набор раздела (`config.list.columns`), если приложение
 * его назвало, иначе статус · код · запись и поля вида.
 *
 * «Тот же рендер, что в разделе» — это и тот же НАБОР столбцов: свой набор у
 * вложенного блока означал бы, что о записи внутри родителя известно другое,
 * чем о ней же в её разделе.
 */
export function kindColumns(ctx: KitCtx, kind: string): string[] {
  const named = ctx.config.list?.columns;
  if (named && named.length) return [...named];
  const fields = (ctx.config.kinds[kind]?.fields ?? []).map(f => `fields.${f.key}`);
  return ['status', 'id', 'title', ...fields];
}

/** Вида нет в конфиге: что показать — не знает никто, и об этом надо сказать. */
function KindUnknown({ kind, lang }: { kind: string; lang: KitLang }) {
  return (
    <div className="sk-state sk-state--error sk-kindblock" data-state="kind-unknown" role="alert">
      <p className="sk-state__title">{kitT(lang, 'kit.kind.unknown', { kind })}</p>
      <p className="sk-state__hint">{kitT(lang, 'kit.kind.unknownHint')}</p>
    </div>
  );
}

export function KindBlock({ record, ctx, as, className }: KindBlockProps) {
  const lang = useKitLang();
  const kind = ctx.config.kinds[record.kind];
  if (!kind) return <KindUnknown kind={record.kind} lang={lang} />;

  if (as === 'full') {
    // Тело паспорта без шапки и вкладок — его же рендером (реэкспорт из
    // RecordView). Правки здесь нет намеренно: вложенный блок — чтение,
    // править запись идут в её паспорт.
    return (
      <div className={['sk-rec-overview', 'sk-kindblock', className].filter(Boolean).join(' ')} data-as="full" data-kind={record.kind}>
        <RecordBodyOverview record={record} kind={kind} ctx={ctx} lang={lang} />
        <RecordBodyFields record={record} kind={kind} ctx={ctx} lang={lang} />
      </div>
    );
  }

  if (as === 'card') {
    const fields = kind.fields ?? [];
    return (
      <ul className={['sk-cards', 'sk-kindblock', className].filter(Boolean).join(' ')} data-as="card" data-kind={record.kind}>
        <li className="sk-cards__card" data-record-id={record.id}>
          <div className="sk-cards__head">
            <KindCell col="status" record={record} ctx={ctx} lang={lang} />
            <Pill variant="id">{record.id}</Pill>
          </div>
          <div className="sk-cards__title"><KindCell col="title" record={record} ctx={ctx} lang={lang} /></div>
          {fields.length > 0 && (
            <dl className="sk-cards__fields">
              {fields.map(f => (
                <div key={f.key}>
                  <dt>{f.title}</dt>
                  <dd><KindCell col={`fields.${f.key}`} record={record} ctx={ctx} lang={lang} /></dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      </ul>
    );
  }

  const cols = kindColumns(ctx, record.kind);
  return (
    <table className={['sk-list__table', 'sk-kindblock', className].filter(Boolean).join(' ')} data-as="row" data-kind={record.kind}>
      <thead>
        <tr>
          {cols.map(c => <th key={c} scope="col" className="sk-list__th">{kindColumnTitle(ctx, lang, c)}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr className="sk-list__row" data-record-id={record.id}>
          {cols.map(c => <td key={c} className="sk-list__td"><KindCell col={c} record={record} ctx={ctx} lang={lang} /></td>)}
        </tr>
      </tbody>
    </table>
  );
}
