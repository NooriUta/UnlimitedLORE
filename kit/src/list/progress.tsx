// Прогресс «x/y» составного объекта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09):
// колонка списка `progress:<поле>` читает fields[<поле>] и показывает «x/y» —
// у спринта это «задачи готово/всего». Общий механизм kit: что считать, решает
// приложение, kit только честно рисует исход.
//
// Честность: «не посчитали» (ошибка), «ещё считаем» и «значения нет» —
// отдельные исходы, ни один не выдаёт себя за 0/0. Неполный подсчёт (часть
// данных не пришла) — x/y с пометкой, а не как полный.
import type { CSSProperties } from 'react';
import { kitT, useKitLang } from '../i18n';

/** Значение поля прогресса, которое кладёт приложение в fields[<поле>]. */
export type KitProgressInput =
  | { done: number; total: number; partial?: boolean }
  | { error: string }
  | { loading: true };

export type ProgressValue =
  | { kind: 'ok' | 'complete' | 'empty' | 'partial'; done: number; total: number }
  | { kind: 'error'; reason: string }
  | { kind: 'loading' }
  | { kind: 'none' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function progressOf(v: unknown): ProgressValue {
  if (!v || typeof v !== 'object') return { kind: 'none' };
  const o = v as Record<string, unknown>;
  if (typeof o.error === 'string') return { kind: 'error', reason: o.error };
  if (o.loading === true) return { kind: 'loading' };
  if (!isNum(o.done) || !isNum(o.total)) return { kind: 'none' };
  const done = o.done;
  const total = o.total;
  if (o.partial === true) return { kind: 'partial', done, total };
  if (total === 0) return { kind: 'empty', done, total };
  return { kind: done >= total ? 'complete' : 'ok', done, total };
}

export function ProgressCell({ value }: { value: unknown }) {
  const lang = useKitLang();
  const p = progressOf(value);
  if (p.kind === 'error') {
    const label = kitT(lang, 'kit.progress.error', { reason: p.reason });
    return <span className="sk-progress" data-progress="error" role="img" aria-label={label} title={label}>?</span>;
  }
  if (p.kind === 'loading') {
    const label = kitT(lang, 'kit.progress.loading');
    return <span className="sk-progress" data-progress="loading" role="img" aria-label={label} title={label}>…</span>;
  }
  if (p.kind === 'none') {
    const label = kitT(lang, 'kit.progress.none');
    return <span className="sk-progress" data-progress="none" role="img" aria-label={label} title={label}>—</span>;
  }
  const label = kitT(lang, p.kind === 'partial' ? 'kit.progress.partial' : 'kit.progress.label', { done: p.done, total: p.total });
  const pct = p.total > 0 ? Math.min(100, Math.round((100 * p.done) / p.total)) : 0;
  return (
    <span className="sk-progress" data-progress={p.kind} role="img" aria-label={label} title={label}>
      <span className="sk-progress__text" aria-hidden="true">{p.done}/{p.total}{p.kind === 'partial' ? '*' : ''}</span>
      <span className="sk-progress__bar" aria-hidden="true" style={{ '--p': `${pct}%` } as CSSProperties} />
    </span>
  );
}
