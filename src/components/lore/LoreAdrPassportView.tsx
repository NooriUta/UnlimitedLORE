import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, loreMutate, type LoreAdrPassport, type LoreDecisionRow, type LoreQuestionRow } from '../../api/lore';
import { isOverdue } from './LoreOpenQuestionsBoard';
import { LoreLinkChips, type LinkMeta } from './LoreLinkChips';
import { MartProse } from '../bench/MartProse';
import LoreAdrEditor from './LoreAdrEditor';
import { adrStatusLabel } from './LoreAdrList';

const STATUS_COLOR: Record<string, string> = {
  PROPOSED:   'var(--inf)',
  ACCEPTED:   'var(--suc)',
  DEPRECATED: 'var(--wrn)',
  SUPERSEDED: 'var(--t3)',
};

const S = {
  root:    { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  topBar:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  back: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--acc)', fontSize: 'var(--fs-base)', padding: 0,
  },
  editBtn: {
    background: 'none', border: '1px solid var(--b3)', cursor: 'pointer',
    color: 'var(--t2)', fontSize: 'var(--fs-sm)', padding: '2px 10px', borderRadius: 4,
  },
  header:  { display: 'flex', flexDirection: 'column' as const, gap: 6, marginBottom: 16 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  id:      { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' },
  name:    { fontSize: 'var(--fs-lg)', color: 'var(--t1)', fontWeight: 500, lineHeight: 1.35 },
  statusChip: (status: string) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' as const,
    color: STATUS_COLOR[status] ?? 'var(--t3)',
    background: `color-mix(in srgb, ${STATUS_COLOR[status] ?? 'var(--t3)'} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${STATUS_COLOR[status] ?? 'var(--t3)'} 30%, transparent)`,
  }),
  section: { marginTop: 16 },
  sLabel:  { fontSize: 'var(--fs-sm)', color: 'var(--t3)', textTransform: 'uppercase' as const, marginBottom: 4 },
  prose:   { fontSize: 'var(--fs-sm)' },
  chips:   { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  chip: (clickable: boolean) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)',
    background: 'var(--b2)', color: clickable ? 'var(--acc)' : 'var(--t2)',
    border: '1px solid var(--b3)', cursor: clickable ? 'pointer' : 'default',
    whiteSpace: 'nowrap' as const,
  }),
  compChip: {
    padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)',
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    whiteSpace: 'nowrap' as const,
  },
  date:  { color: 'var(--t3)', fontSize: 'var(--fs-sm)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  decNewBtn: {
    fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
    border: '1px dashed color-mix(in srgb, var(--acc) 40%, transparent)',
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)', color: 'var(--acc)',
  },
  decEditBtn: {
    fontSize: 'var(--fs-xs)', padding: '0 5px', borderRadius: 3, cursor: 'pointer', flexShrink: 0,
    border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t3)',
  },
  decFormPanel: {
    display: 'flex', flexDirection: 'column' as const, gap: 5, padding: 8, marginBottom: 6,
    border: '1px solid var(--b3)', borderRadius: 5, background: 'var(--bg2)',
  },
  decInput: {
    fontSize: 'var(--fs-sm)', padding: '4px 8px', borderRadius: 4,
    border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'inherit',
  },
  decSave: {
    fontSize: 'var(--fs-sm)', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    border: '1px solid var(--acc)', background: 'var(--acc)', color: 'var(--bg1)',
  },
  decCancel: {
    fontSize: 'var(--fs-sm)', padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)',
  },
};

// Question status → dot colour (mirrors the ОВ register's STATUS_META).
const QSTATUS_COLOR: Record<string, string> = {
  open: 'var(--inf)', deferred: 'var(--wrn)', closed: 'var(--suc)', dropped: 'var(--t3)',
};

interface Props {
  adrId: string;
  onError: (e: unknown) => void;
  onBack: () => void;
  onNavigate: (id: string) => void;
}

export default function LoreAdrPassportView({ adrId, onError, onBack, onNavigate }: Props) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams(); // QLINK-01: deep-link в реестр ОВ
  const [data, setData]       = useState<LoreAdrPassport | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [reload, setReload]   = useState(0);
  // ADR-019 "rationale" mode: the decisions that live under this ADR (DECIDED_IN).
  const [decisions, setDecisions] = useState<LoreDecisionRow[]>([]);
  // ADR-020/021: open questions raised against this ADR (RAISED_IN). Read-only
  // here — questions are created/edited in the ОВ register.
  const [questions, setQuestions] = useState<LoreQuestionRow[]>([]);
  // Inline decision editing (ADR-019: edit decisions where they live as children).
  const [decEditId, setDecEditId] = useState<string | null>(null); // decision_id | '__new__' | null
  const [decForm, setDecForm]     = useState<{ decision_id: string; title: string; body_md: string; component_id: string }>(
    { decision_id: '', title: '', body_md: '', component_id: '' });
  // Component ids for the decision form's "Компонент" binding (datalist).
  const [compIds, setCompIds] = useState<string[]>([]);
  // T43: component icon/area/name meta for the module-style picker (as in Спринты).
  const [compMeta, setCompMeta] = useState<Record<string, LinkMeta>>({});
  // T43: git-project slugs for the decision multi-project picker.
  const [projectIds, setProjectIds] = useState<string[]>([]);

  // T43: add/remove a component or project link on a decision (multi, via edges).
  async function linkDecision(decision_id: string, rel: 'component' | 'project', value: string, action: 'add' | 'remove') {
    try {
      const body = rel === 'component'
        ? { decision_id, component_id: value, action }
        : { decision_id, project: value, action };
      await loreMutate(`/decision/${rel}`, body);
      setReload(x => x + 1);
    } catch (e) { onError(e); }
  }
  const [decSaving, setDecSaving] = useState(false);

  function startNewDec() { setDecForm({ decision_id: '', title: '', body_md: '', component_id: '' }); setDecEditId('__new__'); }
  function startEditDec(d: LoreDecisionRow) {
    setDecForm({ decision_id: d.decision_id, title: d.title ?? '', body_md: '', component_id: d.component_id ?? '' });
    setDecEditId(d.decision_id);
  }
  function cancelDec() { setDecEditId(null); }
  async function saveDec() {
    const f = decForm;
    if (!f.decision_id.trim() || !f.title.trim()) { onError(new Error('decision_id и title обязательны')); return; }
    setDecSaving(true);
    try {
      // Partial-safe upsert: on edit we omit body_md when empty so it isn't wiped.
      const body: Record<string, unknown> = {
        decision_id: f.decision_id.trim(), title: f.title.trim(),
        adr_id: adrId, component_id: f.component_id.trim() || null,
      };
      if (decEditId === '__new__' || f.body_md.trim()) body.body_md = f.body_md.trim() || null;
      await loreMutate('/decision', body);
      setDecEditId(null); setReload(x => x + 1);
    } catch (e) { onError(e); } finally { setDecSaving(false); }
  }

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreAdrPassport>('adr', { id: adrId }, ctrl.signal)
      .then(rows => { setData(rows[0] ?? null); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    fetchLoreSlice<LoreDecisionRow>('decisions_of_adr', { id: adrId }, ctrl.signal)
      .then(setDecisions).catch(() => { /* decisions are optional context */ });
    fetchLoreSlice<LoreQuestionRow>('questions_of_adr', { id: adrId }, ctrl.signal)
      .then(setQuestions).catch(() => { /* questions are optional context */ });
    fetchLoreSlice<{ component_id: string; game_icon: string | null; area: string | null; full_name: string | null }>('components', {}, ctrl.signal)
      .then(cs => {
        setCompIds(cs.map(c => c.component_id).filter(Boolean).sort());
        const m: Record<string, LinkMeta> = {};
        cs.forEach(c => { if (c.component_id) m[c.component_id] = { game_icon: c.game_icon, area: c.area, full_name: c.full_name }; });
        setCompMeta(m);
      })
      .catch(() => { /* picker degrades to plain */ });
    fetchLoreSlice<{ slug: string }>('git_projects', {}, ctrl.signal)
      .then(ps => setProjectIds(ps.map(p => p.slug).filter(Boolean).sort()))
      .catch(() => { /* project picker degrades */ });
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adrId, reload]);

  if (loading) return <div style={S.empty}>{t('lore.adrPassportView.loading', 'Загрузка {{adrId}}…', { adrId })}</div>;
  if (!data)   return <div style={S.empty}>{t('lore.adrPassportView.notFound', 'ADR не найден: {{adrId}}', { adrId })}</div>;

  if (editing) {
    return (
      <LoreAdrEditor
        lockId
        initial={{
          adr_id:          data.adr_id,
          name:            data.name            ?? '',
          status:          (data.status?.toUpperCase()) ?? 'PROPOSED',
          date_created:    data.date_created    ?? '',
          context_md:      data.context_md      ?? '',
          decision_md:     data.decision_md     ?? '',
          consequences_md: data.consequences_md ?? '',
          depends_on_ids:  data.depends_on_ids  ?? [],
          supersedes_ids:  data.supersedes_ids  ?? [],
          component_ids:   data.components      ?? [],
          tags:            data.tags            ?? [],
        }}
        onSaved={() => { setEditing(false); setReload(r => r + 1); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const components    = data.components        ?? [];
  const dependsOn     = data.depends_on_ids    ?? [];
  const supersedes    = data.supersedes_ids    ?? [];
  const implementedIn = data.implemented_in_ids ?? [];
  const releasedIn    = data.release_ids        ?? [];
  const tags          = data.tags              ?? [];

  // Full-ADR Markdown export — assembles the complete record (header + all
  // body sections + relations) into one .md file, downloaded client-side.
  const downloadMd = () => {
    const lines: string[] = [];
    lines.push(`# ${data.adr_id}${data.name ? ` — ${data.name}` : ''}`, '');
    const meta: string[] = [];
    if (data.status)       meta.push(`- **Status:** ${data.status.toUpperCase()}`);
    if (data.date_created) meta.push(`- **Date:** ${data.date_created.slice(0, 10)}`);
    if (components.length)  meta.push(`- **Components:** ${components.join(', ')}`);
    if (tags.length)        meta.push(`- **Tags:** ${tags.join(', ')}`);
    if (dependsOn.length)   meta.push(`- **Depends on:** ${dependsOn.join(', ')}`);
    if (supersedes.length)  meta.push(`- **Supersedes:** ${supersedes.join(', ')}`);
    if (implementedIn.length) meta.push(`- **Implemented in:** ${implementedIn.join(', ')}`);
    if (releasedIn.length)  meta.push(`- **Released in:** ${releasedIn.join(', ')}`);
    if (meta.length) lines.push(...meta, '');
    if (data.context_md)      lines.push('## Context', '', data.context_md.trim(), '');
    if (data.decision_md)     lines.push('## Decision', '', data.decision_md.trim(), '');
    if (data.consequences_md) lines.push('## Consequences', '', data.consequences_md.trim(), '');
    // Child decisions (DES) — the concrete rules that live under this ADR.
    if (decisions.length) {
      lines.push(`## ${t('lore.adrPassportView.decisions', 'Решения этого ADR')} (DES)`, '');
      decisions.forEach(d => {
        const m = [d.status_raw, d.component_id].filter(Boolean).join(', ');
        lines.push(`- **#${d.decision_id}** — ${d.title ?? ''}${m ? ` _(${m})_` : ''}`);
      });
      lines.push('');
    }
    // Open questions raised against this ADR (RAISED_IN).
    if (questions.length) {
      lines.push(`## ${t('lore.adrPassportView.questions', 'Открытые вопросы этого ADR')}`, '');
      questions.forEach(qn => {
        const m = [qn.status, qn.priority, qn.due_date && `due ${qn.due_date.slice(0, 10)}`].filter(Boolean).join(', ');
        lines.push(`- **${qn.question_id}** — ${qn.title ?? ''}${m ? ` _(${m})_` : ''}`);
      });
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.adr_id}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <button style={S.back} onClick={onBack}>{t('lore.adrPassportView.backToList', '← К списку')}</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.editBtn} onClick={downloadMd} title={t('lore.adrPassportView.downloadMdTitle', 'Скачать ADR целиком в Markdown')}>{t('lore.adrPassportView.downloadMd', '⬇ MD')}</button>
          <button style={S.editBtn} onClick={() => setEditing(true)}>{t('lore.adrPassportView.edit', '✎ Редактировать')}</button>
        </div>
      </div>

      <div style={S.header}>
        <div style={S.headerMeta}>
          <span style={S.id}>{data.adr_id}</span>
          {data.status && <span style={S.statusChip(data.status.toUpperCase())}>{adrStatusLabel(t, data.status.toUpperCase())}</span>}
          {components.map(c => <span key={c} style={S.compChip}>{c}</span>)}
          {data.date_created && <span style={S.date}>{data.date_created.slice(0, 10)}</span>}
        </div>
        {data.name && <div style={S.name}>{data.name}</div>}
      </div>

      {data.context_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.context', 'Context')}</div>
          <MartProse text={data.context_md} style={S.prose} />
        </div>
      )}
      {data.decision_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.decision', 'Decision')}</div>
          <MartProse text={data.decision_md} style={S.prose} />
        </div>
      )}
      {data.consequences_md && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.consequences', 'Consequences')}</div>
          <MartProse text={data.consequences_md} style={S.prose} />
        </div>
      )}

      {/* ADRPROJ-01: ADR ↔ git-проекты (BELONGS_TO_PROJECT, multi) — тот же
          LoreLinkChips, что у решений; запись через /lore/adr/project с
          linked-валидацией (незарегистрированный проект = честная подсказка). */}
      <div style={S.section}>
        <LoreLinkChips label={t('lore.adrPassportView.projectsMulti', 'Проекты')} color="var(--suc)"
          values={(data.git_projects ?? []).filter(Boolean) as string[]} options={projectIds}
          onAdd={async v => {
            try {
              const r = await loreMutate<{ linked?: boolean; hint?: string }>('/adr/project', { adr_id: adrId, project: v, action: 'add' });
              if (r && r.linked === false) onError(new Error(r.hint || 'ребро не создано'));
              setReload(x => x + 1);
            } catch (e) { onError(e); }
          }}
          onRemove={async v => {
            try { await loreMutate('/adr/project', { adr_id: adrId, project: v, action: 'remove' }); setReload(x => x + 1); }
            catch (e) { onError(e); }
          }} />
      </div>

      {dependsOn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.dependsOn', 'Depends on')}</div>
          <div style={S.chips}>
            {dependsOn.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      {supersedes.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.supersedes', 'Supersedes')}</div>
          <div style={S.chips}>
            {supersedes.map(id => (
              <span key={id} style={S.chip(true)} onClick={() => onNavigate(id)}>{id}</span>
            ))}
          </div>
        </div>
      )}
      <div style={S.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ ...S.sLabel, marginBottom: 0 }}>{t('lore.adrPassportView.decisions', 'Решения этого ADR')}</div>
          <button style={S.decNewBtn} onClick={() => (decEditId === '__new__' ? cancelDec() : startNewDec())}>
            {t('lore.adrPassportView.decNew', '+ решение')}
          </button>
        </div>
        {decEditId !== null && (
          <div style={S.decFormPanel}>
            {decEditId === '__new__' && (
              <input style={S.decInput} placeholder="ID решения (напр. 133)" value={decForm.decision_id}
                onChange={e => setDecForm(f => ({ ...f, decision_id: e.target.value }))} />
            )}
            <input style={S.decInput} placeholder="Заголовок решения (правило)" value={decForm.title}
              onChange={e => setDecForm(f => ({ ...f, title: e.target.value }))} />
            <input style={S.decInput} placeholder={t('lore.adrPassportView.decComponent', 'Компонент — выбор из списка (опц.)')}
              list="lore-decform-comps" value={decForm.component_id}
              onChange={e => setDecForm(f => ({ ...f, component_id: e.target.value }))} />
            <datalist id="lore-decform-comps">
              {compIds.map(c => <option key={c} value={c} />)}
            </datalist>
            <textarea style={{ ...S.decInput, minHeight: 40, resize: 'vertical' as const }}
              placeholder={decEditId === '__new__' ? 'Тело решения (опц.)' : 'Тело — оставьте пустым, чтобы не менять'}
              value={decForm.body_md} onChange={e => setDecForm(f => ({ ...f, body_md: e.target.value }))} />
            {/* T43: multi component + multi project (edges) — for an existing decision. */}
            {decEditId !== '__new__' && (() => {
              const dr = decisions.find(d => d.decision_id === decEditId);
              const comps = (dr?.components ?? []).filter(Boolean) as string[];
              const projs = (dr?.projects ?? []).filter(Boolean) as string[];
              return (
                <>
                  <LoreLinkChips label={t('lore.adrPassportView.componentsMulti', 'Компоненты')} meta={compMeta}
                    values={comps} options={compIds}
                    onAdd={v => linkDecision(decEditId!, 'component', v, 'add')}
                    onRemove={v => linkDecision(decEditId!, 'component', v, 'remove')} />
                  <LoreLinkChips label={t('lore.adrPassportView.projectsMulti', 'Проекты')} color="var(--suc)"
                    values={projs} options={projectIds}
                    onAdd={v => linkDecision(decEditId!, 'project', v, 'add')}
                    onRemove={v => linkDecision(decEditId!, 'project', v, 'remove')} />
                </>
              );
            })()}
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.decSave} disabled={decSaving} onClick={saveDec}>{decSaving ? '…' : t('lore.adrPassportView.save', 'Сохранить')}</button>
              <button style={S.decCancel} onClick={cancelDec}>{t('lore.adrPassportView.cancel', 'Отмена')}</button>
            </div>
          </div>
        )}
        {decisions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {decisions.map(d => (
              <div key={d.decision_id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)', minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', flexShrink: 0 }}>#{d.decision_id}</span>
                <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{d.title}</span>
                <button style={S.decEditBtn} title={t('lore.adrPassportView.edit', 'Править')} onClick={() => startEditDec(d)}>✎</button>
              </div>
            ))}
          </div>
        ) : (decEditId === null && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('lore.adrPassportView.noDecisions', 'Решений пока нет — добавьте «+ решение».')}</div>
        ))}
      </div>
      {questions.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.questions', 'Открытые вопросы этого ADR')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {questions.map(qn => {
              const overdue = isOverdue(qn);
              const color = QSTATUS_COLOR[qn.status ?? 'open'] ?? 'var(--t3)';
              return (
                <div key={qn.question_id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)', minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} title={qn.status ?? 'open'} />
                  {/* QLINK-01: вопрос из ADR открывается в реестре ОВ (deep-link
                      ?section=openQuestions&passport=id) — с правкой на месте там. */}
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', flexShrink: 0, cursor: 'pointer', textDecoration: 'underline dotted' }}
                    title={t('lore.adrPassportView.openInRegister', 'Открыть в реестре вопросов (с правкой)')}
                    onClick={() => {
                      const p = new URLSearchParams(searchParams);
                      p.set('section', 'openQuestions'); p.set('passport', qn.question_id);
                      setSearchParams(p);
                    }}>{qn.question_id}</span>
                  <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{qn.title}</span>
                  {qn.priority && qn.priority !== 'normal' && (
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0 }}>{qn.priority}</span>
                  )}
                  {qn.due_date && (
                    <span style={{ fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', flexShrink: 0, color: overdue ? 'var(--err)' : 'var(--t3)', fontWeight: overdue ? 700 : 400 }}>
                      {qn.due_date.slice(0, 10)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {implementedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.implementedInSprint', 'Implemented in sprint')}</div>
          <div style={S.chips}>
            {implementedIn.map(id => <span key={id} style={S.chip(false)}>{id}</span>)}
          </div>
        </div>
      )}
      {releasedIn.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.releasedIn', 'Released in')}</div>
          <div style={S.chips}>
            {releasedIn.map(id => <span key={id} style={S.chip(false)}>{id}</span>)}
          </div>
        </div>
      )}
      {tags.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>{t('lore.adrPassportView.tags', 'Tags')}</div>
          <div style={S.chips}>
            {tags.map(tag => <span key={tag} style={S.chip(false)}>{tag}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
