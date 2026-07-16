import { useState } from 'react';

// T43: a small multi-link editor — current links as removable chips + a
// datalist input to add. Used for the multi component / multi project pickers
// on questions and decisions (backed by the /…/component and /…/project
// add/remove endpoints). Presentational + controlled: the caller owns the
// add/remove side effects and reload.

interface Props {
  label: string;
  values: string[];            // currently linked ids/slugs
  options: string[];           // all candidates (for the datalist)
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  listId: string;              // unique datalist id
  color?: string;
  disabled?: boolean;          // e.g. while the parent entity doesn't exist yet
}

export function LoreLinkChips({ label, values, options, onAdd, onRemove, listId, color = 'var(--acc)', disabled }: Props) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onAdd(v);
    setDraft('');
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--t3)', width: 92, flexShrink: 0 }}>
        {label}
      </span>
      {values.map(v => (
        <span key={v} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', padding: '1px 4px 1px 7px',
          borderRadius: 999, border: `1px solid color-mix(in srgb, ${color} 40%, var(--bd))`,
          background: `color-mix(in srgb, ${color} 10%, transparent)`, color: 'var(--t1)',
        }}>
          {v}
          <button type="button" onClick={() => onRemove(v)} disabled={disabled}
            style={{ background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', color: 'var(--t3)', padding: 0, fontSize: 'var(--fs-sm)' }}>✕</button>
        </span>
      ))}
      {!disabled && (
        <>
          <input list={listId} value={draft} placeholder="+ добавить"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            onBlur={add}
            style={{ fontSize: 'var(--fs-sm)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', width: 120 }} />
          <datalist id={listId}>
            {options.filter(o => !values.includes(o)).map(o => <option key={o} value={o} />)}
          </datalist>
        </>
      )}
      {disabled && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>сохраните, чтобы связать</span>}
    </div>
  );
}
