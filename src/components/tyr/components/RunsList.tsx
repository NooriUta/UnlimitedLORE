import type { RunMeta } from '../api';

interface Props {
  runs: RunMeta[];
  activeId: string | null;
  onPick: (id: string) => void;
}

const ICON: Record<RunMeta['status'], string> = {
  queued:    '⏸',
  running:   '⏳',
  passed:    '✓',
  failed:    '✗',
  error:     '!',
  cancelled: '∅',
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDur(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function RunsList({ runs, activeId, onPick }: Props) {
  if (runs.length === 0) {
    return <div className="muted">Прогонов ещё не было</div>;
  }
  return (
    <ul className="runs">
      {runs.map((r) => (
        <li
          key={r.id}
          className={`run-item status-${r.status} ${r.id === activeId ? 'active' : ''}`}
          onClick={() => onPick(r.id)}
        >
          <span className={`icon status-${r.status}`}>{ICON[r.status]}</span>
          <div className="run-info">
            <div className="run-line1">
              <span className="run-descr">{r.filterDescr}</span>
              <span className="run-mode">{r.mode}</span>
            </div>
            <div className="run-line2">
              {fmtDate(r.startedAt)} · {fmtDur(r.durationMs)}
              {r.passed + r.failed > 0 && (
                <> · ✓{r.passed} ✗{r.failed}</>
              )}
              {r.commit && <> · <code>{r.commit}</code></>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
