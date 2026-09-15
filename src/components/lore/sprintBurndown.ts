// Burn-down спринта: остаток задач по дням. Данные — те же сырые срезы, что
// у аналитики: task_created_dates (строки SCD2-истории, создание = min
// valid_from по задаче) и task_done_dates (текущее done-состояние).
// Принадлежность спринту — по префиксу task_uid «SPRINT_X/», с косой чертой:
// иначе SPRINT_X цеплял бы SPRINT_X2.

export interface BurnRow { task_uid: string | null; valid_from: string | null }
export interface BurnPoint { date: string; scope: number; done: number; remaining: number }

// Высота графика в px — ФИКСИРОВАННАЯ, не пропорциональная ширине: с одним
// viewBox и width=100% burn-down на широкой панели вырастал до ~400px
// (владелец: «это очень внезапно»). Живёт в конце блока «Контекст» —
// одна высота, соразмерная тексту описания (владелец: «сделай соразмерным»).
export const BURN_H = { inline: 64 } as const;

export function sprintBurndown(created: BurnRow[], done: BurnRow[], sprintId: string): BurnPoint[] {
  const prefix = `${sprintId}/`;
  const firstDay = new Map<string, string>();
  for (const r of created) {
    if (!r.task_uid?.startsWith(prefix) || !r.valid_from) continue;
    const cur = firstDay.get(r.task_uid);
    if (!cur || r.valid_from < cur) firstDay.set(r.task_uid, r.valid_from);
  }
  const doneDay = new Map<string, string>();
  for (const r of done) {
    if (!r.task_uid?.startsWith(prefix) || !r.valid_from) continue;
    doneDay.set(r.task_uid, r.valid_from);
  }

  const delta = new Map<string, { s: number; d: number }>();
  const bump = (day: string, key: 's' | 'd') => {
    const e = delta.get(day) ?? { s: 0, d: 0 };
    e[key]++;
    delta.set(day, e);
  };
  for (const v of firstDay.values()) bump(v.slice(0, 10), 's');
  for (const v of doneDay.values()) bump(v.slice(0, 10), 'd');

  let scope = 0, closed = 0;
  return [...delta.keys()].sort().map(date => {
    scope += delta.get(date)!.s;
    closed += delta.get(date)!.d;
    return { date, scope, done: closed, remaining: scope - closed };
  });
}
