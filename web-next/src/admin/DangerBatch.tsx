// Опасное действие над ролями человека (SPRINT_UXR_S7B_ADMIN/S7B-03).
//
// Путь один для любой правки ролей — одной ячейки, отмеченных проектов или
// «всей строки» матрицы (правило A прототипа s7b-admin-v6):
//   1. дифф «было → станет» — сервер считает его сам (dry_run), ничего не пишет;
//   2. ввод логина человека — не «ОК»: кнопка применения занята, пока логин
//      не введён точно (поле — confirm у kit DiffPreview, S7B-25: тот же
//      паттерн, что у KcDanger, а не своё поле рядом);
//   3. применение одной пачкой (batch_id) — итог по каждому проекту, пачка не
//      атомарна, и частичный отказ назван числами и причинами;
//   4. «Отменить» — вся пачка одним вызовом (undo_of), пока открыто окно;
//   5. запись в журнале — ссылка на ту же пачку в «Журнале действий».
//
// Элементы — kit2: DiffPreview (дифф с проверкой у каждой строки) и BatchUndo
// (окно отмены с остатком). Здесь — только что за изменения и куда их слать.
import { useEffect, useMemo, useState } from 'react';
import { BatchUndo, DiffPreview, Forbidden, LoadError, Skeleton, useKitLang, type DiffRow } from '@seidr/kit';
import { useAdminNav } from './adminNav';
import { useAppT } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  parseApply, parsePlan, planToDiff, postRoleBatch, type ApplyAnswer, type RoleChange,
} from './roles';

export interface DangerBatchProps {
  person: { kc_sub: string; name: string };
  changes: readonly RoleChange[];
  fetchImpl?: typeof fetch;
  onClose: () => void;
  /**
   * Пачка применена или отменена — матрицу пора перечитать. Что именно —
   * аргументом (S7B-29): мастеру «подключить человека» это не одно и то же —
   * после отмены ролей у человека нет, и идти «дальше» нельзя.
   */
  onChanged?: (what: 'applied' | 'undone') => void;
  /**
   * Откат прошлой пачки из журнала (S7B-13): тот же путь, но с undo_of —
   * сервер проверяет окно и в диффе, и при применении. display_name при
   * этом не уходит: имени человека журнал не знает, и затирать его kc_sub-ом нельзя.
   */
  undoOf?: string;
}

type PlanState =
  | { kind: 'loading' }
  | { kind: 'ok'; rows: DiffRow[] }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'bad'; reason: string }
  | { kind: 'error'; error: unknown };

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

export function DangerBatch({ person, changes, fetchImpl, onClose, onChanged, undoOf }: DangerBatchProps) {
  const t = useAppT();
  const nav = useAdminNav();
  const lang = useKitLang();
  const [plan, setPlan] = useState<PlanState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ApplyAnswer | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const key = useMemo(() => JSON.stringify(changes), [changes]);
  /** Кто и чем: правка из «Ролей» несёт имя, откат из журнала — undo_of без имени. */
  const who = undoOf
    ? { kc_sub: person.kc_sub, undo_of: undoOf }
    : { kc_sub: person.kc_sub, display_name: person.name };

  useEffect(() => {
    let alive = true;
    setPlan({ kind: 'loading' });
    setAnswer(null);
    setApplyError(null);
    setUndone(false);
    setUndoError(null);
    postRoleBatch({ ...who, changes, dry_run: true }, fetchImpl).then(
      body => {
        if (alive) setPlan({ kind: 'ok', rows: planToDiff(parsePlan(body), { before: t('admin.roles.diff.before'), none: t('admin.roles.diff.none') }) });
      },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)) setPlan({ kind: 'forbidden', reason: reasonOf(e) });
        else if (e instanceof LoreHttpError && e.status === 400) setPlan({ kind: 'bad', reason: reasonOf(e) });
        else setPlan({ kind: 'error', error: e });
      },
    );
    return () => { alive = false; };
  }, [key, person.kc_sub, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (rows: readonly DiffRow[]) => {
    // Слово проверил kit DiffPreview: без точного логина onApply не зовётся.
    if (applying) return;
    // В пачку уходят ТОЛЬКО применимые строки (проверенные и меняющие) — их и отдал дифф.
    const ids = new Set(rows.map(r => r.id));
    const send = changes.filter(c => ids.has(c.project));
    setApplying(true);
    setApplyError(null);
    postRoleBatch({ ...who, changes: send }, fetchImpl).then(
      body => { setAnswer(parseApply(body)); setApplying(false); onChanged?.('applied'); },
      (e: unknown) => { setApplyError(reasonOf(e)); setApplying(false); },
    );
  };

  const undo = (id: string) => {
    if (!answer || undoing) return;
    setUndoing(true);
    setUndoError(null);
    postRoleBatch({ ...who, changes: answer.undo, undo_of: id }, fetchImpl).then(
      () => { setUndone(true); setUndoing(false); onChanged?.('undone'); },
      (e: unknown) => { setUndoError(t('admin.roles.undoFailed', { reason: reasonOf(e) })); setUndoing(false); },
    );
  };

  // S7B-01: в модуле оболочки переход в журнал — навигацией оболочки (useAdminNav).
  const toJournal = (id: string) => nav.go('log', { 'adm-batch': id });

  return (
    <section className="adm-danger" aria-labelledby="adm-danger-h" data-testid="adm-danger">
      <h3 id="adm-danger-h" className="adm-danger__h">{t('admin.roles.danger.title', { name: person.name })}</h3>
      {plan.kind === 'loading' && <Skeleton lines={3} label={t('admin.roles.danger.loading')} />}
      {plan.kind === 'forbidden' && (
        <div data-testid="adm-danger-forbidden">
          <Forbidden title={t('admin.roles.danger.forbidden')} hint={t('admin.roles.forbiddenHint')} reason={plan.reason} />
        </div>
      )}
      {plan.kind === 'bad' && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-danger-bad">
          {t('admin.roles.danger.bad', { reason: plan.reason })}
        </p>
      )}
      {plan.kind === 'error' && <LoadError error={plan.error} onRetry={() => setAttempt(a => a + 1)} />}
      {plan.kind === 'ok' && !answer && (
        <>
          {/* key: новая пачка — новое поле слова; введённое для прежней не переезжает. */}
          <DiffPreview key={`${key}|${attempt}`} rows={plan.rows} onApply={apply} busy={applying}
            label={t('admin.roles.danger.diff')} lang={lang}
            confirm={{ word: person.name, label: t('admin.roles.danger.confirm', { name: person.name }) }} />
          {applyError && (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-danger-applyerror">
              {t('admin.roles.danger.applyError', { reason: applyError })}
            </p>
          )}
        </>
      )}
      {answer && (
        <>
          <BatchUndo batch={answer.batch} onUndo={undo} undoing={undoing} undone={undone} undoError={undoError} lang={lang} />
          {answer.batch.id && (
            <p className="adm-sub">
              {t('admin.roles.danger.logged')}{' '}
              <button type="button" className="adm-link" data-testid="adm-danger-journal" onClick={() => toJournal(answer.batch.id)}>
                {t('admin.roles.danger.journal')}
              </button>
              <span className="adm-mono"> {answer.batch.id}</span>
            </p>
          )}
        </>
      )}
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-danger-cancel" onClick={onClose}>
          {answer ? t('admin.roles.danger.done') : t('admin.roles.danger.cancel')}
        </button>
      </div>
    </section>
  );
}
