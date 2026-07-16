// Open-questions register (KnowQuestion, ADR-LORE-020/021) — flat scrollable
// feed, sibling to LoreDecisionBoard. "What we haven't answered yet" vs the
// decisions board's "what rule". Client-side filter/sort (data is small).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import { fetchLoreSlice, loreMutate, type LoreQuestionRow } from '../../api/lore';
import LoreSkeleton from './LoreSkeleton';
import { FilterBar, Chip, type FilterTagData } from './FilterPrimitives';
import { LoreLinkChips, type LinkMeta } from './LoreLinkChips';

// Editable fields — question is vertex-only, so a single upsert POST /lore/question
// (partial-safe) covers both create and edit. status='deferred' requires trigger.
interface QForm {
  question_id: string; title: string; body_md: string; component_id: string;
  status: string; priority: string; due_date: string; owner: string; raised_in: string;
}
const EMPTY_FORM: QForm = { question_id: '', title: '', body_md: '', component_id: '', status: 'open', priority: '', due_date: '', owner: '', raised_in: '' };

interface Props {
  q: string;
  onError: (e: unknown) => void;
  /** Navigate to the ADR where the question was raised (RAISED_IN). */
  onNavigateAdr?: (adrId: string) => void;
}

// status = plain vertex field; overdue is derived (open ∧ due_date < today).
const STATUS_META: Record<string, { label: string; color: string }> = {
  open:     { label: 'открыт',   color: 'var(--inf)' },
  deferred: { label: 'отложен',  color: 'var(--wrn)' },
  closed:   { label: 'закрыт',   color: 'var(--suc)' },
  dropped:  { label: 'снят',     color: 'var(--t3)'  },
};
const STATUS_ORDER = ['open', 'deferred', 'closed', 'dropped'];
const PRIORITY_META: Record<string, { label: string; color: string }> = {
  blocker: { label: 'blocker', color: 'var(--err)' },
  high:    { label: 'high',    color: 'var(--wrn)' },
  normal:  { label: 'normal',  color: 'var(--t2)'  },
  low:     { label: 'low',     color: 'var(--t3)'  },
};
const PRIORITY_ORDER = ['blocker', 'high', 'normal', 'low'];

const todayISO = () => new Date().toISOString().slice(0, 10);
// Exported for unit test. Overdue is derived, never stored (ADR-021 §SCD2).
export const isOverdue = (r: Pick<LoreQuestionRow, 'status' | 'due_date'>, today = todayISO()): boolean =>
  r.status === 'open' && !!r.due_date && r.due_date.slice(0, 10) < today;
const first = (a: (string | null)[] | null | undefined): string | null =>
  (a ?? []).find(Boolean) ?? null;
const gatingCount = (r: LoreQuestionRow) => (r.gating_tasks ?? []).filter(Boolean).length;

export default function LoreOpenQuestionsBoard({ q, onError, onNavigateAdr }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]       = useState<LoreQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy]   = useState<'due' | 'id' | 'opened'>('due');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusSel, setStatusSel]   = useState<Set<string>>(new Set(['open', 'deferred']));
  const [prioSel, setPrioSel]       = useState<Set<string>>(new Set());
  const [compSel, setCompSel]       = useState<Set<string>>(new Set());
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyGating, setOnlyGating]   = useState(false);
  // Editing: editId is a question_id, or '__new__' for the create form, or null.
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState<QForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // All component ids for the form's «Компонент» binding (datalist).
  const [compIds, setCompIds] = useState<string[]>([]);
  // T43: component icon/area/name meta for the module-style picker (as in Спринты).
  const [compMeta, setCompMeta] = useState<Record<string, LinkMeta>>({});
  // T43: all git-project slugs for the multi-project picker.
  const [projectIds, setProjectIds] = useState<string[]>([]);
  // T43: project filter selection.
  const [projSel, setProjSel] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    fetchLoreSlice<LoreQuestionRow>('open_questions')
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
  }, [onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchLoreSlice<{ component_id: string; game_icon: string | null; area: string | null; full_name: string | null }>('components', {})
      .then(cs => {
        setCompIds(cs.map(c => c.component_id).filter(Boolean).sort());
        const m: Record<string, LinkMeta> = {};
        cs.forEach(c => { if (c.component_id) m[c.component_id] = { game_icon: c.game_icon, area: c.area, full_name: c.full_name }; });
        setCompMeta(m);
      })
      .catch(() => { /* picker degrades to plain */ });
    fetchLoreSlice<{ slug: string }>('git_projects', {})
      .then(ps => setProjectIds(ps.map(p => p.slug).filter(Boolean).sort()))
      .catch(() => { /* project picker degrades to free text */ });
  }, []);

  // T43: add/remove a component or project link on a question (multi, via edges).
  async function linkQuestion(question_id: string, rel: 'component' | 'project', value: string, action: 'add' | 'remove') {
    try {
      const body = rel === 'component'
        ? { question_id, component_id: value, action }
        : { question_id, project: value, action };
      await loreMutate(`/question/${rel}`, body);
      load();
    } catch (e) { onError(e); }
  }

  function startNew() { setForm({ ...EMPTY_FORM, question_id: '' }); setEditId('__new__'); }
  function startEdit(r: LoreQuestionRow) {
    setForm({
      question_id: r.question_id, title: r.title ?? '', body_md: '', component_id: r.component_id ?? '',
      status: r.status ?? 'open', priority: r.priority ?? '', due_date: (r.due_date ?? '').slice(0, 10),
      owner: r.owner ?? '', raised_in: (r.raised_adr ?? []).filter(Boolean)[0] ?? '',
    });
    setEditId(r.question_id);
  }
  function cancel() { setEditId(null); setForm(EMPTY_FORM); }

  async function save() {
    const f = form;
    if (!f.question_id.trim() || !f.title.trim()) { onError(new Error('question_id и title обязательны')); return; }
    setSaving(true);
    try {
      // Upsert (partial-safe). status='deferred' needs a trigger — the form omits
      // deferred to avoid the backend trigger requirement; use the row's ⏸ later.
      // raised_in — НЕ поле /lore/question (бэкенд отвергал весь payload 400);
      // это ребро — шлём отдельным вызовом ниже. status='closed' ставится только
      // через ANSWERS — не отправляем его вовсе (инвариант бэкенда).
      await loreMutate('/question', {
        question_id: f.question_id.trim(), title: f.title.trim(),
        body_md: f.body_md.trim() || null, component_id: f.component_id.trim() || null,
        status: f.status === 'open' || f.status === 'dropped' ? f.status : null, priority: f.priority || null,
        due_date: f.due_date || null, owner: f.owner.trim() || null,
      });
      if (f.raised_in.trim()) {
        await loreMutate('/question/raised_in', {
          question_id: f.question_id.trim(), target_type: 'adr', target_id: f.raised_in.trim(), action: 'add',
        });
      }
      cancel(); load();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { const s = r.status ?? 'open'; m[s] = (m[s] || 0) + 1; });
    return m;
  }, [rows]);
  const prioCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { if (r.priority) m[r.priority] = (m[r.priority] || 0) + 1; });
    return m;
  }, [rows]);
  const compCounts = useMemo(() => {
    const m: Record<string, number> = {};
    // T43: count over multi-components (edges), falling back to the single field.
    rows.forEach(r => {
      const cs = (r.components ?? []).filter(Boolean) as string[];
      const list = cs.length ? cs : (r.component_id ? [r.component_id] : []);
      list.forEach(c => { m[c] = (m[c] || 0) + 1; });
    });
    return m;
  }, [rows]);
  const projCounts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => (r.projects ?? []).filter(Boolean).forEach(p => { m[p as string] = (m[p as string] || 0) + 1; }));
    return m;
  }, [rows]);
  const allProjects = Object.keys(projCounts).sort((a, b) => (projCounts[b] - projCounts[a]) || a.localeCompare(b));
  const overdueCount = useMemo(() => rows.filter(r => isOverdue(r)).length, [rows]);
  const gatingTotal  = useMemo(() => rows.filter(r => gatingCount(r) > 0).length, [rows]);

  const allStatuses = STATUS_ORDER.filter(s => statusCounts[s]);
  const allPrios    = PRIORITY_ORDER.filter(p => prioCounts[p]);
  const allComps    = Object.keys(compCounts).sort((a, b) => (compCounts[b] - compCounts[a]) || a.localeCompare(b));

  const filtered = useMemo(() => rows
    .filter(r => !q
      || (r.title ?? '').toLowerCase().includes(q.toLowerCase())
      || r.question_id.toLowerCase().includes(q.toLowerCase()))
    .filter(r => statusSel.size === 0 || statusSel.has(r.status ?? 'open'))
    .filter(r => prioSel.size === 0 || (r.priority != null && prioSel.has(r.priority)))
    .filter(r => {
      if (compSel.size === 0) return true;
      const cs = (r.components ?? []).filter(Boolean) as string[];
      const list = cs.length ? cs : (r.component_id ? [r.component_id] : []);
      return list.some(c => compSel.has(c));
    })
    .filter(r => projSel.size === 0 || (r.projects ?? []).some(p => p != null && projSel.has(p as string)))
    .filter(r => !onlyOverdue || isOverdue(r, todayISO()))
    .filter(r => !onlyGating || gatingCount(r) > 0),
  [rows, q, [...statusSel].sort().join(','), [...prioSel].sort().join(','), [...compSel].sort().join(','), [...projSel].sort().join(','), onlyOverdue, onlyGating]);

  const display = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'id') return dir * a.question_id.localeCompare(b.question_id, undefined, { numeric: true });
      if (sortBy === 'opened') return dir * (a.opened_date ?? '').localeCompare(b.opened_date ?? '');
      // due: nulls always last regardless of dir
      const ad = a.due_date, bd = b.due_date;
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return dir * ad.localeCompare(bd);
    });
  }, [filtered, sortBy, sortDir]);

  function toggle<T>(set: Set<T>, setFn: (s: Set<T>) => void, v: T) {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setFn(n);
  }

  if (loading) return <LoreSkeleton />;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.count}>{t('lore.oqBoard.count', '{{count}} вопросов', { count: filtered.length })}</span>
        {overdueCount > 0 && (
          <span style={S.overdueBadge}>{t('lore.oqBoard.overdue', '{{n}} просрочено', { n: overdueCount })}</span>
        )}
        {q && <span style={S.filterNote}>{t('lore.oqBoard.filterNote', 'фильтр: «{{q}}»', { q })}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <button style={S.newBtn} onClick={() => (editId === '__new__' ? cancel() : startNew())}>
            {t('lore.oqBoard.newButton', '+ вопрос')}
          </button>
          <div style={S.pillGroup}>
            {(['due', 'id', 'opened'] as const).map((k, i, arr) => (
              <button key={k}
                onClick={() => { if (sortBy === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(k); setSortDir(k === 'opened' ? 'desc' : 'asc'); } }}
                style={{ ...S.ctrl, ...(sortBy === k ? S.ctrlActive : {}),
                  borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0,
                  borderRight: i === arr.length - 1 ? undefined : 'none' }}>
                {t('lore.oqBoard.sort.' + k, k === 'due' ? 'срок' : k === 'id' ? 'ID' : 'создан')} {sortBy === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      <FilterBar
        tier="local"
        label={t('lore.oqBoard.filtersLabel', 'Фильтры')}
        activeCount={statusSel.size + prioSel.size + compSel.size + projSel.size + (onlyOverdue ? 1 : 0) + (onlyGating ? 1 : 0)}
        summaryTags={[
          ...[...projSel].map((p): FilterTagData => ({
            key: 'pj:' + p, label: p, color: 'var(--suc)', onRemove: () => toggle(projSel, setProjSel, p),
          })),
          ...[...statusSel].map((s): FilterTagData => ({
            key: 'st:' + s, label: STATUS_META[s]?.label ?? s, color: STATUS_META[s]?.color,
            onRemove: () => toggle(statusSel, setStatusSel, s),
          })),
          ...[...prioSel].map((p): FilterTagData => ({
            key: 'pr:' + p, label: PRIORITY_META[p]?.label ?? p, color: PRIORITY_META[p]?.color,
            onRemove: () => toggle(prioSel, setPrioSel, p),
          })),
          ...[...compSel].map((c): FilterTagData => ({
            key: 'co:' + c, label: c, onRemove: () => toggle(compSel, setCompSel, c),
          })),
          ...(onlyOverdue ? [{ key: 'ov', label: t('lore.oqBoard.overdueTag', 'просрочен'), color: 'var(--err)', onRemove: () => setOnlyOverdue(false) } as FilterTagData] : []),
          ...(onlyGating ? [{ key: 'ga', label: t('lore.oqBoard.gatingTag', 'блокирует'), onRemove: () => setOnlyGating(false) } as FilterTagData] : []),
        ]}
        onClear={() => { setStatusSel(new Set()); setPrioSel(new Set()); setCompSel(new Set()); setProjSel(new Set()); setOnlyOverdue(false); setOnlyGating(false); }}
        open={filterOpen}
        onToggleOpen={() => setFilterOpen(v => !v)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={S.dimRow}>
            <span style={S.dimLbl}>{t('lore.oqBoard.statusLabel', 'Статус')}</span>
            {allStatuses.map(s => (
              <Chip key={s} label={STATUS_META[s]?.label ?? s} pressed={statusSel.has(s)}
                onClick={() => toggle(statusSel, setStatusSel, s)} count={statusCounts[s]}
                color={STATUS_META[s]?.color} dot />
            ))}
          </div>
          {allPrios.length > 0 && (
            <div style={S.dimRow}>
              <span style={S.dimLbl}>{t('lore.oqBoard.priorityLabel', 'Приоритет')}</span>
              {allPrios.map(p => (
                <Chip key={p} label={PRIORITY_META[p]?.label ?? p} pressed={prioSel.has(p)}
                  onClick={() => toggle(prioSel, setPrioSel, p)} count={prioCounts[p]}
                  color={PRIORITY_META[p]?.color} dot />
              ))}
            </div>
          )}
          {allComps.length > 0 && (
            <div style={S.dimRow}>
              <span style={S.dimLbl}>{t('lore.oqBoard.componentLabel', 'Компонент')}</span>
              {allComps.map(c => (
                <Chip key={c} label={c} pressed={compSel.has(c)}
                  onClick={() => toggle(compSel, setCompSel, c)} count={compCounts[c]} dot />
              ))}
            </div>
          )}
          {allProjects.length > 0 && (
            <div style={S.dimRow}>
              <span style={S.dimLbl}>{t('lore.oqBoard.projectLabel', 'Проект')}</span>
              {allProjects.map(p => (
                <Chip key={p} label={p} pressed={projSel.has(p)}
                  onClick={() => toggle(projSel, setProjSel, p)} count={projCounts[p]} color="var(--suc)" dot />
              ))}
            </div>
          )}
          <div style={S.dimRow}>
            <span style={S.dimLbl}>{t('lore.oqBoard.flagsLabel', 'Признак')}</span>
            <Chip label={t('lore.oqBoard.overdueTag', 'просрочен')} pressed={onlyOverdue}
              onClick={() => setOnlyOverdue(v => !v)} count={overdueCount} color="var(--err)" />
            <Chip label={t('lore.oqBoard.gatingTag', 'блокирует')} pressed={onlyGating}
              onClick={() => setOnlyGating(v => !v)} count={gatingTotal} />
          </div>
        </div>
      </FilterBar>

      {editId !== null && (
        <div style={S.formPanel}>
          <div style={S.formTitle}>
            {editId === '__new__' ? t('lore.oqBoard.formNew', 'Новый вопрос') : t('lore.oqBoard.formEdit', 'Правка {{id}}', { id: editId })}
          </div>
          <div style={S.formGrid}>
            {editId === '__new__' && (
              <input style={S.input} placeholder="ID (Q-M1, OQ7, …)" value={form.question_id}
                onChange={e => setForm(f => ({ ...f, question_id: e.target.value }))} />
            )}
            <input style={{ ...S.input, gridColumn: '1 / -1' }} placeholder="Заголовок вопроса" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea style={{ ...S.input, gridColumn: '1 / -1', minHeight: 44, resize: 'vertical' as const }}
              placeholder="Контекст / критерий закрытия (опц.)" value={form.body_md}
              onChange={e => setForm(f => ({ ...f, body_md: e.target.value }))} />
            <input style={S.input} placeholder={t('lore.oqBoard.componentPick', 'Компонент — выбор из списка')}
              list="lore-qform-comps" value={form.component_id}
              onChange={e => setForm(f => ({ ...f, component_id: e.target.value }))} />
            <datalist id="lore-qform-comps">
              {compIds.map(c => <option key={c} value={c} />)}
            </datalist>
            {/* T43: multi component + multi project (edges) — for an existing question. */}
            {editId !== '__new__' && (() => {
              const er = rows.find(r => r.question_id === editId);
              const comps = (er?.components ?? []).filter(Boolean) as string[];
              const projs = (er?.projects ?? []).filter(Boolean) as string[];
              return (
                <>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <LoreLinkChips label={t('lore.oqBoard.componentsMulti', 'Компоненты')} meta={compMeta}
                      values={comps} options={compIds}
                      onAdd={v => linkQuestion(editId!, 'component', v, 'add')}
                      onRemove={v => linkQuestion(editId!, 'component', v, 'remove')} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <LoreLinkChips label={t('lore.oqBoard.projectsMulti', 'Проекты')} color="var(--suc)"
                      values={projs} options={projectIds}
                      onAdd={v => linkQuestion(editId!, 'project', v, 'add')}
                      onRemove={v => linkQuestion(editId!, 'project', v, 'remove')} />
                  </div>
                </>
              );
            })()}
            <select style={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {/* closed ставится ТОЛЬКО через ANSWERS (инвариант) — в селекте его нет;
                  для уже закрытого вопроса показываем disabled-опцию, чтобы селект не врал. */}
              {(form.status === 'closed' || form.status === 'deferred') && (
                <option value={form.status} disabled>{STATUS_META[form.status]?.label ?? form.status}</option>
              )}
              {['open', 'dropped'].map(s => <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>)}
            </select>
            <select style={S.input} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="">— приоритет —</option>
              {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
            <input style={S.input} type="date" value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            <input style={S.input} placeholder="Владелец (owner)" value={form.owner}
              onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
            <input style={S.input} placeholder="Поставлен в ADR (raised_in)" value={form.raised_in}
              onChange={e => setForm(f => ({ ...f, raised_in: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button style={S.saveBtn} disabled={saving} onClick={save}>{saving ? '…' : t('lore.oqBoard.save', 'Сохранить')}</button>
            <button style={S.cancelBtn} onClick={cancel}>{t('lore.oqBoard.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}
      <div style={S.list}>
        {display.length === 0 && <div style={S.empty}>{t('lore.oqBoard.none', 'Вопросов не найдено.')}</div>}
        {display.map(r => {
          const st = r.status ?? 'open';
          const meta = STATUS_META[st] ?? { label: st, color: 'var(--t3)' };
          const overdue = isOverdue(r);
          const gate = gatingCount(r);
          const adr = first(r.raised_adr);
          const ans = (r.answered_by ?? []).filter(Boolean);
          return (
            <div key={r.question_id} style={S.row}>
              {/* открыт = полое кольцо, закрыт/прочие = сплошная точка — цвета suc/inf в amber-палитре сливаются, форма разводит */}
              <span style={{ ...S.statusDot(meta.color), ...(st === 'open' ? { background: 'transparent', border: `2px solid ${meta.color}`, boxSizing: 'border-box' as const } : {}) }} title={meta.label} />
              <span style={S.qid}>{r.question_id}</span>
              <div style={S.body}>
                <span style={S.title}>{r.title ?? r.question_id}</span>
              </div>
              {r.priority && (
                <span style={S.prioChip(PRIORITY_META[r.priority]?.color ?? 'var(--t3)')}>
                  {PRIORITY_META[r.priority]?.label ?? r.priority}
                </span>
              )}
              {gate > 0 && <span style={S.gateChip} title={t('lore.oqBoard.gatesTitle', 'блокирует задач: {{n}}', { n: gate })}>⛔ {gate}</span>}
              {(((r.components ?? []).filter(Boolean).length ? (r.components as string[]).filter(Boolean) : (r.component_id ? [r.component_id] : []))).map(c => (
                <span key={'c' + c} style={S.compChip}>{c}</span>
              ))}
              {(r.projects ?? []).filter(Boolean).map(p => (
                <span key={'p' + p} style={S.projChip}>{p as string}</span>
              ))}
              {adr && (
                onNavigateAdr
                  ? <span style={S.adrLink} title={adr}
                      {...a11yClick(() => onNavigateAdr(adr))}>{adr}</span>
                  : <span style={S.adrChip} title={adr}>{adr}</span>
              )}
              {st === 'closed' && ans.length > 0 && (
                <span style={S.ansChip} title={t('lore.oqBoard.answeredTitle', 'закрыт решением')}>← #{ans.join(', #')}</span>
              )}
              {/* Срок виден у живых вопросов ВСЕГДА: дата (красная при просрочке) или «без срока» приглушённо. */}
              {r.due_date ? (
                <span style={{ ...S.due, ...(overdue ? S.dueOverdue : {}) }} title={t('lore.oqBoard.dueTitle', 'срок ответа')}>
                  {overdue ? '⚠ ' : '📅 '}{r.due_date.slice(0, 10)}
                </span>
              ) : (st === 'open' || st === 'deferred') && (
                <span style={{ ...S.due, opacity: 0.45 }} title={t('lore.oqBoard.noDueTitle', 'срок ответа не задан — поставьте через ✎')}>
                  {t('lore.oqBoard.noDue', 'без срока')}
                </span>
              )}
              <button style={S.editBtn} title={t('lore.oqBoard.edit', 'Править')} onClick={() => startEdit(r)}>✎</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  root:   { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0 },
  count:  { fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  overdueBadge: {
    fontSize: 'var(--fs-2xs)', padding: '1px 7px', borderRadius: 999, fontWeight: 700,
    color: 'var(--err)', background: 'color-mix(in srgb, var(--err) 14%, transparent)',
    border: '1px solid color-mix(in srgb, var(--err) 35%, transparent)',
  },
  filterNote: { fontSize: 'var(--fs-sm)', color: 'var(--acc)' },
  list:  { flex: 1, overflowY: 'auto' as const },
  empty: { padding: '24px 16px', color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 16px', borderBottom: '1px solid var(--bd)',
  },
  statusDot: (c: string) => ({ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }),
  qid:  { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)', fontWeight: 700, flexShrink: 0, minWidth: 60 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 'var(--fs-base)', color: 'var(--t1)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' },
  prioChip: (c: string) => ({
    fontSize: 'var(--fs-2xs)', padding: '1px 6px', borderRadius: 3, flexShrink: 0, fontWeight: 600,
    color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)`,
  }),
  gateChip: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    color: 'var(--err)', background: 'color-mix(in srgb, var(--err) 10%, transparent)',
  },
  compChip: { fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, background: 'var(--b2)', color: 'var(--t3)' },
  projChip: { fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, fontFamily: 'var(--mono)', color: 'var(--suc)', background: 'color-mix(in srgb, var(--suc) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--suc) 25%, transparent)' },
  adrChip:  { fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, fontFamily: 'var(--mono)', color: 'var(--t3)', border: '1px solid var(--bd)' },
  adrLink:  {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, cursor: 'pointer', fontFamily: 'var(--mono)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)', background: 'color-mix(in srgb, var(--acc) 8%, transparent)',
  },
  ansChip:  { fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, fontFamily: 'var(--mono)', color: 'var(--suc)', border: '1px solid color-mix(in srgb, var(--suc) 30%, transparent)' },
  due:      { fontSize: 'var(--fs-xs)', color: 'var(--t3)', flexShrink: 0, fontFamily: 'var(--mono)' },
  dueOverdue: { color: 'var(--err)', fontWeight: 700 },
  dimRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' },
  dimLbl: { fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginRight: 4, minWidth: 70 },
  ctrl: { fontSize: 'var(--fs-xs)', padding: '3px 8px', cursor: 'pointer', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)' },
  ctrlActive: { background: 'color-mix(in srgb, var(--acc) 15%, transparent)', color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)' },
  pillGroup: { display: 'flex' },
  newBtn: {
    fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    border: '1px dashed color-mix(in srgb, var(--acc) 40%, transparent)',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)', color: 'var(--acc)',
  },
  editBtn: {
    fontSize: 'var(--fs-xs)', padding: '1px 5px', borderRadius: 3, cursor: 'pointer', flexShrink: 0,
    border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)',
  },
  formPanel: { padding: '10px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexShrink: 0 },
  formTitle: { fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--t2)', marginBottom: 6 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 },
  input: {
    fontSize: 'var(--fs-sm)', padding: '4px 8px', borderRadius: 4, minWidth: 0,
    border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'inherit',
  },
  saveBtn: {
    fontSize: 'var(--fs-sm)', padding: '4px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    border: '1px solid var(--acc)', background: 'var(--acc)', color: 'var(--bg1)',
  },
  cancelBtn: {
    fontSize: 'var(--fs-sm)', padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)',
  },
};
