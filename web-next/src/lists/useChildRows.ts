// PU-23: дети раскрытой строки списка — ленивая загрузка по раскрытию и состояние на каждую строку.
// kit спрашивает детей при отрисовке раскрытой строки; первый вопрос запускает загрузку, ответ
// приходит следующей отрисовкой. Сбой — со своим «повторить», а не пустой список. Загрузчику
// отдаётся сама строка-родитель: часть полей ребёнка (релиз задачи = релиз спринта) — её.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KitRecord, ListExpandRows } from '@seidr/kit';

export type ChildLoader = (parent: KitRecord, signal: AbortSignal) => Promise<KitRecord[]>;

export function useChildRows(load: ChildLoader | undefined): (r: KitRecord) => ListExpandRows | undefined {
  const [byId, setById] = useState<Record<string, ListExpandRows>>({});
  const started = useRef(new Set<string>());
  const ctls = useRef(new Map<string, AbortController>());
  useEffect(() => () => { for (const c of ctls.current.values()) c.abort(); }, []);
  // Новый загрузчик (сменился клиент или экран) — прежние ответы к нему не относятся.
  useEffect(() => { started.current.clear(); setById({}); }, [load]);

  const start = useCallback((parent: KitRecord) => {
    if (!load) return;
    const id = parent.id;
    ctls.current.get(id)?.abort();
    const ctl = new AbortController();
    ctls.current.set(id, ctl);
    started.current.add(id);
    setById(m => ({ ...m, [id]: { state: 'loading', records: [] } }));
    load(parent, ctl.signal).then(
      records => { if (!ctl.signal.aborted) setById(m => ({ ...m, [id]: { state: 'ok', records } })); },
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        setById(m => ({ ...m, [id]: { state: 'error', records: [], error: e instanceof Error ? e.message : String(e), onRetry: () => start(parent) } }));
      },
    );
  }, [load]);

  return useCallback((r: KitRecord) => {
    if (!load) return undefined;
    const s = byId[r.id];
    if (s) return s;
    if (!started.current.has(r.id)) {
      started.current.add(r.id);
      // Загрузку не начинаем посреди отрисовки kit — следующим тиком.
      queueMicrotask(() => start(r));
    }
    return { state: 'loading', records: [] };
  }, [byId, load, start]);
}
