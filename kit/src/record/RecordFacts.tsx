// Строка-вердикт шапки записи (SPRINT_UXR_S5_RECORD_TASKS/S5-01):
// статус · задачи x/y · просрочено · свежесть. Расчёт — recordFacts (facts.ts),
// здесь только разметка. «Задачи x/y» — кнопка на вкладку задач, если она есть
// (требование владелицы: задачи спринта — за 2 касания).
import type { CSSProperties, ReactNode } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { kitT, type KitLang } from '../i18n';
import { StatusPill } from './fmt';
import { dueTone, recordFacts, tasksTone, type DueFact, type FactTone, type RecordFactsSpec, type TasksFact } from './facts';

export interface RecordFactsProps {
  record: KitRecord;
  ctx: KitCtx;
  spec: RecordFactsSpec;
  lang: KitLang;
  /** Открыть вкладку задач; нет — «задачи x/y» показывается текстом. */
  onTasks?: () => void;
  /** Последний пункт строки (S4-29): «получено N мин ↻». */
  tail?: ReactNode;
}

function Fact({ name, tone, children }: { name: string; tone: FactTone; children: ReactNode }) {
  const style = { '--fact-c': `var(--${tone})` } as CSSProperties;
  return <li className="sk-rec-facts__item" data-fact={name} data-tone={tone} style={style}>{children}</li>;
}

function tasksText(t: TasksFact, lang: KitLang): string {
  if (t.state === 'error') return kitT(lang, 'kit.record.facts.tasks.error');
  if (t.state === 'none') return kitT(lang, 'kit.record.facts.tasks.none');
  return kitT(lang, 'kit.record.facts.tasks', { done: t.done, total: t.total });
}

function dueText(d: DueFact, lang: KitLang): string {
  if (d.state === 'overdue') return kitT(lang, 'kit.record.facts.overdue', { days: d.days });
  if (d.state === 'today') return kitT(lang, 'kit.record.facts.dueToday');
  if (d.state === 'onTime') return kitT(lang, 'kit.record.facts.onTime', { days: d.days });
  return kitT(lang, 'kit.record.facts.noDue');
}

export function RecordFacts({ record, ctx, spec, lang, onTasks, tail }: RecordFactsProps) {
  const f = recordFacts(record, ctx, spec);
  const t = f.tasks;
  return (
    <section className="sk-rec-facts" data-testid="kit-facts" aria-label={kitT(lang, 'kit.record.facts')}>
      <ul className="sk-rec-facts__list">
        <Fact name="status" tone="t2">
          <StatusPill code={record.status} ctx={ctx} unknownTitle={kitT(lang, 'kit.record.status.unknown')} />
        </Fact>
        {t && (
          <Fact name="tasks" tone={tasksTone(t)}>
            {onTasks && t.state === 'ok' ? (
              <button type="button" className="sk-rec-facts__btn" onClick={onTasks}
                aria-label={kitT(lang, 'kit.record.facts.tasks.open', { done: t.done, total: t.total })}>
                {tasksText(t, lang)}
              </button>
            ) : (
              <span className="sk-rec-facts__text" title={t.state === 'error' ? t.reason : undefined}>{tasksText(t, lang)}</span>
            )}
          </Fact>
        )}
        {f.due && f.due.state !== 'closed' && (
          <Fact name="due" tone={dueTone(f.due)}>
            <span className="sk-rec-facts__text">{dueText(f.due, lang)}</span>
          </Fact>
        )}
        <Fact name="fresh" tone={f.fresh.state === 'ok' ? f.fresh.tone : 't3'}>
          {f.fresh.state === 'ok' && record.updated_at ? (
            <time className="sk-rec-facts__text" dateTime={record.updated_at} title={record.updated_at}>
              {f.fresh.days === 0
                ? kitT(lang, 'kit.record.facts.freshToday')
                : kitT(lang, 'kit.record.facts.fresh', { days: f.fresh.days })}
            </time>
          ) : (
            <span className="sk-rec-facts__text">{kitT(lang, 'kit.record.facts.freshUnknown')}</span>
          )}
        </Fact>
        {tail && <li className="sk-rec-facts__item sk-rec-facts__tail">{tail}</li>}
      </ul>
    </section>
  );
}
