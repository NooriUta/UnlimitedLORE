// Живой блок в Markdown (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S6-04): ограждённый
// блок, который приложение умеет исполнить (в LORE — lore-query, lore-graph).
//
// Прототип и ответы владелицы 11.11.2026 («по всем вопросам принимаю твои
// рекомендации»):
//   • при открытии — превью; режимы «код / превью / рядом»; на телефоне «рядом» нет;
//   • режим нигде не хранится — живёт, пока открыт текст;
//   • пересчёт при открытии, по «обновить» и при возврате на вкладку, если
//     данным больше 15 мин;
//   • «данные на …» — время от бэкенда (generatedAt), иначе часы браузера в
//     момент ответа, и это сказано в подсказке;
//   • сбой ≠ пусто, нет прав ≠ пусто, «показаны N из M».
// Граница K-14: kit не знает ни языков, ни срезов, ни $this — исполнителя
// передаёт приложение, kit рисует рамку, режимы, состояния и свежесть.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { EmptyState, Forbidden, LoadError, Skeleton } from '../states';

export interface LiveTableColumn { key: string; title: string }

export type LiveBlockResult =
  | { kind: 'table'; columns: LiveTableColumn[]; rows: Record<string, string | number | null>[]; total?: number; generatedAt?: string; scope?: string }
  | { kind: 'view'; node: ReactNode; shown?: number; total?: number; empty?: boolean; generatedAt?: string; scope?: string };

/** Отказ исполнителя: код (UNSUPPORTED_STAGE, UNRESOLVED_VAR…), текст, HTTP-статус (403 — нет прав). */
export class LiveBlockError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = 'LiveBlockError';
  }
}

export type LiveBlockRun = (source: string, signal: AbortSignal) => Promise<LiveBlockResult>;
/** Язык фенса → исполнитель. Языка нет в списке — блок остаётся обычным кодом. */
export type LiveBlocks = Readonly<Record<string, LiveBlockRun>>;

type Mode = 'code' | 'preview' | 'side';
type State =
  | { s: 'loading' }
  | { s: 'ok'; r: LiveBlockResult; at: number; serverTime: boolean }
  | { s: 'error'; e: unknown };

/** Старше — пересчитать при возврате на вкладку (ответ владелицы, вопрос 3). */
export const LIVE_STALE_MS = 15 * 60_000;

export function LiveBlock({ lang: fenceLang, source, run, narrow }: { lang: string; source: string; run: LiveBlockRun; narrow?: boolean }) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [mode, setMode] = useState<Mode>('preview');
  const [state, setState] = useState<State>({ s: 'loading' });
  const [gen, setGen] = useState(0);
  const atRef = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    run(source, ac.signal).then(
      r => {
        if (ac.signal.aborted) return;
        const parsed = r.generatedAt ? Date.parse(r.generatedAt) : NaN;
        const at = Number.isNaN(parsed) ? Date.now() : parsed;
        atRef.current = Date.now();
        setState({ s: 'ok', r, at, serverTime: !Number.isNaN(parsed) });
      },
      e => { if (!ac.signal.aborted) { atRef.current = Date.now(); setState({ s: 'error', e }); } },
    );
    return () => ac.abort();
  }, [run, source, gen]);

  const refresh = useCallback(() => { setState({ s: 'loading' }); setGen(g => g + 1); }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') return;
      if (atRef.current && Date.now() - atRef.current > LIVE_STALE_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const effMode: Mode = narrow && mode === 'side' ? 'preview' : mode;
  const modes: { m: Mode; key: KitKey }[] = [
    { m: 'code', key: 'kit.live.code' }, { m: 'preview', key: 'kit.live.preview' },
    ...(narrow ? [] : [{ m: 'side' as Mode, key: 'kit.live.side' as KitKey }]),
  ];
  const head = source.split('\n')[0];

  const result = (() => {
    if (state.s === 'loading') return <Skeleton lines={3} />;
    if (state.s === 'error') {
      const e = state.e;
      if (e instanceof LiveBlockError && e.status === 403) return <Forbidden compact reason={e.message} />;
      const code = e instanceof LiveBlockError ? e.code : '';
      return <LoadError compact title={t('kit.live.failed')} error={code ? `${code} · ${(e as Error).message}` : e} onRetry={refresh} />;
    }
    const r = state.r;
    if (r.kind === 'view') return r.empty ? <EmptyState compact title={t('kit.live.empty')} hint={t('kit.live.emptyHint')} /> : <div className="sk-live__view">{r.node}</div>;
    if (r.rows.length === 0) return <EmptyState compact title={t('kit.live.empty')} hint={t('kit.live.emptyHint')} />;
    return (
      <div className="sk-live__scroll">
        <table className="sk-live__table">
          <thead><tr>{r.columns.map(c => <th key={c.key} scope="col">{c.title}</th>)}</tr></thead>
          <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map(c => <td key={c.key}>{row[c.key] ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  })();

  const shown = state.s === 'ok' ? (state.r.kind === 'table' ? state.r.rows.length : state.r.shown) : undefined;
  const total = state.s === 'ok' ? state.r.total : undefined;
  const timeFmt = new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const stale = state.s === 'ok' && Date.now() - state.at > LIVE_STALE_MS;

  return (
    <section className="sk-live" aria-label={`${fenceLang}: ${head}`} data-mode={effMode} data-lang={fenceLang}>
      <div className="sk-live__head">
        <span className="sk-live__lang">{fenceLang}</span>
        <code className="sk-live__src">{head}</code>
        <div className="sk-live__modes" role="group" aria-label={t('kit.live.modes')}>
          {modes.map(({ m, key }) => (
            <button key={m} type="button" className="sk-seg__btn" aria-pressed={effMode === m} onClick={() => setMode(m)}>{t(key)}</button>
          ))}
        </div>
      </div>
      <div className="sk-live__body">
        {effMode !== 'preview' && <pre className="sk-live__code">{source}</pre>}
        {effMode !== 'code' && <div className="sk-live__result">{result}</div>}
      </div>
      <div className="sk-live__foot">
        {state.s === 'ok' && (
          <span className="sk-live__fresh" data-stale={stale ? '' : undefined}
            title={t(state.serverTime ? 'kit.live.timeServer' : 'kit.live.timeClient')}>
            {t('kit.live.asOf', { time: timeFmt.format(new Date(state.at)) })}
          </span>
        )}
        <button type="button" className="sk-live__refresh" onClick={refresh} disabled={state.s === 'loading'}>{t('kit.live.refresh')}</button>
        {shown != null && total != null && total > shown && <span className="sk-live__trunc">{t('kit.live.truncated', { n: shown, total })}</span>}
        {state.s === 'ok' && state.r.scope && <span className="sk-live__scope">{state.r.scope}</span>}
      </div>
    </section>
  );
}
