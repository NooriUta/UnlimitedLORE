// Матрица «ось × ось» с правкой в ячейке (SPRINT_UXR_S10_SEIDR_KIT_2/K2-MATRIX).
//
// **Главное требование и причина, по которой элемент самый дорогой из пяти:
// состояние у КАЖДОЙ ячейки.** Матрица строится по внешним системам, где
// пустая ячейка значит «значения нет» гораздо реже, чем «не смогли спросить»
// или «нет прав посмотреть». Матрица, которая рисует эти три случая одинаково
// пустым квадратом, вреднее отсутствия матрицы: по ней раздают доступы, глядя
// на дырки. Поэтому у ячейки четыре исхода, и каждый назван:
// значение · значения нет · не смогли проверить (причина) · нет прав (причина).
//
// **Матрица ничего не применяет.** Она ПРЕДЛАГАЕТ изменения: в предложении
// вместе с новым значением идёт прежнее состояние ячейки (`from`), и по нему
// дифф (K2-DIFF) решает, что это — «добавится», «снимется», «уже есть» или
// «применять нельзя, пока не проверено». Применяет пачка с окном отмены
// (K2-BATCH-UNDO). Так один и тот же путь получается у правки одной ячейки и у
// «задать всей строке».
//
// **Выделение по строке и колонке не трогает непроверенные ячейки** и говорит,
// сколько пропустило. Предложить изменение там, где мы не знаем текущего
// состояния, значило бы раздать доступы наугад.
//
// **Выбор НЕСКОЛЬКИХ ячеек — то же правило на произвольном наборе.** Набор,
// который не совпадает ни со строкой, ни с колонкой («этим трём — так, а
// четвёртой — нет»), набирается мышью (Ctrl-клик) и без мыши (режим выбора
// кнопкой, клавиатура доходит до ячеек табом). Отметить можно ЛЮБУЮ ячейку —
// набор берут одним движением; но из предложения непроверенные, запретные и
// неспрошенные выпадают и названы числом, ровно как у строки и колонки.
//
// **Узкий экран — другой вид, а не сжатая сетка.** Матрица на телефоне
// превращается в список по выбранной строке: так же, как списки уходят в
// карточки (ADR-LORE-049).
//
// Границу K-14 элемент держит: что за оси и что за значения — знает приложение.
import { useEffect, useRef, useState } from 'react';
import { kitT, type KitLang } from '../i18n';
import { useNarrow } from '../core/narrow';
import { sayUnknown } from './unknownOutcome';

export interface MatrixAxis { key: string; title: string }

/** Что в ячейке. Причина обязательна там, где без неё пусто и непонятно. */
export type MatrixCellState =
  | { state: 'value'; value: string }
  | { state: 'none' }
  | { state: 'unverified'; reason?: string }
  | { state: 'forbidden'; reason?: string }
  /**
   * Источник НЕ СПРАШИВАЛИ — это наш выбор, а не отказ источника.
   *
   * Отдельно от «не смогли проверить» потому, что человек делает по ним разное:
   * увидев сбой, идут чинить связь с источником; увидев «не спрашивали» —
   * понимают, что чинить нечего, а надо включить источник. Приложение знает,
   * кого спрашивали, и говорит это ЗНАЧЕНИЕМ; гадать по перечню источников kit
   * не станет — перечень предметный (K-14).
   */
  | { state: 'unasked'; reason?: string };

/** Значение из палитры: код и подпись (подписи знает приложение). */
export interface MatrixOption { value: string; title: string }

/** Предложение изменения: новое значение (`null` — снять) и ПРЕЖНЕЕ состояние. */
export interface MatrixChange {
  row: string;
  col: string;
  value: string | null;
  from: MatrixCellState;
}

export interface MatrixProps {
  rows: readonly MatrixAxis[];
  cols: readonly MatrixAxis[];
  /** Состояние ячейки — спрашиваем у приложения, своего хранилища у матрицы нет. */
  cell: (rowKey: string, colKey: string) => MatrixCellState;
  options: readonly MatrixOption[];
  /** Имена осей — от приложения. */
  labels: { rows: string; cols: string };
  /**
   * Предложить изменения. Нет обработчика — правка не предлагается вовсе:
   * матрица только на чтение, и кнопок, которые ничего не делают, не будет.
   */
  onPropose?: (changes: readonly MatrixChange[]) => void;
  /** Узкий вид принудительно (тесты); по умолчанию — по ширине экрана. */
  narrow?: boolean;
  lang?: KitLang;
}

/** Проверена ли ячейка: только по проверенным можно предлагать изменения. */
function known(c: MatrixCellState): boolean {
  return c.state === 'value' || c.state === 'none';
}

type Target =
  | { kind: 'cell'; row: string; col: string }
  | { kind: 'row'; row: string }
  | { kind: 'col'; col: string }
  /** Набор отмеченных ячеек: он не совпадает ни со строкой, ни с колонкой. */
  | { kind: 'marks' };

/** Ключ ячейки в наборе отмеченных. */
const markKey = (row: string, col: string) => `${row}\u0000${col}`;

export function Matrix({ rows, cols, cell, options, labels, onPropose, narrow: narrowProp, lang = 'ru' }: MatrixProps) {
  const narrow = useNarrow(narrowProp);
  const [target, setTarget] = useState<Target | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<number | null>(null);
  // Выбор нескольких ячеек. Отметки лежат набором ключей и НЕ уходят наружу:
  // отметка — это наш выбор на экране, а не состояние ячейки, и своего
  // хранилища состояний у матрицы по-прежнему нет (K-14).
  const [picking, setPicking] = useState(false);
  const [marks, setMarks] = useState<ReadonlySet<string>>(() => new Set<string>());
  const box = useRef<HTMLDivElement | null>(null);

  // Esc закрывает меню: всплывающее окно, которое нельзя закрыть клавишей, —
  // ловушка для того, кто работает без мыши.
  useEffect(() => {
    if (!target && !picking && marks.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Меню главнее выбора: один Esc закрывает окно, набор остаётся. Иначе
      // случайный Esc уносил бы вместе с окном всю набранную работу.
      if (target) { setTarget(null); return; }
      setMarks(new Set<string>());
      setPicking(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, picking, marks]);

  if (!rows.length || !cols.length) {
    return (
      <div className="sk-matrix">
        <p className="sk-matrix__empty" data-testid="kit-matrix-empty">{kitT(lang, 'kit.matrix.empty')}</p>
      </div>
    );
  }

  const title = (opts: readonly MatrixOption[], value: string) => opts.find(o => o.value === value)?.title ?? value;

  /**
   * Подпись ячейки словами — она же уходит в aria-label и в подсказку.
   *
   * Три «неизвестно» печатает ОБЩИЙ словарь kit (`unknownOutcome.ts`): те же
   * слова читают и цепочка причин, и дифф, а два разных «неизвестно» на одном
   * экране заставили бы искать разницу там, где её нет.
   */
  function say(c: MatrixCellState): string {
    if (c.state === 'value') return title(options, c.value);
    if (c.state === 'none') return kitT(lang, 'kit.matrix.cell.none');
    return sayUnknown(lang, c.state, c.reason);
  }

  /** Отмеченные ячейки в порядке показа: порядок предложения — порядок экрана. */
  function markedPairs(): { row: string; col: string }[] {
    const out: { row: string; col: string }[] = [];
    for (const r of rows) {
      for (const c of cols) if (marks.has(markKey(r.key, c.key))) out.push({ row: r.key, col: c.key });
    }
    return out;
  }

  /** Выбор есть только там, где есть кому предложить изменение. */
  const canPick = Boolean(onPropose);
  const toggleMark = (row: string, col: string) => setMarks(prev => {
    const n = new Set(prev);
    const k = markKey(row, col);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const clearMarks = () => { setMarks(new Set<string>()); setPicking(false); };

  function propose(value: string | null) {
    const t = target;
    setTarget(null);
    if (!t || !onPropose) return;
    if (t.kind === 'cell') {
      setSkipped(null);
      onPropose([{ row: t.row, col: t.col, value, from: cell(t.row, t.col) }]);
      return;
    }
    const pairs = t.kind === 'row'
      ? cols.map(c => ({ row: t.row, col: c.key }))
      : t.kind === 'col'
        ? rows.map(r => ({ row: r.key, col: t.col }))
        : markedPairs();
    const changes: MatrixChange[] = [];
    let skip = 0;
    for (const p of pairs) {
      const from = cell(p.row, p.col);
      if (!known(from)) { skip += 1; continue; }
      changes.push({ ...p, value, from });
    }
    // Набор отработал — отметки снимаем: вторая пачка по тем же ячейкам ушла
    // бы с прежним состоянием, которое первая пачка уже меняет.
    if (t.kind === 'marks') setMarks(new Set<string>());
    setSkipped(skip > 0 ? skip : null);
    onPropose(changes);
  }

  const menu = target && onPropose
    ? (
      <div className="sk-matrix__menu" data-testid="kit-matrix-menu" role="group" aria-label={kitT(lang, 'kit.matrix.menu')} ref={box}>
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            className="sk-matrix__opt"
            data-testid={`kit-matrix-opt-${o.value}`}
            onClick={() => propose(o.value)}
          >
            {o.title}
          </button>
        ))}
        {/* «Снять» только там, где есть что снимать: у пустой ячейки эта кнопка
            обещала бы действие, которого нет. У строки и колонки снять можно
            всегда — там есть хотя бы одна заполненная ячейка. */}
        {(target.kind === 'row' || target.kind === 'col'
          || (target.kind === 'cell' && cell(target.row, target.col).state === 'value')
          || (target.kind === 'marks' && markedPairs().some(p => cell(p.row, p.col).state === 'value'))) && (
          <button
            type="button"
            className="sk-matrix__opt is-clear"
            data-testid="kit-matrix-clear"
            onClick={() => propose(null)}
          >
            {kitT(lang, 'kit.matrix.clear')}
          </button>
        )}
      </div>
    )
    : null;

  /**
   * Полоса выбора. Кнопка режима нужна ОТДЕЛЬНО от Ctrl-клика: Ctrl есть у
   * мыши, а у клавиатуры и у пальца его нет, и без кнопки выбор нескольких
   * оказался бы только у мыши на большом экране. «Задать выбранным» и «снять
   * выбор» появляются, когда есть что задавать и что снимать.
   */
  const markBar = canPick
    ? (
      <div className="sk-matrix__bar" data-testid="kit-matrix-bar">
        <button
          type="button"
          className="sk-matrix__mode"
          data-testid="kit-matrix-markmode"
          aria-pressed={picking}
          onClick={() => { if (picking) clearMarks(); else setPicking(true); }}
        >
          {kitT(lang, 'kit.matrix.markMode')}
        </button>
        {marks.size > 0 && (
          <>
            <span className="sk-matrix__count" role="status" data-testid="kit-matrix-marked">
              {kitT(lang, 'kit.matrix.marked', { n: marks.size })}
            </span>
            <button
              type="button"
              className="sk-matrix__all"
              data-testid="kit-matrix-markset"
              onClick={() => setTarget({ kind: 'marks' })}
            >
              {kitT(lang, 'kit.matrix.setMarks')}
            </button>
            <button
              type="button"
              className="sk-matrix__all"
              data-testid="kit-matrix-unmark"
              onClick={clearMarks}
            >
              {kitT(lang, 'kit.matrix.unmark')}
            </button>
          </>
        )}
      </div>
    )
    : null;

  function cellButton(rowKey: string, colKey: string, colTitle: string, rowTitle: string) {
    const c = cell(rowKey, colKey);
    const editable = Boolean(onPropose) && known(c);
    const marked = marks.has(markKey(rowKey, colKey));
    const text = say(c);
    return (
      <button
        type="button"
        className={['sk-matrix__cell', marked ? 'is-marked' : ''].filter(Boolean).join(' ')}
        data-testid={`kit-matrix-cell-${rowKey}-${colKey}`}
        data-state={c.state}
        data-marked={marked ? 'true' : undefined}
        title={text}
        aria-label={`${rowTitle} · ${colTitle}: ${text}`}
        /* Отмечать можно любую ячейку, в том числе непроверенную: набор берут
           одним движением, и делать вид, что её тут нет, — обман. Из
           предложения она выпадет и будет названа числом (propose). */
        aria-pressed={canPick && (picking || marks.size > 0) ? marked : undefined}
        aria-disabled={picking || editable ? undefined : true}
        onClick={e => {
          if (canPick && (picking || e.ctrlKey || e.metaKey)) { toggleMark(rowKey, colKey); return; }
          if (editable) setTarget({ kind: 'cell', row: rowKey, col: colKey });
        }}
      >
        {c.state === 'value'
          ? <span className="sk-matrix__chip">{title(options, c.value)}</span>
          : (
            <span className="sk-matrix__mark">
              {c.state === 'none' ? '—' : c.state === 'unverified' ? '?' : c.state === 'unasked' ? '○' : '×'}
            </span>
          )}
      </button>
    );
  }

  if (narrow) {
    const current = rows.find(r => r.key === pick) ?? rows[0];
    return (
      <div className="sk-matrix sk-matrix--narrow">
        <div className="sk-matrix__pick" data-testid="kit-matrix-rowpick" role="group" aria-label={labels.rows}>
          <span className="sk-matrix__axis">{labels.rows}</span>
          {rows.map(r => (
            <button
              key={r.key}
              type="button"
              className={['sk-matrix__pickbtn', r.key === current.key ? 'is-on' : ''].filter(Boolean).join(' ')}
              data-testid={`kit-matrix-pick-${r.key}`}
              aria-pressed={r.key === current.key}
              onClick={() => setPick(r.key)}
            >
              {r.title}
            </button>
          ))}
        </div>
        {markBar}
        <span className="sk-matrix__axis">{labels.cols}</span>
        <ul className="sk-matrix__list">
          {cols.map(c => (
            <li key={c.key} className="sk-matrix__listrow">
              <span className="sk-matrix__listtitle">{c.title}</span>
              {cellButton(current.key, c.key, c.title, current.title)}
            </li>
          ))}
        </ul>
        {onPropose && (
          <button
            type="button"
            className="sk-matrix__all"
            data-testid={`kit-matrix-rowset-${current.key}`}
            onClick={() => setTarget({ kind: 'row', row: current.key })}
          >
            {kitT(lang, 'kit.matrix.setRow')}
          </button>
        )}
        {menu}
        {skipped !== null && (
          <p className="sk-matrix__skipped" role="status" data-testid="kit-matrix-skipped">
            {kitT(lang, 'kit.matrix.skipped', { n: skipped })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="sk-matrix">
      {markBar}
      <div className="sk-matrix__scroll">
        <table className="sk-matrix__table">
          <caption className="sk-matrix__caption">{`${labels.rows} × ${labels.cols}`}</caption>
          <thead>
            <tr>
              <th scope="col" className="sk-matrix__corner">
                <span className="sk-matrix__axis">{labels.rows}</span>
              </th>
              {cols.map(c => (
                <th key={c.key} scope="col" className="sk-matrix__colhead">
                  <span className="sk-matrix__coltitle">{c.title}</span>
                  {onPropose && (
                    <button
                      type="button"
                      className="sk-matrix__all"
                      data-testid={`kit-matrix-colset-${c.key}`}
                      onClick={() => setTarget({ kind: 'col', col: c.key })}
                    >
                      {kitT(lang, 'kit.matrix.setCol')}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <th scope="row" className="sk-matrix__rowhead">
                  <span className="sk-matrix__rowtitle">{r.title}</span>
                  {onPropose && (
                    <button
                      type="button"
                      className="sk-matrix__all"
                      data-testid={`kit-matrix-rowset-${r.key}`}
                      onClick={() => setTarget({ kind: 'row', row: r.key })}
                    >
                      {kitT(lang, 'kit.matrix.setRow')}
                    </button>
                  )}
                </th>
                {cols.map(c => (
                  <td key={c.key} className="sk-matrix__td">
                    {cellButton(r.key, c.key, c.title, r.title)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="sk-matrix__axis sk-matrix__axis--cols">{labels.cols}</span>
      {menu}
      {skipped !== null && (
        <p className="sk-matrix__skipped" role="status" data-testid="kit-matrix-skipped">
          {kitT(lang, 'kit.matrix.skipped', { n: skipped })}
        </p>
      )}
    </div>
  );
}
