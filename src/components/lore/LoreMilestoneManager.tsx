import { useEffect, useMemo, useState } from 'react';
import {
  fetchLoreSlice, linkSprintMilestone, upsertMilestone,
  type LoreMilestone, type LoreSprintRow,
} from '../../api/lore';
import { GameIcon } from './GameIcon';

// Union of a milestone's sprints: plan-item path (sprint_ids) + direct (direct_sprint_ids).
function msSprintIds(m: LoreMilestone & { direct_sprint_ids?: string[] | null }): string[] {
  return [...new Set([...(m.sprint_ids ?? []), ...(m.direct_sprint_ids ?? [])].filter(Boolean))];
}

interface EditState { label: string; date_display: string; week: string; goal_md: string }

export default function LoreMilestoneManager({ onChange }: { onChange?: () => void }) {
  const [milestones, setMilestones] = useState<(LoreMilestone & { direct_sprint_ids?: string[] | null })[]>([]);
  const [sprints, setSprints]       = useState<LoreSprintRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState<string | null>(null);
  const [editId, setEditId]         = useState<string | null>(null);
  const [edit, setEdit]             = useState<EditState>({ label: '', date_display: '', week: '', goal_md: '' });
  const [addOpen, setAddOpen]       = useState(false);
  const [draft, setDraft]           = useState<EditState & { milestone_id: string }>({ milestone_id: '', label: '', date_display: '', week: '', goal_md: '' });
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
  const sprintName = useMemo(() => new Map(sprints.map(s => [s.sprint_id, s.name])), [sprints]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); await reload(); onChange?.(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  }

  function startEdit(m: LoreMilestone) {
    setEditId(m.milestone_id);
    setEdit({ label: m.label ?? '', date_display: m.date_display ?? '', week: m.week != null ? String(m.week) : '', goal_md: m.goal_md ?? '' });
  }

  if (loading) return <div style={S.note}>Загрузка вех…</div>;

  return (
    <section style={S.panel}>
      <div style={S.head}>
        <div style={S.title}><GameIcon slug="crossed-axes" size={14} style={{ color: 'var(--acc)' }} /> Управление вехами <span style={S.dim}>· {milestones.length}</span></div>
        <button style={S.btnPrimary} onClick={() => setAddOpen(o => !o)}>{addOpen ? '× Отмена' : '+ Веха'}</button>
      </div>
      {err && <div style={S.err}>{err}</div>}

      {addOpen && (
        <div style={S.editBox}>
          <div style={S.row}>
            <input style={S.in} placeholder="milestone_id (напр. M8)" value={draft.milestone_id}
              onChange={e => setDraft({ ...draft, milestone_id: e.target.value })} />
            <input style={S.in} placeholder="label" value={draft.label}
              onChange={e => setDraft({ ...draft, label: e.target.value })} />
            <input style={{ ...S.in, width: 70 }} placeholder="week" value={draft.week}
              onChange={e => setDraft({ ...draft, week: e.target.value })} />
            <input style={S.in} placeholder="дата (напр. 31 авг)" value={draft.date_display}
              onChange={e => setDraft({ ...draft, date_display: e.target.value })} />
          </div>
          <textarea style={S.ta} placeholder="Цель (goal_md)" value={draft.goal_md}
            onChange={e => setDraft({ ...draft, goal_md: e.target.value })} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={S.btnPrimary} disabled={!draft.milestone_id.trim() || busy === 'create'}
              onClick={() => run('create', async () => {
                await upsertMilestone({
                  milestone_id: draft.milestone_id.trim(), label: draft.label || draft.milestone_id,
                  week: draft.week ? parseInt(draft.week) : null, date_display: draft.date_display || null,
                  goal_md: draft.goal_md || null,
                });
                setAddOpen(false); setDraft({ milestone_id: '', label: '', date_display: '', week: '', goal_md: '' });
              })}>
              {busy === 'create' ? '…' : 'Создать'}
            </button>
          </div>
        </div>
      )}

      <div style={S.list}>
        {milestones.map(m => {
          const ids = msSprintIds(m);
          const isEdit = editId === m.milestone_id;
          return (
            <div key={m.milestone_id} style={S.card}>
              <div style={S.cardHead}>
                <span style={S.mid}>{m.milestone_id}</span>
                <span style={S.label}>{m.label}</span>
                <span style={S.dim}>{m.date_display}{m.week != null ? ` · w${m.week}` : ''}</span>
                <span style={S.spCount}>{ids.length} Sp</span>
                <button style={S.btn} onClick={() => isEdit ? setEditId(null) : startEdit(m)}>{isEdit ? 'Закрыть' : '✎'}</button>
              </div>

              {isEdit && (
                <div style={S.editBox}>
                  <div style={S.row}>
                    <input style={S.in} value={edit.label} placeholder="label" onChange={e => setEdit({ ...edit, label: e.target.value })} />
                    <input style={{ ...S.in, width: 70 }} value={edit.week} placeholder="week" onChange={e => setEdit({ ...edit, week: e.target.value })} />
                    <input style={S.in} value={edit.date_display} placeholder="дата" onChange={e => setEdit({ ...edit, date_display: e.target.value })} />
                  </div>
                  <textarea style={S.ta} value={edit.goal_md} placeholder="Цель (goal_md)" onChange={e => setEdit({ ...edit, goal_md: e.target.value })} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button style={S.btnPrimary} disabled={busy === 'edit'} onClick={() => run('edit', async () => {
                      await upsertMilestone({
                        milestone_id: m.milestone_id, label: edit.label,
                        week: edit.week ? parseInt(edit.week) : null,
                        date_display: edit.date_display || null, goal_md: edit.goal_md || null,
                      });
                      setEditId(null);
                    })}>{busy === 'edit' ? '…' : 'Сохранить'}</button>
                  </div>
                </div>
              )}

              {/* Linked sprints */}
              <div style={S.chips}>
                {ids.map(sid => (
                  <span key={sid} style={S.chip} title={sprintName.get(sid) ?? sid}>
                    {sid}
                    <button style={S.x} disabled={busy === 'unlink-' + sid}
                      onClick={() => run('unlink-' + sid, () => linkSprintMilestone(sid, m.milestone_id, 'remove'))}>×</button>
                  </span>
                ))}
              </div>
              {/* Add sprint */}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input list={`spr-${m.milestone_id}`} style={{ ...S.in, flex: 1 }} placeholder="привязать спринт…"
                  value={pick[m.milestone_id] ?? ''} onChange={e => setPick({ ...pick, [m.milestone_id]: e.target.value })} />
                <datalist id={`spr-${m.milestone_id}`}>
                  {sprintIds.filter(s => !ids.includes(s)).map(s => <option key={s} value={s} />)}
                </datalist>
                <button style={S.btn} disabled={!pick[m.milestone_id] || busy === 'link-' + m.milestone_id}
                  onClick={() => run('link-' + m.milestone_id, async () => {
                    await linkSprintMilestone(pick[m.milestone_id], m.milestone_id, 'add');
                    setPick({ ...pick, [m.milestone_id]: '' });
                  })}>+ привязать</button>
              </div>
            </div>
          );
        })}
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
  editBox: { display: 'flex', flexDirection: 'column' as const, gap: 6, padding: 8, marginTop: 6, background: 'var(--b3)', borderRadius: 6 },
  row:     { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  in:      { fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)' },
  ta:      { fontSize: 11, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--bd)', background: 'var(--b1)', color: 'var(--t1)', minHeight: 48, resize: 'vertical' as const, fontFamily: 'inherit' },
  btn:     { fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer' },
  btnPrimary: { fontSize: 10, padding: '3px 10px', borderRadius: 4, border: '1px solid color-mix(in srgb,var(--acc) 35%,transparent)', background: 'color-mix(in srgb,var(--acc) 12%,transparent)', color: 'var(--acc)', cursor: 'pointer', fontWeight: 600 },
};
