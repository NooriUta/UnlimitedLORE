import { describe, it, expect } from 'vitest';
import { scanFailureAsEmpty, catchHandlers, summarize, countLoadSites } from './failureAsEmpty';

/**
 * SPRINT_UXR_S0_SAFETY/S0-08 · замер «до»: где сбой загрузки выглядит как «пусто».
 *
 * Это ИЗМЕРИТЕЛЬ, а не сторож: тест проверяет, что сканер ловит нужные формы и
 * не ловит честные, но число находок не фиксирует — его снимают метрикой в LORE
 * (`ux_failure_as_empty_sites`) до редизайна и повторяют после (SPRINT_UXR_S8_SWITCH/S8-03).
 * Сторож «нуля» здесь сломал бы каждый PR, пока места не починены.
 *
 * Снять инвентаризацию: `UXR_BASELINE=1 npx vitest run src/audit/failureAsEmpty.test.ts`.
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('S0-08 · сканер «сбой как пусто»', () => {
  it('видит исходники (иначе «0 мест» ничего не значит)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('вырезает тело .catch(...) по скобкам, в т.ч. многострочное', () => {
    const src = 'a.then(x => f(x))\n  .catch(e => {\n    onError(e);\n    setLoading(false);\n  });\nnext();';
    const hs = catchHandlers(src);
    expect(hs).toHaveLength(1);
    expect(hs[0].line).toBe(2);
    expect(hs[0].body).toContain('setLoading(false)');
    expect(hs[0].body).not.toContain('next()');
  });

  it('положительный контроль: ловит обе формы', () => {
    const bad: Record<string, string> = {
      'toast.tsx': "fetchLoreSlice<LoreAdrRow>('adrs', params, ctrl.signal).then(r => setRows(r)).catch(e => { onError(e); setLoading(false); });",
      'toastMulti.tsx': "fetchLoreSlice('x')\n  .then(r => setRows(r))\n  .catch(e => {\n    if (!ctrl.signal.aborted) { onError(e); setLoading(false); }\n  });",
      'useSliceDestr.tsx': "const { rows: pains } = useSlice<P>('pains', undefined, onError, []);",
      'useSliceObj.tsx': "const painsQ = useSlice<P>('pains', undefined, onError, []);\nconst pains = painsQ.rows;",
    };
    const found = scanFailureAsEmpty(bad);
    expect(found.map(f => `${f.file}:${f.rule}`).sort()).toEqual([
      'toast.tsx:toast-only-catch',
      'toastMulti.tsx:toast-only-catch',
      'useSliceDestr.tsx:useslice-error-unread',
      'useSliceObj.tsx:useslice-error-unread',
    ]);
  });

  it('отрицательный контроль: честные формы не ловит', () => {
    const ok: Record<string, string> = {
      'ownErr.tsx': "fetchLoreSlice('x').catch(e => { onError(e); setLoadErr(describeLoreError(e).text); });",
      'pageLevel.tsx': "fetchLoreSlice('x').catch(e => { const f = toLoadFailure(e); if (f.k === 'error' && !f.pageLevel) setLoadErr(f.text); else onError(e); });",
      'write.tsx': "postLoreStatus('task', id, s).catch(e => { onError(e); setBusy(false); });",
      'useSliceErr.tsx': "const { rows, error } = useSlice<P>('pains', undefined, onError, []);",
      'useSliceObjErr.tsx': "const q = useSlice<P>('pains', undefined, onError, []);\nif (q.error) return <LoadError />;",
      'decl.tsx': 'export function useSlice<T>(slice: string) { return null; }',
    };
    expect(scanFailureAsEmpty(ok)).toEqual([]);
  });

  it('знаменатель доли: считает все места загрузки (catch на fetch* + вызовы useSlice)', () => {
    const src: Record<string, string> = {
      'a.tsx': [
        "fetchLoreSlice<R>('x').then(r => setRows(r)).catch(e => { onError(e); setLoading(false); });",
        "fetchLoreSlice<R>('y').then(r => setY(r)).catch(e => { onError(e); setYErr(String(e)); });",
        "postLoreStatus('task', id, s).catch(e => { onError(e); });",
        "const { rows, error } = useSlice<P>('pains', undefined, onError, []);",
      ].join('\n'),
    };
    expect(countLoadSites(src)).toBe(3);
  });

  it('на текущем коде находит места и сводит их по файлам', () => {
    const found = scanFailureAsEmpty(sources);
    const s = summarize(found, countLoadSites(sources));
    expect(s.loadSites).toBeGreaterThanOrEqual(s.sites);
    expect(s.share).toBeGreaterThan(0);
    expect(s.share).toBeLessThanOrEqual(1);
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (env?.UXR_BASELINE) {
      console.log(JSON.stringify(s, null, 2));
    }
    expect(s.sites).toBe(found.length);
    expect(s.files).toBeGreaterThan(0);
    expect(s.sites).toBeGreaterThan(0);
  });
});
