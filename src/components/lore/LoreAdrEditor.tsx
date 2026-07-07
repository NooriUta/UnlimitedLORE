import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createLoreAdr,
  fetchLoreSlice,
  type LoreAdrRow,
  type LoreComponent,
} from '../../api/lore';
import { adrStatusLabel } from './LoreAdrList';
import TipTapField from './TipTapField';

type AdrStatus = 'PROPOSED' | 'ACCEPTED' | 'DEPRECATED' | 'SUPERSEDED';
const ADR_STATUSES: AdrStatus[] = ['PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED'];
const STATUS_COLOR: Record<AdrStatus, string> = {
  PROPOSED:   'var(--inf)',
  ACCEPTED:   'var(--suc)',
  DEPRECATED: 'var(--wrn)',
  SUPERSEDED: 'var(--t3)',
};

interface FormState {
  adr_id: string;
  name: string;
  status: AdrStatus;
  date_created: string;
  context_md: string;
  decision_md: string;
  consequences_md: string;
  depends_on_ids: string[];
  supersedes_ids: string[];
  component_ids: string[];
  tags: string[];
}

export interface LoreAdrEditorProps {
  initial?: Partial<Omit<FormState, 'status'> & { status?: string }>;
  lockId?: boolean;
  onSaved: (adrId: string) => void;
  onCancel: () => void;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function LoreAdrEditor({ initial, lockId, onSaved, onCancel }: LoreAdrEditorProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>({
    adr_id:          initial?.adr_id          ?? '',
    name:            initial?.name            ?? '',
    status:          (initial?.status as AdrStatus | undefined) ?? 'PROPOSED',
    date_created:    initial?.date_created    ?? todayStr(),
    context_md:      initial?.context_md      ?? '',
    decision_md:     initial?.decision_md     ?? '',
    consequences_md: initial?.consequences_md ?? '',
    depends_on_ids:  initial?.depends_on_ids  ?? [],
    supersedes_ids:  initial?.supersedes_ids  ?? [],
    component_ids:   initial?.component_ids   ?? [],
    tags:            initial?.tags            ?? [],
  });

  const [saving, setSaving]     = useState(false);
  const [errMsg, setErrMsg]     = useState<string | null>(null);
  const [adrList, setAdrList]   = useState<string[]>([]);
  const [compList, setCompList] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    fetchLoreSlice<LoreAdrRow>('adrs')
      .then(rows => setAdrList(rows.map(r => r.adr_id)))
      .catch(() => {});
    fetchLoreSlice<LoreComponent>('components')
      .then(rows => setCompList(rows.map(r => ({ id: r.component_id, label: r.full_name || r.component_id }))))
      .catch(() => {});
  }, []);

  const set = <K extends keyof FormState>(key: K) => (v: FormState[K]) =>
    setForm(f => ({ ...f, [key]: v }));

  const handleSave = async () => {
    const id = form.adr_id.trim();
    const nm = form.name.trim();
    if (!id) { setErrMsg(t('lore.adrEditor.errIdRequired', 'ADR ID обязателен')); return; }
    if (!nm) { setErrMsg(t('lore.adrEditor.errNameRequired', 'Название обязательно')); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await createLoreAdr({
        adr_id: id, name: nm,
        status:          form.status          || undefined,
        date_created:    form.date_created    || undefined,
        context_md:      form.context_md      || undefined,
        decision_md:     form.decision_md     || undefined,
        consequences_md: form.consequences_md || undefined,
        depends_on_ids:  form.depends_on_ids,
        supersedes_ids:  form.supersedes_ids,
        component_ids:   form.component_ids,
        tags:            form.tags,
      });
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

  // ADR bodies are substantial prose — give the editor real room on open
  // (T28: fields were only ~100px and felt cramped). Resizable via TipTapField.
  const ta = (key: 'context_md' | 'decision_md' | 'consequences_md', placeholder: string, rows = 13) => (
    <TipTapField
      value={form[key]}
      onChange={v => set(key)(v)}
      placeholder={placeholder}
      minHeight={rows * 20}
      enableImages={false}
      enableHtmlMode={false}
    />
  );

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.head}>
        <span style={S.title}>{lockId ? t('lore.adrEditor.editingTitle', 'Редактирование {{id}}', { id: form.adr_id }) : t('lore.adrEditor.newTitle', 'Новый ADR')}</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>{t('lore.adrEditor.cancel', 'Отмена')}</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? t('lore.adrEditor.saving', 'Сохранение…') : t('lore.adrEditor.save', 'Сохранить')}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      {/* Row 1: ID · Name · Status · Date */}
      <div style={S.row4}>
        {fieldRow(t('lore.adrEditor.fieldAdrId', 'ADR ID'), (
          <input
            style={{ ...S.input, ...(lockId ? S.inputLock : {}) }}
            value={form.adr_id}
            readOnly={lockId}
            placeholder="ADR-HND-042"
            onChange={e => set('adr_id')(e.target.value)}
          />
        ))}
        {fieldRow(t('lore.adrEditor.fieldName', 'Название'), (
          <input
            style={S.input}
            value={form.name}
            placeholder={t('lore.adrEditor.namePlaceholder', 'Краткое название решения')}
            onChange={e => set('name')(e.target.value)}
          />
        ), 3)}
        {fieldRow(t('lore.adrEditor.fieldStatus', 'Статус'), (
          <select
            style={{ ...S.input, color: STATUS_COLOR[form.status] }}
            value={form.status}
            onChange={e => set('status')(e.target.value as AdrStatus)}
          >
            {ADR_STATUSES.map(s => (
              <option key={s} value={s} style={{ color: STATUS_COLOR[s] }}>{adrStatusLabel(t, s)}</option>
            ))}
          </select>
        ))}
        {fieldRow(t('lore.adrEditor.fieldDate', 'Дата'), (
          <input style={S.input} type="date" value={form.date_created}
            onChange={e => set('date_created')(e.target.value)} />
        ))}
      </div>

      {/* Markdown sections */}
      <Sec label={t('lore.adrEditor.sectionContext', 'Context — почему это решение нужно')}>{ta('context_md', t('lore.adrEditor.contextPlaceholder', 'Опишите проблему, ограничения, исходные данные…'))}</Sec>
      <Sec label={t('lore.adrEditor.sectionDecision', 'Decision — что именно решили')}>{ta('decision_md', t('lore.adrEditor.decisionPlaceholder', 'Опишите принятое решение…'))}</Sec>
      <Sec label={t('lore.adrEditor.sectionConsequences', 'Consequences — следствия и trade-offs')}>{ta('consequences_md', t('lore.adrEditor.consequencesPlaceholder', 'Положительные и отрицательные последствия…'), 9)}</Sec>

      {/* Relations */}
      <Sec label={t('lore.adrEditor.sectionDependsOn', 'Зависит от других ADR (DEPENDS_ON)')}>
        <MultiChip
          values={form.depends_on_ids}
          onChange={set('depends_on_ids')}
          suggestions={adrList.filter(id => id !== form.adr_id)}
          placeholder={t('lore.multiChip.adrIdPlaceholder', 'ADR-XXX-NNN…')}
          freeForm={false}
        />
      </Sec>
      <Sec label={t('lore.adrEditor.sectionSupersedes', 'Заменяет ADR (SUPERSEDES)')}>
        <MultiChip
          values={form.supersedes_ids}
          onChange={set('supersedes_ids')}
          suggestions={adrList.filter(id => id !== form.adr_id)}
          placeholder={t('lore.multiChip.adrIdPlaceholder', 'ADR-XXX-NNN…')}
          freeForm={false}
        />
      </Sec>
      <Sec label={t('lore.adrEditor.sectionComponents', 'Модули / компоненты (BELONGS_TO)')}>
        <MultiChip
          values={form.component_ids}
          onChange={set('component_ids')}
          suggestions={compList.map(c => c.id)}
          suggestionLabels={Object.fromEntries(compList.map(c => [c.id, c.label]))}
          placeholder={t('lore.multiChip.componentPlaceholder', 'HND, FE, …')}
          freeForm={false}
        />
      </Sec>
      <Sec label={t('lore.adrEditor.sectionTags', 'Теги')}>
        <MultiChip
          values={form.tags}
          onChange={set('tags')}
          suggestions={[]}
          placeholder={t('lore.multiChip.tagPlaceholder', 'тег, Enter…')}
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

// ── MultiChip — inline chip input with typeahead ──────────────────────────────
// Exported for reuse by other LORE editor forms (e.g. LoreSprintEditor).
export interface MultiChipProps {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  suggestionLabels?: Record<string, string>;
  placeholder: string;
  freeForm: boolean;
}

export function MultiChip({ values, onChange, suggestions, suggestionLabels, placeholder, freeForm }: MultiChipProps) {
  const [input, setInput]   = useState('');
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref                 = useRef<HTMLInputElement>(null);

  const filtered = suggestions.filter(
    s => !values.includes(s) && (input ? s.toLowerCase().includes(input.toLowerCase()) : true)
  ).slice(0, 10);

  const add = (v: string) => {
    const t = v.trim();
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
    setInput(''); setCursor(0); setOpen(false);
  };

  const remove = (v: string) => onChange(values.filter(x => x !== v));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (open && filtered[cursor]) { add(filtered[cursor]); return; }
      if (freeForm && input.trim()) { add(input); }
    } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div style={MC.wrap} onClick={() => ref.current?.focus()}>
      <div style={MC.chipRow}>
        {values.map(v => (
          <span key={v} style={MC.chip}>
            <span style={MC.chipTxt}>{v}</span>
            <button style={MC.del} onClick={e => { e.stopPropagation(); remove(v); }}>×</button>
          </span>
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 120 }}>
          <input
            ref={ref}
            style={MC.input}
            value={input}
            placeholder={values.length ? '' : placeholder}
            onChange={e => { setInput(e.target.value); setOpen(true); setCursor(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
          />
          {open && filtered.length > 0 && (
            <div style={MC.dropdown}>
              {filtered.map((s, i) => (
                <div
                  key={s}
                  style={{ ...MC.dropItem, background: i === cursor ? 'var(--b3)' : 'transparent' }}
                  onMouseDown={() => add(s)}
                  onMouseEnter={() => setCursor(i)}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s}</span>
                  {suggestionLabels?.[s] && (
                    <span style={{ color: 'var(--t3)', fontSize: 10, marginLeft: 6 }}>{suggestionLabels[s]}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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
  inputLock:{ opacity: 0.55, cursor: 'not-allowed', background: 'var(--b2)' },
  sLabel:   { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 },
  ta:       { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 4,
              border: '1px solid var(--b3)', background: 'var(--b1)', color: 'var(--t1)',
              fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.55, resize: 'vertical', outline: 'none' },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 12 },
};

const MC: Record<string, React.CSSProperties> = {
  wrap:    { border: '1px solid var(--b3)', borderRadius: 5, background: 'var(--b1)',
             padding: '4px 6px', cursor: 'text', minHeight: 34 },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  chip:    { display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 3,
             background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
             color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
             padding: '1px 4px', fontSize: 11 },
  chipTxt: { fontFamily: 'var(--mono)' },
  del:     { background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
             fontSize: 13, lineHeight: 1, padding: '0 1px', opacity: 0.7 },
  input:   { border: 'none', background: 'transparent', outline: 'none', color: 'var(--t1)',
             fontSize: 12, fontFamily: 'inherit', width: '100%', padding: '2px 2px' },
  dropdown:{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
             background: 'var(--b2)', border: '1px solid var(--b3)', borderRadius: 4,
             boxShadow: '0 4px 12px rgba(0,0,0,.25)', maxHeight: 200, overflowY: 'auto' },
  dropItem:{ padding: '5px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center' },
};
