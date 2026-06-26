import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  runId: string;
  /** Lines pushed via WS (live). If undefined, fetch initial via HTTP. */
  bufferedLines?: string[];
}

export function LiveLog({ runId, bufferedLines }: Props) {
  const [initial, setInitial] = useState<string>('');
  const ref = useRef<HTMLPreElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const txt = await api.log(runId);
        if (alive) setInitial(txt);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [runId]);

  const live = bufferedLines?.join('\n') ?? '';
  const text = live ? `${initial}\n${live}` : initial;

  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, autoScroll]);

  return (
    <div className="live-log-wrap">
      <div className="log-toolbar">
        <label>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          /> авто-прокрутка
        </label>
        <span className="muted">{text.split('\n').length} стр.</span>
      </div>
      <pre className="live-log" ref={ref}>{ansiStrip(text)}</pre>
    </div>
  );
}

function ansiStrip(s: string): string {
  // remove ANSI color escapes the playwright "list" reporter sometimes emits
  return s.replace(/\[[0-9;]*m/g, '');
}
