import { useState, useEffect, useMemo } from 'react';
import '../styles/bragi.css';

interface Task {
  task_uid: string;
  task_id: string;
  title: string;
  status_raw?: string;
  priority?: string;
  component_id?: string;
  sprint_id?: string;
  sprint_title?: string;
  note_md?: string;
}

const STATUS_ICON: Record<string, string> = {
  '✅': '✅', 'DONE': '✅', 'CLOSED': '✅',
  '🟡': '🟡', 'PARTIAL': '🟡',
  '🔄': '🔄', 'IN_PROGRESS': '🔄', 'IN PROGRESS': '🔄',
  '📋': '📋', 'BACKLOG': '📋',
  '⬜': '⬜', 'DEFERRED': '⬜',
  '🔴': '🔴', 'BLOCKED': '🔴',
};

function statusIcon(raw?: string): string {
  if (!raw) return '📋';
  const up = raw.toUpperCase().trim();
  for (const [k, v] of Object.entries(STATUS_ICON)) {
    if (raw.includes(k) || up.includes(k)) return v;
  }
  return '📋';
}

function statusLabel(raw?: string): string {
  if (!raw) return 'Backlog';
  if (raw.includes('✅') || raw.toUpperCase().includes('DONE') || raw.toUpperCase().includes('CLOSED')) return 'Готово';
  if (raw.includes('🟡') || raw.toUpperCase().includes('PARTIAL')) return 'Частично';
  if (raw.includes('🔄') || raw.toUpperCase().includes('IN PROGRESS')) return 'В работе';
  if (raw.includes('🔴') || raw.toUpperCase().includes('BLOCKED')) return 'Блок';
  if (raw.includes('⬜') || raw.toUpperCase().includes('DEFERRED')) return 'Отложено';
  return 'Backlog';
}

function statusClass(raw?: string): string {
  if (!raw) return 'bragi-status-backlog';
  const up = raw.toUpperCase();
  if (raw.includes('✅') || up.includes('DONE') || up.includes('CLOSED')) return 'bragi-status-done';
  if (raw.includes('🟡') || up.includes('PARTIAL')) return 'bragi-status-partial';
  if (raw.includes('🔄') || up.includes('IN PROGRESS')) return 'bragi-status-progress';
  if (raw.includes('🔴') || up.includes('BLOCKED')) return 'bragi-status-blocked';
  if (raw.includes('⬜') || up.includes('DEFERRED')) return 'bragi-status-deferred';
  return 'bragi-status-backlog';
}

export default function BragiPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/lore/slice/all_tasks')
      .then((r) => r.json())
      .then((d) => { setTasks(Array.isArray(d) ? d : (Array.isArray(d?.rows) ? d.rows : [])); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      const matchQ = !q ||
        t.title?.toLowerCase().includes(ql) ||
        t.task_id?.toLowerCase().includes(ql) ||
        t.sprint_id?.toLowerCase().includes(ql) ||
        t.sprint_title?.toLowerCase().includes(ql) ||
        t.component_id?.toLowerCase().includes(ql) ||
        t.note_md?.toLowerCase().includes(ql);
      const matchS = !statusFilter || statusLabel(t.status_raw) === statusFilter;
      return matchQ && matchS;
    });
  }, [tasks, q, statusFilter]);

  const statuses = useMemo(() => {
    const s = new Set(tasks.map((t) => statusLabel(t.status_raw)));
    return Array.from(s).sort();
  }, [tasks]);

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.sprint_id ?? '— без спринта';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filtered]);

  return (
    <div className="bragi-root">
      <div className="bragi-header">
        <span className="bragi-logo">✍ BRAGI</span>
        <span className="bragi-sub">Задачи проекта</span>
      </div>

      <div className="bragi-toolbar">
        <input
          className="bragi-search"
          placeholder="Поиск по задачам, спринту, компоненту..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="bragi-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Все статусы</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="bragi-count">{filtered.length} задач</span>
      </div>

      {loading && <div className="bragi-msg">Загрузка...</div>}
      {error && <div className="bragi-msg bragi-err">Ошибка: {error}</div>}

      <div className="bragi-list">
        {Array.from(grouped.entries()).map(([sprint, items]) => (
          <div key={sprint} className="bragi-group">
            <div className="bragi-group-header">
              <span className="bragi-sprint-id">{sprint}</span>
              {items[0]?.sprint_title && sprint !== items[0].sprint_title && (
                <span className="bragi-sprint-title">{items[0].sprint_title}</span>
              )}
              <span className="bragi-group-count">{items.length}</span>
            </div>
            {items.map((t) => (
              <div
                key={t.task_uid}
                className={`bragi-task ${expanded === t.task_uid ? 'bragi-task--open' : ''}`}
                onClick={() => setExpanded(expanded === t.task_uid ? null : t.task_uid)}
              >
                <span className={`bragi-badge ${statusClass(t.status_raw)}`}>
                  {statusIcon(t.status_raw)}
                </span>
                <span className="bragi-task-id">{t.task_id}</span>
                <span className="bragi-task-title">{t.title}</span>
                {t.component_id && (
                  <span className="bragi-component">{t.component_id}</span>
                )}
              </div>
            ))}
            {expanded && items.find((t) => t.task_uid === expanded)?.note_md && (
              <div className="bragi-note">
                {items.find((t) => t.task_uid === expanded)!.note_md}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="bragi-msg">Задачи не найдены</div>
        )}
      </div>
    </div>
  );
}
