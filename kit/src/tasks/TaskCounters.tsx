// Счётчики в шапке спринта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36) — как в v1:
// ряд значков со счётчиками по статусам, «закрыто из всего» и сумма оценок.
//
// Считаем по уже загруженным задачам, а не вторым запросом: иначе шапка и
// таблица могут показать разное, и человек не поймёт, какому числу верить.
//
// Ноль не рисуем. Статус, которого в выборке нет, в шапке не появляется:
// «0 отменённых» — это не факт о спринте, а шум.
import { GameIcon } from '../elements/GameIcon';
import { statusMeta } from '../elements/statusMeta';
import { kitT, useKitLang } from '../i18n';
import { taskStatusName } from './TaskTable';
import { TASK_STATUSES, type TaskRowData } from './taskGroups';

export interface TaskCountersProps {
  tasks: readonly TaskRowData[];
  className?: string;
}

/** Порядок: сначала канон жизненного цикла, потом всё непредусмотренное. */
function orderedCodes(codes: Iterable<string>): string[] {
  const seen = [...new Set(codes)];
  const known = TASK_STATUSES.filter(s => seen.includes(s));
  const rest = seen.filter(c => !(TASK_STATUSES as readonly string[]).includes(c)).sort();
  return [...known, ...rest];
}

export function TaskCounters({ tasks, className }: TaskCountersProps) {
  const lang = useKitLang();
  if (tasks.length === 0) return null;

  const counts = new Map<string, number>();
  let done = 0;
  let effort = 0;
  let hasEffort = false;
  for (const t of tasks) {
    const meta = statusMeta(t.status);
    counts.set(meta.code, (counts.get(meta.code) ?? 0) + 1);
    if (meta.category === 'done') done += 1;
    if (typeof t.effortDays === 'number') { effort += t.effortDays; hasEffort = true; }
  }
  const fmt = new Intl.NumberFormat(lang === 'en' ? 'en' : 'ru', { maximumFractionDigits: 2 });

  return (
    <div className={['sk-tc', className].filter(Boolean).join(' ')}>
      <span className="sk-tc__group" data-testid="tc-statuses">
        {orderedCodes(counts.keys()).map(code => {
          const meta = statusMeta(code);
          const name = taskStatusName(lang, code);
          const n = counts.get(code) ?? 0;
          return (
            <span key={code} className="sk-tc__item" title={`${name}: ${n}`}>
              <GameIcon slug={meta.icon} size={13} color={meta.color} label={name} />
              <span className="sk-tc__n">{n}</span>
            </span>
          );
        })}
      </span>
      <span className="sk-tc__progress" data-testid="tc-progress" title={kitT(lang, 'kit.tasks.counters.progress')}>
        {done}/{tasks.length}
      </span>
      {/* Оценок нет ни у кого — молчим: «0 дней» и «оценок не ставили» разное. */}
      {hasEffort && (
        <span className="sk-tc__effort" data-testid="tc-effort" title={kitT(lang, 'kit.tasks.counters.effort')}>
          Σ {fmt.format(effort)}
        </span>
      )}
    </div>
  );
}
