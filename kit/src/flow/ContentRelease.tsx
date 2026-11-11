// Экран «Выпуск контента» (SPRINT_UXR_S10_SEIDR_KIT/K-12).
//
// Поток, под который он заведён: собрали версию N → активировали N → при беде
// откат на N-1. В LORE такого экрана нет: «Релизы» показывают теги, PR и
// спринты, но не дифф содержимого и не активацию.
//
// Четыре решения, которые стоит прочитать прежде, чем менять:
//
//  1. **Класс выпуска считает СЕРВЕР.** `class` приходит в данных, kit его
//     только рисует. Посчитать класс здесь значило бы решать за сервер по
//     выдаче, которая бывает обрезанной: «только правки существующих ключей»
//     на обрезанном списке выглядит иначе, чем на полном. Класса нет —
//     говорим «не прислали», а не выводим сами.
//  2. **Активация и откат — через подтверждение.** Это действия на проде, и
//     одно нажатие не должно их выполнять. Подтверждение называет версию.
//  3. **Два разных «ничего»:** «активаций ещё не было» (журнал прислали, он
//     пуст) и «журнал не прислали». Слить их в одну фразу значило бы соврать
//     про историю прода.
//  4. **Два разных «не всё видно»:** наш бюджет строк («ещё N», раскрывается)
//     и обрезка на сервере («показано N из M», раскрыть нельзя). Первое —
//     наша экономия места, второе — неполнота данных.
//
// Границу K-14 элемент держит: что за контент — знает приложение.
import { useState } from 'react';
import { kitT, type KitLang } from '../i18n';
import { wordDiff } from './wordDiff';

export interface ContentFieldChange { from: string; to: string }
export interface ContentItem { id: string; title?: string }
export interface ContentChangedItem extends ContentItem {
  /** Поле → «было/стало». Пусто — подробностей не прислали. */
  fields: Record<string, ContentFieldChange>;
}

export interface ContentDiff {
  /** Версия, которая стоит сейчас; `null` — её нет (первый выпуск). */
  from: string | number | null;
  /** Версия, которую выпускают. */
  to: string | number;
  /** Класс выпуска — ОТ СЕРВЕРА. `null`/нет — не прислали. */
  class?: 'hotfix' | 'release' | null;
  added: readonly ContentItem[];
  changed: readonly ContentChangedItem[];
  removed: readonly ContentItem[];
  /** Полнота выдачи сервера. */
  shown?: number;
  total?: number;
  truncated?: boolean;
}

export interface ActivationEntry {
  version: string | number;
  who: string;
  when: string;
  action: 'activate' | 'rollback';
}

export interface ContentReleaseProps {
  diff: ContentDiff;
  /** Журнал активаций; НЕ передан — «не прислали», пустой массив — «не было». */
  log?: readonly ActivationEntry[];
  onActivate?: (version: string | number) => void;
  onRollback?: (version: string | number) => void;
  busy?: boolean;
  /** Сколько строк группы показывать сразу. По умолчанию 10. */
  rowBudget?: number;
  lang?: KitLang;
}

type Group = 'added' | 'changed' | 'removed';
type Ask = { kind: 'activate' | 'rollback'; version: string | number } | null;

export function ContentRelease({ diff, log, onActivate, onRollback, busy, rowBudget = 10, lang = 'ru' }: ContentReleaseProps) {
  const [open, setOpen] = useState<Record<Group, boolean>>({ added: false, changed: false, removed: false });
  const [ask, setAsk] = useState<Ask>(null);

  const cls = diff.class ?? 'unknown';
  // Какая версия живая — по журналу (новые записи первыми). Журнала нет — не знаем,
  // и откат остаётся как был. Живая не N — откат вёл бы на ту, что уже стоит
  // (проверка 11.11.2026): кнопки нет, а сказано, когда она появится.
  const live = log === undefined ? undefined : (log[0]?.version ?? null);
  const rollbackPending = live !== undefined && String(live) !== String(diff.to);
  const empty = !diff.added.length && !diff.changed.length && !diff.removed.length;

  function head(g: Group, n: number) {
    return (
      <h3 className="sk-rel__ghead" data-testid={`kit-rel-${g}`}>
        {kitT(lang, `kit.rel.group.${g}` as 'kit.rel.group.added')} <span className="sk-rel__count">{n}</span>
      </h3>
    );
  }

  function list<T extends ContentItem>(g: Group, items: readonly T[], row: (it: T) => React.ReactNode) {
    const shownAll = open[g] || items.length <= rowBudget;
    const visible = shownAll ? items : items.slice(0, rowBudget);
    const rest = items.length - visible.length;
    return (
      <>
        <ul className="sk-rel__list">
          {visible.map(it => (
            <li key={it.id} className="sk-rel__item" data-testid={`kit-rel-item-${it.id}`}>
              {row(it)}
            </li>
          ))}
        </ul>
        {rest > 0 && (
          <button
            type="button"
            className="sk-rel__more"
            data-testid={`kit-rel-more-${g}`}
            onClick={() => setOpen(o => ({ ...o, [g]: true }))}
          >
            {kitT(lang, 'kit.rel.more', { n: rest })}
          </button>
        )}
      </>
    );
  }

  const name = (it: ContentItem) => (
    <>
      <span className="sk-rel__id">{it.id}</span>
      {it.title && <span className="sk-rel__title">{it.title}</span>}
    </>
  );

  return (
    <section className="sk-rel" aria-label={kitT(lang, 'kit.rel.label')}>
      <header className="sk-rel__top">
        <p className="sk-rel__versions" data-testid="kit-rel-versions">
          {diff.from === null
            ? kitT(lang, 'kit.rel.first', { to: String(diff.to) })
            : kitT(lang, 'kit.rel.versions', { from: String(diff.from), to: String(diff.to) })}
        </p>
        <span className="sk-rel__class" data-class={cls} data-testid="kit-rel-class">
          {kitT(lang, `kit.rel.class.${cls}` as 'kit.rel.class.hotfix')}
        </span>
      </header>

      {diff.truncated && (
        <p className="sk-rel__trunc" data-testid="kit-rel-truncated">
          {kitT(lang, 'kit.rel.truncated', { shown: String(diff.shown ?? '?'), total: String(diff.total ?? '?') })}
        </p>
      )}

      {empty
        ? <p className="sk-rel__none" data-testid="kit-rel-nochanges">{kitT(lang, 'kit.rel.noChanges')}</p>
        : (
          <>
            <div className="sk-rel__group" data-group="added">
              {head('added', diff.added.length)}
              {diff.added.length === 0
                ? <p className="sk-rel__gempty" data-testid="kit-rel-added-empty">{kitT(lang, 'kit.rel.empty.added')}</p>
                : list('added', diff.added, name)}
            </div>

            <div className="sk-rel__group" data-group="changed">
              {head('changed', diff.changed.length)}
              {diff.changed.length === 0
                ? <p className="sk-rel__gempty" data-testid="kit-rel-changed-empty">{kitT(lang, 'kit.rel.empty.changed')}</p>
                : list('changed', diff.changed, it => {
                  const keys = Object.keys(it.fields);
                  return (
                    <>
                      {name(it)}
                      {keys.length === 0
                        ? <span className="sk-rel__nofields" data-testid={`kit-rel-nofields-${it.id}`}>{kitT(lang, 'kit.rel.noFields')}</span>
                        : (
                          <ul className="sk-rel__fields">
                            {keys.map(f => {
                              const ch = it.fields[f];
                              const d = wordDiff(ch.from, ch.to);
                              return (
                                <li key={f} className="sk-rel__field" data-testid={`kit-rel-field-${it.id}-${f}`}>
                                  <span className="sk-rel__fname">{f}</span>
                                  <span className="sk-rel__wdiff">
                                    {d.chunks.map((c, i) => (
                                      <span key={i} className="sk-rel__chunk" data-chunk={c.kind}>{c.text}</span>
                                    ))}
                                  </span>
                                  {!d.exact && (
                                    <span className="sk-rel__rough" data-testid={`kit-rel-rough-${it.id}-${f}`}>
                                      {kitT(lang, 'kit.rel.rough')}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                    </>
                  );
                })}
            </div>

            <div className="sk-rel__group" data-group="removed">
              {head('removed', diff.removed.length)}
              {diff.removed.length === 0
                ? <p className="sk-rel__gempty" data-testid="kit-rel-removed-empty">{kitT(lang, 'kit.rel.empty.removed')}</p>
                : list('removed', diff.removed, name)}
            </div>
          </>
        )}

      <div className="sk-rel__acts">
        {onActivate && (
          <button
            type="button"
            className="sk-rel__act is-primary"
            data-testid="kit-rel-activate"
            aria-disabled={busy ? true : undefined}
            onClick={() => { if (!busy) setAsk({ kind: 'activate', version: diff.to }); }}
          >
            {kitT(lang, 'kit.rel.activate', { to: String(diff.to) })}
          </button>
        )}
        {onRollback && (diff.from === null
          ? <span className="sk-rel__norollback" data-testid="kit-rel-norollback">{kitT(lang, 'kit.rel.noRollback')}</span>
          : rollbackPending
          ? <span className="sk-rel__norollback" data-testid="kit-rel-norollback">{kitT(lang, 'kit.rel.rollbackAfter', { to: String(diff.to) })}</span>
          : (
            <button
              type="button"
              className="sk-rel__act"
              data-testid="kit-rel-rollback"
              aria-disabled={busy ? true : undefined}
              onClick={() => { if (!busy) setAsk({ kind: 'rollback', version: diff.from! }); }}
            >
              {kitT(lang, 'kit.rel.rollback', { from: String(diff.from) })}
            </button>
          ))}
      </div>

      {ask && (
        <div className="sk-rel__confirm" role="group" data-testid="kit-rel-confirm" aria-label={kitT(lang, 'kit.rel.confirmLabel')}>
          <p className="sk-rel__q">
            {kitT(lang, ask.kind === 'activate' ? 'kit.rel.confirm.activate' : 'kit.rel.confirm.rollback', { v: String(ask.version) })}
          </p>
          <button
            type="button"
            className="sk-rel__act is-primary"
            data-testid="kit-rel-confirm-yes"
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              // Выпуск уже идёт (busy пришёл после открытия подтверждения) — второй раз не жмём.
              if (busy) return;
              const a = ask;
              setAsk(null);
              if (a.kind === 'activate') onActivate?.(a.version);
              else onRollback?.(a.version);
            }}
          >
            {kitT(lang, 'kit.rel.confirm.yes')}
          </button>
          <button type="button" className="sk-rel__act" data-testid="kit-rel-confirm-no" onClick={() => setAsk(null)}>
            {kitT(lang, 'kit.rel.confirm.no')}
          </button>
        </div>
      )}

      <div className="sk-rel__log">
        <h3 className="sk-rel__ghead">{kitT(lang, 'kit.rel.log')}</h3>
        {log === undefined
          ? <p className="sk-rel__gempty" data-testid="kit-rel-log-unknown">{kitT(lang, 'kit.rel.logUnknown')}</p>
          : log.length === 0
            ? <p className="sk-rel__gempty" data-testid="kit-rel-log-empty">{kitT(lang, 'kit.rel.logEmpty')}</p>
            : (
              <ul className="sk-rel__list">
                {log.map((e, i) => (
                  <li
                    key={`${e.version}-${e.when}-${i}`}
                    className="sk-rel__logrow"
                    data-action={e.action}
                    data-testid={`kit-rel-log-${i}`}
                  >
                    <span className="sk-rel__logact">{kitT(lang, e.action === 'activate' ? 'kit.rel.act.activate' : 'kit.rel.act.rollback')}</span>
                    <span className="sk-rel__id">{String(e.version)}</span>
                    <span className="sk-rel__who">{e.who}</span>
                    <span className="sk-rel__when">{e.when}</span>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </section>
  );
}
