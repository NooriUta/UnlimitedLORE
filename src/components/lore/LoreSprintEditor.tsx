// LoreSprintEditor — standalone "create sprint" form, modeled on LoreAdrEditor.
// Sprints had no dedicated create-UI before this (only MCP/lore_create_sprint) —
// this fills that gap with the same multi-select pattern (MultiChip) used for
// ADR relations, for the fields where several values are legitimate
// (components, git projects, an initial batch of tasks).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createLoreSprint,
  createLoreTask,
  linkSprintComponent,
  linkSprintProject,
  fetchLoreSlice,
  type LoreComponent,
} from '../../api/lore';
import { MultiChip } from './LoreAdrEditor';
import TipTapField from './TipTapField';

const SPRINT_STATUSES = [
  'todo', 'planned', 'backlog', 'design', 'active', 'partial',
  'ready_for_deploy', 'done', 'blocked', 'high', 'cancelled',
] as const;

interface GitProjectRow { slug: string; name: string }

interface FormState {
  sprint_id: string;
  name: string;
  status: string;
  priority: string;
  context_md: string;
  outcome_md: string;
  component_ids: string[];
  git_projects: string[];
  initial_tasks: string[];
}

export interface LoreSprintEditorProps {
  onSaved: (sprintId: string) => void;
  onCancel: () => void;
}

export default function LoreSprintEditor({ onSaved, onCancel }: LoreSprintEditorProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>({
    sprint_id: '', name: '', status: 'todo', priority: '',
    context_md: '', outcome_md: '', component_ids: [], git_projects: [], initial_tasks: [],
  });
  const [saving, setSaving]     = useState(false);
  const [errMsg, setErrMsg]     = useState<string | null>(null);
  const [compList, setCompList] = useState<Array<{ id: string; label: string }>>([]);
  const [projList, setProjList] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    fetchLoreSlice<LoreComponent>('components')
      .then(rows => setCompList(rows.map(r => ({ id: r.component_id, label: r.full_name || r.component_id }))))
      .catch(() => {});
    fetchLoreSlice<GitProjectRow>('git_projects')
      .then(rows => setProjList(rows.map(r => ({ id: r.slug, label: r.name }))))
      .catch(() => {});
  }, []);

  const set = <K extends keyof FormState>(key: K) => (v: FormState[K]) =>
    setForm(f => ({ ...f, [key]: v }));

  const handleSave = async () => {
    const id = form.sprint_id.trim();
    const nm = form.name.trim();
    if (!id) { setErrMsg(t('lore.sprintEditor.errSprintIdRequired', 'Sprint ID обязателен')); return; }
    if (!nm) { setErrMsg(t('lore.sprintEditor.errNameRequired', 'Название обязательно')); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await createLoreSprint({
        sprint_id: id, name: nm,
        status:     form.status     || undefined,
        priority:   form.priority   || undefined,
        context_md: form.context_md || undefined,
        outcome_md: form.outcome_md || undefined,
      });
      // Multiplicity fields — each is a separate edge, fire after the vertex exists.
      await Promise.all(form.component_ids.map(cid => linkSprintComponent(id, cid, 'add')));
      await Promise.all(form.git_projects.map(slug => linkSprintProject(id, slug, 'add')));
      await form.initial_tasks.reduce(async (prev, title, i) => {
        await prev;
        await createLoreTask(id, `T${String(i + 1).padStart(2, '0')}`, title);
      }, Promise.resolve());
      onSaved(id);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
      setSaving(false);
    }
  };

  const fieldRow = (label: string, node: React.ReactNode, grow = 1) => (
    <div style={{ ...S.field, flex: grow }}>
      <label style={S.label}>{label}</label>
      {node}
    </div>
  );

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>{t('lore.sprintEditor.title', 'Новый спринт')}</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>{t('lore.sprintEditor.cancel', 'Отмена')}</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? t('lore.sprintEditor.saving', 'Сохранение…') : t('lore.sprintEditor.save', 'Сохранить')}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        {fieldRow(t('lore.sprintEditor.fields.sprintId', 'Sprint ID'), (
          <input
            style={S.input}
            value={form.sprint_id}
            placeholder={t('lore.sprintEditor.placeholders.sprintId', 'SPRINT_MY_FEATURE')}
            onChange={e => set('sprint_id')(e.target.value)}
          />
        ))}
        {fieldRow(t('lore.sprintEditor.fields.name', 'Название'), (
          <input
            style={S.input}
            value={form.name}
            placeholder={t('lore.sprintEditor.placeholders.name', 'Краткое название')}
            onChange={e => set('name')(e.target.value)}
          />
        ), 3)}
        {fieldRow(t('lore.sprintEditor.fields.status', 'Статус'), (
          <select style={S.input} value={form.status} onChange={e => set('status')(e.target.value)}>
            {SPRINT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ))}
        {fieldRow(t('lore.sprintEditor.fields.priority', 'Приоритет'), (
          <input style={S.input} value={form.priority} placeholder={t('lore.sprintEditor.placeholders.priority', 'high, critical…')}
            onChange={e => set('priority')(e.target.value)} />
        ))}
      </div>

      <Sec label={t('lore.sprintEditor.sections.context', 'Контекст — зачем этот спринт')}>
        <TipTapField
          value={form.context_md} onChange={v => set('context_md')(v)} minHeight={100}
          placeholder={t('lore.sprintEditor.placeholders.contextMd', 'Проблема, ограничения, связанные спринты/ADR…')}
          enableImages={false} enableHtmlMode={false}
        />
      </Sec>
      <Sec label={t('lore.sprintEditor.sections.outcome', 'Ожидаемый результат')}>
        <TipTapField
          value={form.outcome_md} onChange={v => set('outcome_md')(v)} minHeight={60}
          placeholder={t('lore.sprintEditor.placeholders.outcomeMd', 'Что должно получиться на выходе…')}
          enableImages={false} enableHtmlMode={false}
        />
      </Sec>

      <Sec label={t('lore.sprintEditor.sections.components', 'Компоненты (BELONGS_TO)')}>
        <MultiChip
          values={form.component_ids}
          onChange={set('component_ids')}
          suggestions={compList.map(c => c.id)}
          suggestionLabels={Object.fromEntries(compList.map(c => [c.id, c.label]))}
          placeholder={t('lore.sprintEditor.placeholders.components', 'HND, FE, …')}
          freeForm={false}
        />
      </Sec>
      <Sec label={t('lore.sprintEditor.sections.gitProjects', 'Git-проекты (BELONGS_TO_PROJECT)')}>
        <MultiChip
          values={form.git_projects}
          onChange={set('git_projects')}
          suggestions={projList.map(p => p.id)}
          suggestionLabels={Object.fromEntries(projList.map(p => [p.id, p.label]))}
          placeholder={t('lore.sprintEditor.placeholders.gitProjects', 'NooriUta/AIDA, …')}
          freeForm={false}
        />
      </Sec>
      <Sec label={t('lore.sprintEditor.sections.initialTasks', 'Начальные задачи (T01, T02… по порядку ввода)')}>
        <MultiChip
          values={form.initial_tasks}
          onChange={set('initial_tasks')}
          suggestions={[]}
          placeholder={t('lore.sprintEditor.placeholders.initialTasks', 'заголовок задачи, Enter…')}
          freeForm
        />
      </Sec>
    </div>
  );
}

function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sLabel}>{label}</div>
      {children}
    </div>
  );
}

// ── Styles — same tokens as LoreAdrEditor for visual consistency ──────────────
const S: Record<string, React.CSSProperties> = {
  root:     { flex: 1, overflowY: 'auto', padding: '14px 20px 40px', fontFamily: 'var(--font)', fontSize: 12 },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  title:    { fontSize: 14, fontWeight: 600, color: 'var(--t1)' },
  headBtns: { display: 'flex', gap: 8 },
  errBanner:{ marginBottom: 10, padding: '6px 10px', borderRadius: 5, fontSize: 11,
              background: 'color-mix(in srgb, var(--dng) 12%, transparent)',
              color: 'var(--dng)', border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)' },
  row4:     { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
  field:    { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 },
  label:    { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:    { height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid var(--b3)',
              background: 'var(--b1)', color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit',
              outline: 'none', width: '100%', boxSizing: 'border-box' },
  sLabel:   { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 },
  ta:       { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 4,
              border: '1px solid var(--b3)', background: 'var(--b1)', color: 'var(--t1)',
              fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.55, resize: 'vertical', outline: 'none' },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 12 },
};
