// SPRINT_LORE_PRODUCT_BACKLOG/AN-06 · ADR-LORE-030 §2 срез I «реинжиниринг-нагрузка».
// decision:D-2026-LORE-REENG-SHIPPED-IN-REWORK: uc-задача к выпущенному сценарию
// переводит его в in_rework, shipped_at сохраняется.
//
// Эпизод переделки = uc-задача, заведённая ПОСЛЕ shipped_at её сценария
// (дата заведения — самая ранняя дата её состояний). Длительность закрытой —
// от заведения до закрытия; открытой — возраст на сегодня. Строка без дат не
// выбрасывается молча: она считается в `undated` — «не смогли проверить» ≠ «нет».

export type ReengRow = {
  task_uid: string;
  uc_id: string | null;
  uc_title: string | null;
  uc_status: string | null;
  shipped_at: string | null;
  state_dates: string[] | null;
  status_raw: string | null;
  status_since: string | null;
};

export type ReengUc = {
  uc_id: string;
  uc_title: string;
  uc_status: string;
  shipped_at: string;
  tasks: number;
  open: number;
  closedDays: number[];
  oldestOpenDays: number | null;
};

const DAY = 86_400_000;
const day = (s: string | null | undefined): string | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY));
// Тот же набор «закрыто», что у вычислителя готовности сценария (DONE | CLOSED | ЗАВЕРШ).
const isClosed = (s: string | null) => !!s && /DONE|CLOSED|ЗАВЕРШ/.test(s);
// Отмена — не работа: ни возврат к выпущенному, ни открытая переделка. Считается отдельно.
const isCancelled = (s: string | null) => !!s && /CANCEL|ОТМЕН|СНЯТ/i.test(s);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function reengLoadOf(rows: ReengRow[], today: string) {
  const seen = new Set<string>();
  const reworkStatus = new Set<string>();
  const byUc = new Map<string, ReengUc>();
  let undated = 0;
  let cancelled = 0;
  for (const r of rows) {
    const shipped = day(r.shipped_at);
    if (!r.uc_id || !shipped) continue;
    seen.add(r.uc_id);
    if (r.uc_status === 'in_rework') reworkStatus.add(r.uc_id);
    const dates = (r.state_dates ?? []).map(day).filter((d): d is string => !!d).sort();
    if (!dates.length) { undated++; continue; }
    const created = dates[0];
    if (created <= shipped) continue;              // работа до выпуска — не возврат
    if (isCancelled(r.status_raw)) { cancelled++; continue; }
    const uc = byUc.get(r.uc_id) ?? {
      uc_id: r.uc_id, uc_title: r.uc_title ?? r.uc_id, uc_status: r.uc_status ?? '',
      shipped_at: shipped, tasks: 0, open: 0, closedDays: [], oldestOpenDays: null,
    };
    uc.tasks++;
    if (isClosed(r.status_raw)) {
      const done = day(r.status_since) ?? created;
      uc.closedDays.push(daysBetween(created, done));
    } else {
      uc.open++;
      const age = daysBetween(created, today);
      uc.oldestOpenDays = Math.max(uc.oldestOpenDays ?? 0, age);
    }
    byUc.set(r.uc_id, uc);
  }
  const ucs = [...byUc.values()].sort((a, b) => b.open - a.open || b.tasks - a.tasks || a.uc_id.localeCompare(b.uc_id));
  return {
    ucs,
    shippedSeen: seen.size,
    undated,
    cancelled,
    // Статус говорит «переделка», а открытой работы после выпуска нет: вычислитель
    // готовности и факты расходятся (например, держат отменённые задачи).
    reworkWithoutOpen: [...reworkStatus].filter(id => !(byUc.get(id)?.open)).sort(),
    medianClosedDays: median(ucs.flatMap(u => u.closedDays)),
  };
}
