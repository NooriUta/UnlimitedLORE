import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchLoreSlice, linkSprintMilestone, upsertMilestone,
  type LoreMilestone, type LoreSprintRow,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta } from './lore-status';
import TipTapField from './TipTapField';

function classifySprint(s: string | null): string {
  const u = (s ?? '').toUpperCase();
  if (/DONE|CLOSED|ЗАВЕРШ|✅/.test(u)) return 'done';
  if (/PROGRESS|WIP/.test(u))          return 'in_progress';
  if (/BLOCK|ЗАБЛОК/.test(u))          return 'blocked';
  if (/CANCEL|ОТМЕН/.test(u))          return 'cancelled';
  if (/PARTIAL|ЧАСТИЧ/.test(u))        return 'partial';
  if (/PLAN/.test(u))                  return 'planned';
  return 'todo';
}
const projShort = (p: string | null | undefined) => (p ?? '').split('/').pop() ?? '';

const RU_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
// ISO "2026-07-06" → "6 июл" for date_display.
function fmtRuDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[3])} ${RU_MON[parseInt(m[2]) - 1]}`;
}

interface EditState { label: string; date_display: string; week: string; goal_md: string; priority: string }
const PRIORITIES = ['', 'P0', 'P1', 'P2', 'P3'];

export default function LoreMilestoneManager({ onChange }: { onChange?: () => void }) {
  const { t } = useTranslation();
  const [milestones, setMilestones] = useState<(LoreMilestone & { direct_sprint_ids?: string[] | null })[]>([]);
  const [sprints, setSprints]       = useState<LoreSprintRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState<string | null>(null);
  const [openId, setOpenId]         = useState<string | null>(null);  // accordion — one milestone at a time
  const [editId, setEditId]         = useState<string | null>(null);
  const [edit, setEdit]             = useState<EditState>({ label: '', date_display: '', week: '', goal_md: '', priority: '' });
  const [addOpen, setAddOpen]       = useState(false);
  const [draft, setDraft]           = useState<EditState & { milestone_id: string }>({ milestone_id: '', label: '', date_display: '', week: '', goal_md: '', priority: '' });
  const [pick, setPick]             = useState<Record<string, string>>({});
  const [err, setErr]               = useState<string | null>(null);

  async function reload() {
    const [ms, sp] = await Promise.all([
      fetchLoreSlice<LoreMilestone & { direct_sprint_ids?: string[] | null }>('milestones'),
      fetchLoreSlice<LoreSprintRow>('sprints'),
    ]);
    setMilestones(ms); setSprints(sp); setLoading(false);
  }
  useEffect(() => { reload().catch(e => { setErr(String(e)); setLoading(false); }); }, []);

  const sprintIds = useMemo(() => sprints.map(s => s.sprint_id).sort(), [sprints]);
  const sprintMeta = useMemo(() => new Map(sprints.map(s => [s.sprint_id, s])), [sprints]);

  // Sprints not linked to ANY milestone — for planning (assign them).
  const linkedSet = useMemo(() => {
    const s = new Set<string>();
    milestones.forEach(m => (m.direct_sprint_ids ?? []).forEach(id => id && s.add(id)));
    return s;
  }, [milestones]);
  const orphans = useMemo(
    () => sprints.filter(s => !linkedSet.has(s.sprint_id)).sort((a, b) => a.sprint_id.localeCompare(b.sprint_id)),
    [sprints, linkedSet]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); await reload(); onChange?.(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }

  function startEdit(m: LoreMilestone) {
    setEditId(m.milestone_id);
    setEdit({ label: m.label ?? '', date_display: m.date_display ?? '', week: m.week != null ? String(m.week) : '', goal_md: m.goal_md ?? '', priority: m.priority ?? '' });
  }

  if (loading) return <div style={S.note}>{t('lore.milestoneManager.loading', 'Загрузка вех…')}</div>;

  return (
    <section style={S.panel}>
      <div style={S.head}>
        <div style={S.title}><GameIcon slug="crossed-axes" size={14} style={{ color: 'var(--acc)' }} /> {t('lore.milestoneManager.title', 'Управление вехами')} <span style={S.dim}>· {milestones.length}</span></div>
        <button style={S.btnPrimary} onClick={() => setAddOpen(o => !o)}>{addOpen ? t('lore.milestoneManager.cancel', '× Отмена') : t('lore.milestoneManager.addMilestone', '+ Веха')}</button>
      </div>
      {err && <div style={S.err}>{err}</div>}

      {addOpen && (
        <div style={S.editBox}>
          <div style={S.row}>
            <input style={S.in} placeholder={t('lore.milestoneManager.placeholder.milestoneId', 'milestone_id (напр. M8)')} value={draft.milestone_id}
              onChange={e => setDraft({ ...draft, milestone_id: e.target.value })} />
            <input style={S.in} placeholder={t('lore.milestoneManager.placeholder.label', 'label')} value={draft.label}
              onChange={e => setDraft({ ...draft, label: e.target.value })} />
            <input style={{ ...S.in, width: 70 }} placeholder={t('lore.milestoneManager.placeholder.week', 'week')} value={draft.week}
              onChange={e => setDraft({ ...draft, week: e.target.value })} />
            <input type="date" style={{ ...S.in, width: 130 }} title={t('lore.milestoneManager.pickDate', 'Выбрать дату')}
              onChange={e => e.target.value && setDraft({ ...draft, date_display: fmtRuDate(e.target.value) })} />
            <input style={{ ...S.in, width: 120 }} placeholder={t('lore.milestoneManager.placeholder.dateText', 'дата (текст)')} value={draft.date_display}
              onChange={e => setDraft({ ...draft, date_display: e.target.value })} />
            <select style={{ ...S.in, width: 90 }} value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p || t('lore.milestoneManager.placeholder.priority', 'приоритет')}</option>)}
            </select>
          </div>
          <TipTapField value={draft.goal_md} onChange={v => setDraft({ ...draft, goal_md: v })} minHeight={48}
            placeholder={t('lore.milestoneManager.placeholder.goal', 'Описание / цель вехи (goal_md)')}
            enableImages={false} enableHtmlMode={false} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={S.btnPrimary} disabled={!draft.milestone_id.trim() || busy === 'create'}
              onClick={() => run('create', async () => {
                await upsertMilestone({
                  milestone_id: draft.milestone_id.trim(), label: draft.label || draft.milestone_id,
                  week: draft.week ? parseInt(draft.week) : null, date_display: draft.date_display || null,
                  goal_md: draft.goal_md || null, priority: draft.priority || null,
                });
                setAddOpen(false); setDraft({ milestone_id: '', label: '', date_display: '', week: '', goal_md: '', priority: '' });
              })}>
              {busy === 'create' ? '…' : t('lore.milestoneManager.create', 'Создать')}
            </button>
          </div>
        </div>
      )}

      <div style={S.list}>
        {milestones.map(m => {
          const ids = (m.direct_sprint_ids ?? []).filter(Boolean);
          const isOpen = openId === m.milestone_id;
          const isEdit = editId === m.milestone_id;
          return (
            <div key={m.milestone_id} style={S.card}>
              <div style={{ ...S.cardHead, cursor: 'pointer' }}
                onClick={() => { setOpenId(isOpen ? null : m.milestone_id); setEditId(null); }}>
                <span style={{ fontSize: 8, color: 'var(--t3)', width: 8 }}>{isOpen ? '▼' : '▶'}</span>
                <span style={S.mid}>{m.milestone_id}</span>
                <span style={S.label}>{m.label}</span>
                <span style={S.dim}>{m.date_display}{m.week != null ? ` · w${m.week}` : ''}</span>
                <span style={S.spCount}>{ids.length} Sp</span>
                {isOpen && (
                  <button style={S.btn} onClick={e => { e.stopPropagation(); isEdit ? setEditId(null) : startEdit(m); }}>{isEdit ? t('lore.milestoneManager.close', 'Закрыть') : t('lore.milestoneManager.edit', '✎ правка')}</button>
                )}
              </div>

              {isOpen && (<>

              {isEdit && (
                <div style={S.editBox}>
                  <div style={S.row}>
                    <input style={S.in} value={edit.label} placeholder={t('lore.milestoneManager.placeholder.label', 'label')} onChange={e => setEdit({ ...edit, label: e.target.value })} />
                    <input style={{ ...S.in, width: 70 }} value={edit.week} placeholder={t('lore.milestoneManager.placeholder.week', 'week')} onChange={e => setEdit({ ...edit, week: e.target.value })} />
                    <input type="date" style={{ ...S.in, width: 130 }} title={t('lore.milestoneManager.pickDateFill', 'Выбрать дату → заполнит поле справа')}
                      onChange={e => e.target.value && setEdit({ ...edit, date_display: fmtRuDate(e.target.value) })} />
                    <input style={{ ...S.in, width: 120 }} value={edit.date_display} placeholder={t('lore.milestoneManager.placeholder.dateText', 'дата (текст)')} onChange={e => setEdit({ ...edit, date_display: e.target.value })} />
                    <select style={{ ...S.in, width: 90 }} value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value })}>
                      {PRIORITIES.map(p => <option key={p} value={p}>{p || t('lore.milestoneManager.placeholder.priority', 'приоритет')}</option>)}
                    </select>
                  </div>
                  <TipTapField value={edit.goal_md} onChange={v => setEdit({ ...edit, goal_md: v })} minHeight={48}
                    placeholder={t('lore.milestoneManager.placeholder.goal', 'Описание / цель вехи (goal_md)')}
                    enableImages={false} enableHtmlMode={false} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button style={S.btnPrimary} disabled={busy === 'edit'} onClick={() => run('edit', async () => {
                      await upsertMilestone({
                        milestone_id: m.milestone_id, label: edit.label,
                        week: edit.week ? parseInt(edit.week) : null,
                        date_display: edit.date_display || null, goal_md: edit.goal_md || null,
                        priority: edit.priority || null,
                      });
                      setEditId(null);
                    })}>{busy === 'edit' ? '…' : t('lore.milestoneManager.save', 'Сохранить')}</button>
                  </div>
                </div>
              )}

              {/* Linked sprints — rows with status + project */}
              <div style={{ fontSize: 8, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '8px 0 3px' }}>
                {t('lore.milestoneManager.linkedSprints', 'Привязанные спринты')} · {ids.length}
              </div>
              <div style={S.sprList}>
                {ids.length === 0 && <div style={{ fontSize: 10, color: 'var(--t4)', fontStyle: 'italic', padding: '2px 0' }}>{t('lore.milestoneManager.noneYet', 'пока нет — добавьте ниже')}</div>}
                {ids.map(sid => {
                  const s = sprintMeta.get(sid);
                  const k = classifySprint(s?.status_raw ?? null);
                  const proj = projShort(s?.git_projects?.[0]);
                  return (
                    <div key={sid} style={S.sprRow}>
                      <GameIcon slug={statusMeta(k).icon} size={11} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                      <span style={S.sprId}>{sid}</span>
                      <span style={S.sprName}>{s?.name ?? ''}</span>
                      {proj && <span style={S.projTag}>{proj}</span>}
                      <button style={S.x} title={t('lore.milestoneManager.unlink', 'Отвязать')} disabled={busy === 'unlink-' + sid}
                        onClick={() => run('unlink-' + sid, () => linkSprintMilestone(sid, m.milestone_id, 'remove'))}>×</button>
                    </div>
                  );
                })}
              </div>
              {/* Add sprint — searchable select with status + project in label */}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <select style={{ ...S.in, flex: 1 }} value={pick[m.milestone_id] ?? ''}
                  onChange={e => {
                    const sid = e.target.value;
                    if (!sid) return;
                    run('link-' + m.milestone_id, async () => {
                      await linkSprintMilestone(sid, m.milestone_id, 'add');
                      setPick({ ...pick, [m.milestone_id]: '' });
                    });
                  }}>
                  <option value="">{t('lore.milestoneManager.linkSprintOption', '+ привязать спринт…')}</option>
                  {sprintIds.filter(s => !ids.includes(s)).map(s => {
                    const sm = sprintMeta.get(s);
                    const proj = projShort(sm?.git_projects?.[0]);
                    const st = classifySprint(sm?.status_raw ?? null);
                    return <option key={s} value={s}>{s}{proj ? ` · ${proj}` : ''} · {st}</option>;
                  })}
                </select>
                {busy === 'link-' + m.milestone_id && <span style={{ fontSize: 10, color: 'var(--t3)' }}>…</span>}
              </div>
              </>)}
            </div>
          );
        })}
      </div>

      {/* Sprints without any milestone — assign for planning */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
        <div style={{ ...S.title, marginBottom: 6, color: orphans.length ? 'var(--wrn)' : 'var(--t3)' }}>
          <GameIcon slug="hourglass" size={12} style={{ color: orphans.length ? 'var(--wrn)' : 'var(--t3)' }} />
          {t('lore.milestoneManager.sprintsWithoutMilestones', 'Спринты без вех')} <span style={S.dim}>· {orphans.length}</span>
        </div>
        {orphans.length === 0
          ? <div style={{ fontSize: 10, color: 'var(--suc)' }}>{t('lore.milestoneManager.allSprintsLinked', 'Все спринты привязаны к вехам ✓')}</div>
          : (
            <div style={{ ...S.sprList, maxHeight: 300, overflowY: 'auto' as const, gap: 2 }}>
              {orphans.map(s => {
                const k = classifySprint(s.status_raw);
                const proj = projShort(s.git_projects?.[0]);
                return (
                  <div key={s.sprint_id} style={{ ...S.sprRow, background: 'var(--b2)' }}>
                    <GameIcon slug={statusMeta(k).icon} size={11} style={{ color: statusMeta(k).color, flexShrink: 0 }} />
                    <span style={S.sprId}>{s.sprint_id}</span>
                    <span style={S.sprName}>{s.name}</span>
                    {proj && <span style={S.projTag}>{proj}</span>}
                    <select style={{ ...S.in, fontSize: 9, padding: '2px 4px', flexShrink: 0 }} value=""
                      onChange={e => {
                        const mid = e.target.value;
                        if (!mid) return;
                        run('assign-' + s.sprint_id, () => linkSprintMilestone(s.sprint_id, mid, 'add'));
                      }}>
                      <option value="">{t('lore.milestoneManager.assignToMilestoneOption', '→ в веху…')}</option>
                      {milestones.map(m => <option key={m.milestone_id} value={m.milestone_id}>{m.milestone_id}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </section>
  );
}

const S = {
  panel:   { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 10, padding: 12 },
  head:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title:   { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  dim:     { fontSize: 10, color: 'var(--t3)', fontWeight: 400 },
  note:    { padding: 16, color: 'var(--t3)', fontSize: 12 },
  err:     { fontSize: 10, color: 'var(--dng)', padding: '4px 0' },
  list:    { display: 'flex', flexDirection: 'column' as const, gap: 6, maxHeight: 460, overflowY: 'auto' as const },
  card:    { border: '1px solid var(--bd)', borderRadius: 8, padding: 8, background: 'var(--b2)' },
  cardHead:{ display: 'flex', alignItems: 'center', gap: 8 },
  mid:     { fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--acc)' },
  label:   { fontSize: 11, color: 'var(--t1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  spCount: { fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--mono)' },
  chips:   { display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginTop: 6 },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontFamily: 'var(--mono)', padding: '1px 4px', borderRadius: 3, background: 'var(--b3)', border: '1px solid var(--bd)', color: 'var(--t2)' },
  x:       { border: 'none', background: 'transparent', color: 'var(--dng)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 },
  sprList: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  sprRow:  { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '2px 4px', borderRadius: 4 },
  sprId:   { fontFamily: 'var(--mono)', color: 'var(--acc)', flexShrink: 0, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  sprName: { color: 'var(--t3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  projTag: { fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--t2)', background: 'var(--b3)', borderRadius: 3, padding: '0 4px', flexShrink: 0 },
  editBox: { display: 'flex', flexDirection: 'column' as const, gap: 6, padding: 8, marginTop: 6, background: 'var(--b3)', borderRadius: 6 },
  row:     { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  in:      { fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)' },
  ta:      { fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)', minHeight: 48, resize: 'vertical' as const, fontFamily: 'inherit' },
  btn:     { fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer' },
  btnPrimary: { fontSize: 10, padding: '3px 10px', borderRadius: 4, border: '1px solid color-mix(in srgb,var(--acc) 35%,transparent)', background: 'color-mix(in srgb,var(--acc) 12%,transparent)', color: 'var(--acc)', cursor: 'pointer', fontWeight: 600 },
};
