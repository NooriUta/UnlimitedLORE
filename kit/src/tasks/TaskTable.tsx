// TaskTable (SPRINT_UXR_S5_RECORD_TASKS/S5-02): задачи спринта таблицей —
// атрибуты в строке (статус, id, заголовок, фаза, оценка, роли, тип), статус в
// 2 касания (звезда → пункт палитры), правка в строке, группировка по фазе /
// статусу / списком. Компонент не знает API: запись — колбэки экрана
// (onStatusChange → POST /lore/status, onSave → POST /lore/task/edit), отказ
// сервера рисуется в строке (role=alert), а не глотается.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { Pill } from '../elements/Pill';
import type { KitConfig, KitDictItem } from '../core/contract';
import { StatusStar } from '../elements/StatusStar';
import { statusMeta } from '../elements/statusMeta';
import { kitT, useKitLang, type KitKey, type KitLang } from '../i18n';
import { errorDetail } from '../states/loadState';
import {
  draftOf, groupTasks, TASK_GROUP_BYS, TASK_STATUSES, validateTaskDraft,
  type TaskDraft, type TaskGroup, type TaskGroupBy, type TaskPatch, type TaskPhase, type TaskRowData, type TaskStatus,
} from './taskGroups';

export interface TaskTableProps {
  tasks: readonly TaskRowData[];
  phases: readonly TaskPhase[];
  groupBy: TaskGroupBy;
  /** Смена группировки (состояние живёт в URL у экрана). Нет — переключателя нет. */
  onGroupByChange?: (by: TaskGroupBy) => void;
  /** Смена статуса. Нет — звезда только показывает статус. Отказ — throw. */
  onStatusChange?: (task: TaskRowData, status: TaskStatus) => Promise<void>;
  /** Сохранение правки в строке (только изменённые поля). Нет — правки нет. Отказ — throw. */
  onSave?: (task: TaskRowData, patch: TaskPatch) => Promise<void>;
  /** Адрес паспорта задачи — id становится ссылкой. */
  hrefFor?: (task: TaskRowData) => string;
  /** Имя таблицы (caption). */
  label: string;
  /**
   * Справочники LORE для строки задачи (S4-36): тип задачи рисуется иконкой,
   * класс работы — плашкой. Нет справочника — показываем исходные значения и
   * ничего о них не утверждаем: «словаря нет» и «значения нет в словаре» —
   * разные вещи, и путать их нельзя.
   */
  dict?: { taskType?: readonly KitDictItem[]; workClass?: readonly KitDictItem[] };
  /**
   * Статусы из конфигурации (S4-STATUS-AXIS-CONFIG). Есть — меню строится по
   * ним: подписи, иконки, цвета и разрешённые переходы `allow`. Нет —
   * умолчанием служит `TASK_STATUSES`.
   *
   * Это чинит найденное расхождение: раньше таблица читала захардкоженный
   * список, а паспорт — конфигурацию, и при переходе на модель они разошлись
   * бы молча.
   */
  statuses?: KitConfig['statuses']['items'];
  className?: string;
}

/** Имя статуса для чтения: известный — из локали, иначе «неизвестный «код»». */
export function taskStatusName(lang: KitLang, status: string | null | undefined): string {
  const code = statusMeta(status).code;
  if ((TASK_STATUSES as readonly string[]).includes(code)) return kitT(lang, `kit.tasks.status.${code}` as KitKey);
  const cat = statusMeta(status).category;
  if (cat !== 'unknown') return kitT(lang, `kit.tasks.cat.${cat}` as KitKey);
  return kitT(lang, 'kit.tasks.status.unknown', { code: code || '∅' });
}

function groupLabel(lang: KitLang, g: TaskGroup): string {
  switch (g.kind) {
    case 'phase': return g.label;
    case 'status': return kitT(lang, `kit.tasks.cat.${g.category ?? 'unknown'}` as KitKey);
    default: return kitT(lang, `kit.tasks.group.${g.kind}` as KitKey);
  }
}

const dash = '—';

interface MenuStatus { code: string; label: string; icon: string; color: string }

/**
 * Пункты меню смены статуса (S4-STATUS-AXIS-CONFIG).
 *
 * Конфигурация есть — читаем её: подписи, иконки, цвета и разрешённые
 * переходы. Нет — умолчанием служит `TASK_STATUSES`, чтобы kit оставался
 * работоспособным без модели (витрина, прототипы, другое приложение).
 *
 * Два правила, которые здесь важнее кода:
 *   • `allow` не задан — предлагаем ВСЕ: запрет не выдумываем, его решает
 *     сервер, а не интерфейс;
 *   • статус записи, которого нет в конфигурации, не прячем — он виден как
 *     есть. Спрятать значило бы скрыть сбой данных.
 */
function menuStatuses(
  items: KitConfig['statuses']['items'] | undefined,
  current: string,
  lang: KitLang,
): MenuStatus[] {
  if (!items || items.length === 0) {
    return TASK_STATUSES.map(code => {
      const m = statusMeta(code);
      return { code, label: kitT(lang, `kit.tasks.status.${code}` as KitKey), icon: m.icon, color: m.color };
    });
  }
  const cur = items.find(s => s.code === current);
  const allow = cur?.allow;
  const shown = allow && allow.length > 0
    ? items.filter(s => s.code === current || allow.includes(s.code))
    : items;
  const out: MenuStatus[] = shown.map(s => ({
    code: s.code,
    label: s.title,
    icon: s.icon || statusMeta(s.code).icon,
    color: s.color || statusMeta(s.code).color,
  }));
  if (current && !items.some(s => s.code === current)) {
    const m = statusMeta(current);
    out.unshift({ code: current, label: taskStatusName(lang, current), icon: m.icon, color: m.color });
  }
  return out;
}

/** Статья справочника по коду. Нет справочника или нет кода — undefined. */
function dictEntry(items: readonly KitDictItem[] | undefined, code: string | null): KitDictItem | undefined {
  if (!items || !code) return undefined;
  return items.find(i => i.code === code);
}

type CellProps = {
  code: string | null;
  items: readonly KitDictItem[] | undefined;
  t: (k: KitKey, v?: Record<string, string | number>) => string;
};

/**
 * Тип задачи (S4-36): иконка из справочника. Значения нет в справочнике —
 * печатаем исходный код и прямо говорим об этом; справочника нет вовсе —
 * печатаем код молча, судить не о чем.
 */
function TypeCell({ code, items, t }: CellProps) {
  if (!code) return <span className="sk-tasks__none">{dash}</span>;
  const item = dictEntry(items, code);
  if (item?.icon) return <GameIcon slug={item.icon} size={14} label={item.title} color={item.color} />;
  if (item) return <span className="sk-tasks__dict-raw" title={item.title}>{item.title}</span>;
  if (items) return <span className="sk-tasks__dict-raw" title={t('kit.tasks.dict.unknown', { code })}>{code}</span>;
  return <span className="sk-tasks__dict-raw">{code}</span>;
}

/** Класс работы (S4-36): плашка кодом, как в v1. Цвет — из справочника. */
function ClassCell({ code, items, t }: CellProps) {
  if (!code) return <span className="sk-tasks__none">{dash}</span>;
  const item = dictEntry(items, code);
  const text = code.toUpperCase();
  if (item) {
    const style = item.color ? ({ '--cls-c': item.color } as CSSProperties) : undefined;
    return <span className="sk-tasks__cls" title={item.title} style={style}>{text}</span>;
  }
  if (items) return <span className="sk-tasks__cls sk-tasks__cls--unknown" title={t('kit.tasks.dict.unknown', { code })}>{text}</span>;
  return <span className="sk-tasks__cls">{text}</span>;
}

export function TaskTable({ tasks, phases, groupBy, onGroupByChange, onStatusChange, onSave, hrefFor, label, dict, statuses, className }: TaskTableProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const groups = groupTasks(tasks, groupBy, phases);
  const showPhase = groupBy !== 'phase';
  const showGroupHeads = groupBy !== 'none';
  const phaseById = new Map(phases.map(p => [p.uid, p]));
  const fmt = new Intl.NumberFormat(lang === 'en' ? 'en' : 'ru', { maximumFractionDigits: 2 });

  // Порядок как в v1 (S4-36, эталон — скрин владелицы): статус, тип, класс
  // работы и код идут слева единым якорем, дальше название и всё остальное.
  const cols: { key: string; label: string }[] = [
    { key: 'status', label: t('kit.tasks.col.status') },
    { key: 'type', label: t('kit.tasks.col.type') },
    { key: 'cls', label: t('kit.tasks.col.class') },
    { key: 'id', label: t('kit.tasks.col.id') },
    { key: 'title', label: t('kit.tasks.col.title') },
    ...(showPhase ? [{ key: 'phase', label: t('kit.tasks.col.phase') }] : []),
    { key: 'effort', label: t('kit.tasks.col.effort') },
    { key: 'executor', label: t('kit.tasks.col.executor') },
    { key: 'reviewer', label: t('kit.tasks.col.reviewer') },
    ...(onSave ? [{ key: 'actions', label: t('kit.tasks.col.actions') }] : []),
  ];

  return (
    <div className={['sk-tasks', className].filter(Boolean).join(' ')}>
      {onGroupByChange && (
        <div className="sk-tasks__bar" role="group" aria-label={t('kit.tasks.groupBy')}>
          {TASK_GROUP_BYS.map(by => (
            <Pill key={by} variant="filter" pressed={by === groupBy} onToggle={() => { if (by !== groupBy) onGroupByChange(by); }}>
              {t(`kit.tasks.groupBy.${by}` as KitKey)}
            </Pill>
          ))}
        </div>
      )}
      <div className="sk-tasks__wrap">
        <table className="sk-tasks__table">
          <caption className="sk-sr">{label}</caption>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key} scope="col" className="sk-tasks__th">
                  {c.key === 'actions' ? <span className="sk-sr">{c.label}</span> : c.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(g => (
            <tbody key={g.key} data-group={g.kind}>
              {showGroupHeads && (
                <tr>
                  <th scope="rowgroup" colSpan={cols.length} className={`sk-tasks__gth${g.kind === 'orphan' ? ' sk-tasks__gth--fault' : ''}`}>
                    <span>{groupLabel(lang, g)}</span>
                    <span className="sk-tasks__gcount">{g.tasks.length}</span>
                  </th>
                </tr>
              )}
              {g.tasks.map(task => (
                <TaskRow
                  key={task.uid}
                  task={task}
                  lang={lang}
                  showPhase={showPhase}
                  phaseText={task.phase ? (phaseById.get(task.phase)?.id ?? task.phase) : null}
                  effortText={task.effortDays == null ? null : fmt.format(task.effortDays)}
                  colCount={cols.length}
                  dict={dict}
                  statuses={statuses}
                  onStatusChange={onStatusChange}
                  onSave={onSave}
                  href={hrefFor?.(task)}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  task: TaskRowData;
  lang: KitLang;
  showPhase: boolean;
  phaseText: string | null;
  effortText: string | null;
  colCount: number;
  dict?: TaskTableProps['dict'];
  statuses?: TaskTableProps['statuses'];
  onStatusChange?: TaskTableProps['onStatusChange'];
  onSave?: TaskTableProps['onSave'];
  href?: string;
}

function TaskRow({ task, lang, showPhase, phaseText, effortText, colCount, dict, statuses, onStatusChange, onSave, href }: RowProps) {
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [invalid, setInvalid] = useState<keyof TaskDraft | null>(null);
  const statusCell = useRef<HTMLTableCellElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  const statusName = taskStatusName(lang, task.status);
  const current = statusMeta(task.status).code;

  useEffect(() => {
    if (!menuOpen) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (draft) firstInput.current?.focus();
    // Фокус — только при открытии правки, не на каждый ввод.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft === null]);

  function closeMenu() {
    setMenuOpen(false);
    statusCell.current?.querySelector<HTMLButtonElement>('.sk-star--btn')?.focus();
  }

  async function pick(status: TaskStatus) {
    if (status === current) { closeMenu(); return; }
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      await onStatusChange?.(task, status);
    } catch (e) {
      setError(t('kit.tasks.statusFailed', { detail: errorDetail(e) || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    items[next]?.focus();
  }

  function startEdit() {
    setError(null);
    setInvalid(null);
    setDraft(draftOf(task));
  }

  function cancelEdit() {
    setDraft(null);
    setInvalid(null);
    setError(null);
  }

  async function save() {
    if (!draft || busy) return;
    const res = validateTaskDraft(task, draft);
    if (!res.ok) {
      setInvalid(res.field);
      setError(t(`kit.tasks.invalid.${res.field}` as KitKey));
      return;
    }
    setInvalid(null);
    if (Object.keys(res.patch).length === 0) { cancelEdit(); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave?.(task, res.patch);
      setDraft(null);
    } catch (e) {
      setError(t('kit.tasks.saveFailed', { detail: errorDetail(e) || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter') { e.preventDefault(); void save(); }
  }

  const errId = `sk-tasks-err-${task.uid}`;
  const input = (field: keyof TaskDraft, colLabel: KitKey, ref?: Ref<HTMLInputElement>, numeric?: boolean) => (
    <input
      ref={ref}
      className="sk-tasks__input"
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      aria-label={t(colLabel)}
      aria-invalid={invalid === field ? true : undefined}
      aria-describedby={error ? errId : undefined}
      value={draft?.[field] ?? ''}
      disabled={busy}
      onChange={e => { const v = e.target.value; setDraft(d => (d ? { ...d, [field]: v } : d)); }}
      onKeyDown={onInputKey}
    />
  );
  const val = (v: string | null) => (v == null || v === '' ? <span className="sk-tasks__none">{dash}</span> : v);

  return (
    <>
      <tr className={`sk-tasks__row${draft ? ' is-editing' : ''}${busy ? ' is-busy' : ''}`} data-task={task.id} aria-busy={busy || undefined}>
        <td ref={statusCell} className="sk-tasks__td sk-tasks__td--status">
          <StatusStar
            status={task.status}
            label={t('kit.tasks.statusLabel', { name: statusName.toLowerCase() })}
            onOpen={onStatusChange && !busy ? () => setMenuOpen(o => !o) : undefined}
            expanded={onStatusChange ? menuOpen : undefined}
          />
          {menuOpen && (
            <div
              ref={menuRef}
              className="sk-tasks__menu"
              role="menu"
              aria-label={t('kit.tasks.statusMenu', { id: task.id })}
              onKeyDown={onMenuKey}
              onBlur={e => {
                // Фокус ушёл за пределы палитры (клик мимо, Tab) — палитра закрывается.
                const next = e.relatedTarget as Node | null;
                // Звезда в той же ячейке закрывает палитру сама (переключатель).
                if (!next || !statusCell.current?.contains(next)) setMenuOpen(false);
              }}
            >
              {menuStatuses(statuses, current, lang).map(s => (
                <button
                  key={s.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.code === current}
                  tabIndex={-1}
                  className="sk-tasks__menu-item"
                  data-status={s.code}
                  onClick={() => void pick(s.code)}
                >
                  <GameIcon slug={s.icon} size={14} color={s.color} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </td>
        <td className="sk-tasks__td sk-tasks__td--type">
          <TypeCell code={task.taskType} items={dict?.taskType} t={t} />
        </td>
        <td className="sk-tasks__td sk-tasks__td--cls">
          <ClassCell code={task.workClass} items={dict?.workClass} t={t} />
        </td>
        <td className="sk-tasks__td">
          {href ? <a className="sk-tasks__id" href={href}>{task.id}</a> : <span className="sk-tasks__id">{task.id}</span>}
        </td>
        <td className="sk-tasks__td sk-tasks__td--title">
          {draft ? input('title', 'kit.tasks.col.title', firstInput) : val(task.title)}
        </td>
        {showPhase && <td className="sk-tasks__td">{val(phaseText)}</td>}
        <td className="sk-tasks__td sk-tasks__td--effort">
          {draft ? input('effort', 'kit.tasks.col.effort', undefined, true) : val(effortText)}
        </td>
        <td className="sk-tasks__td">
          {draft ? input('executor', 'kit.tasks.col.executor') : val(task.executor)}
        </td>
        <td className="sk-tasks__td">
          {draft ? input('reviewer', 'kit.tasks.col.reviewer') : val(task.reviewer)}
        </td>
        {onSave && (
          <td className="sk-tasks__td sk-tasks__td--actions">
            {draft ? (
              <span className="sk-tasks__actions">
                <button type="button" className="sk-btn" disabled={busy} onClick={() => void save()}>{t('kit.tasks.save')}</button>
                <button type="button" className="sk-btn sk-tasks__btn--ghost" disabled={busy} onClick={cancelEdit}>{t('kit.tasks.cancel')}</button>
              </span>
            ) : (
              <button
                type="button"
                className="sk-btn sk-tasks__btn--ghost"
                aria-label={t('kit.tasks.edit', { id: task.id })}
                title={t('kit.tasks.edit', { id: task.id })}
                disabled={busy}
                onClick={startEdit}
              >
                <span aria-hidden="true">✎</span>
              </button>
            )}
          </td>
        )}
      </tr>
      {error && (
        <tr>
          <td colSpan={colCount} className="sk-tasks__err"><div id={errId} role="alert">{error}</div></td>
        </tr>
      )}
    </>
  );
}
