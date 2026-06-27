import { useCallback, useEffect, useRef, useState } from 'react';
import type { HuginnStatus } from '../utils/huginnData';
import {
  HuginnRootMissingError,
  HuginnUnavailableError,
  MartDisabledError,
  fetchHuginnStatus,
  fetchMartSlice,
} from '../api/huginn';

const STATUS_POLL_INTERVAL_MS = 4000;

export interface HuginnStatusState {
  status: HuginnStatus | null;
  /** last poll failed (mid-write / transient) — showing last good value */
  stale: boolean;
  /** endpoints absent (prod/Shell) or repo not found — feature unavailable */
  unavailable: boolean;
  error: string | null;
}

/**
 * Poll the live STATUS.json with keep-last-good semantics (the orchestrator
 * rewrites the file every few seconds — a torn read must not blank the card).
 */
export function useHuginnStatus(intervalMs: number = STATUS_POLL_INTERVAL_MS): HuginnStatusState {
  const [state, setState] = useState<HuginnStatusState>({
    status: null, stale: false, unavailable: false, error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const status = await fetchHuginnStatus(ctrl.signal);
        if (!cancelled) setState({ status, stale: false, unavailable: false, error: null });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (err instanceof HuginnUnavailableError || err instanceof HuginnRootMissingError) {
          setState(prev => ({ ...prev, unavailable: true, error: (err as Error).message }));
          return;
        }
        setState(prev => ({ ...prev, stale: prev.status !== null, error: String((err as Error).message ?? err) }));
      }
    }

    void poll();
    const timer = setInterval(() => { void poll(); }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [intervalMs]);

  return state;
}

export interface MartSliceState<T> {
  rows: T[] | null;
  loading: boolean;
  /** mart endpoints disabled/absent — dev-only feature unavailable */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * One-shot fetch of a named mart slice. Pass params=null to hold the fetch
 * (e.g. until the user picks the required pins — drift needs model+prompt).
 */
export function useMartSlice<T>(
  slice: string,
  params: Record<string, string> | null,
): MartSliceState<T> {
  const [rows, setRows] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const paramsKey = params === null ? null : JSON.stringify(params);

  useEffect(() => {
    if (paramsKey === null) {
      setRows(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetchMartSlice<T>(slice, JSON.parse(paramsKey) as Record<string, string>, ctrl.signal)
      .then(result => {
        if (!cancelled) { setRows(result); setUnavailable(false); }
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (err instanceof HuginnUnavailableError || err instanceof MartDisabledError) {
          setUnavailable(true);
        }
        setError(String((err as Error).message ?? err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; ctrl.abort(); };
  }, [slice, paramsKey, nonce]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { rows, loading, unavailable, error, reload };
}
