// Таблица связей записи (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-37).
//
// Замечание владелицы по v2 на проде (v1.17.4): «связи пока там, где я хотела
// бы видеть таблицы… наши любимые общие колонки». До этого вкладки связей
// рисовали список названий: ни статуса, ни вида, ни кода — то есть о связанной
// записи было известно меньше, чем о той же записи в списке.
//
// «Общие колонки» здесь значит буквально те же: подписи берутся из ключей
// kit.list.col.* («Статус», «Вид», «Код», «Запись»), разметка — классы списка
// (.sk-list__table / __th / __td), своих правил стиля таблица не заводит. Код и
// запись — разными колонками (решение владелицы 08.11).
//
// Классы — только те, у которых есть правила в seidr.css (S4-00e,
// single-layer): .sk-list__table / __th / __td / __row. Колонок у таблицы
// связей пока фиксированный набор, поэтому классы-хуки на каждую колонку
// (.sk-list__c-*) не ставим: правил у них нет, и это были бы украшения без
// смысла.
//
// Чего таблица НЕ делает: не додумывает. Запись, которой нет в выгрузке, не
// пропадает и не получает выдуманный статус — виден код, честная пометка, а
// статус и вид остаются пустыми.
import type { KitCtx } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { kitT, type KitLang } from '../i18n';
import { StatusPill, findRecord } from './fmt';

export interface RelationTableProps {
  ctx: KitCtx;
  lang: KitLang;
  /** Кого связывает ребро. Пустой список сюда не передают: о пустоте говорит вызывающий. */
  ids: readonly string[];
  /** Отвязать; нет — колонки действий нет (композицию отвязать нельзя). */
  onUnlink?: (target: string) => void;
  /** Метка для теста единственной связи на вкладке. */
  testId?: string;
}

export function RelationTable({ ctx, lang, ids, onUnlink, testId }: RelationTableProps) {
  const t = (k: Parameters<typeof kitT>[1], vars?: Record<string, string | number>) => kitT(lang, k, vars);
  return (
    <table className="sk-list__table sk-rel__table" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col" className="sk-list__th">{t('kit.list.col.status')}</th>
          <th scope="col" className="sk-list__th">{t('kit.list.col.kind')}</th>
          <th scope="col" className="sk-list__th">{t('kit.list.col.id')}</th>
          <th scope="col" className="sk-list__th">{t('kit.list.col.title')}</th>
          {onUnlink && (
            <th scope="col" className="sk-list__th">
              <span className="sk-sr">{t('kit.record.rel.linkBtn')}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {ids.map(id => {
          const r = findRecord(ctx, id);
          const kind = r ? ctx.config.kinds[r.kind] : undefined;
          return (
            <tr key={id} className="sk-list__row" data-record-id={id} data-missing={r ? undefined : 'true'}>
              <td className="sk-list__td">
                {r ? <StatusPill code={r.status} ctx={ctx} unknownTitle={t('kit.record.status.unknown')} /> : null}
              </td>
              <td className="sk-list__td">
                {kind
                  ? <GameIcon slug={kind.icon} size={14} label={kind.title} />
                  : r ? <span className="sk-rel__raw">{r.kind}</span> : null}
              </td>
              <td className="sk-list__td"><span className="sk-pill sk-pill--id">{id}</span></td>
              <td className="sk-list__td">
                {r
                  ? <a className="sk-rec-ref" href={ctx.href(id)}><span className="sk-rec-ref__name">{r.title || id}</span></a>
                  // Записи нет в выгрузке — честная пометка, а не пустая ячейка
                  // и не выдуманное название.
                  : <span className="sk-shell__tag" data-missing="true">{t('kit.shell.recentMissing')}</span>}
              </td>
              {onUnlink && (
                <td className="sk-list__td">
                  <button type="button" className="sk-rel__unlink" onClick={() => onUnlink(id)}
                    aria-label={t('kit.record.rel.unlink', { title: r?.title ?? id })}>×</button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
