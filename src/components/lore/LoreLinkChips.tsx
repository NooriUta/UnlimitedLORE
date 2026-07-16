import { GameIcon } from './GameIcon';
import { areaColor } from './LoreComponentList';

// T43: multi-link editor styled like the Sprint «Модули» picker — chips (with
// game-icons when meta is supplied) + a «+ привязать…» dropdown. Presentational
// + controlled: the caller owns the add/remove side effects and reload.

export interface LinkMeta { game_icon?: string | null; area?: string | null; full_name?: string | null }

interface Props {
  label: string;
  values: string[];            // currently linked ids/slugs
  options: string[];           // all candidates
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  color?: string;
  disabled?: boolean;          // e.g. while the parent entity doesn't exist yet
  /** id → {game_icon, area, full_name}. When present, chips render a module icon (like Спринты). */
  meta?: Record<string, LinkMeta>;
}

export function LoreLinkChips({ label, values, options, onAdd, onRemove, color = 'var(--acc)', disabled, meta }: Props) {
  const unlinked = options.filter(o => !values.includes(o));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--t3)', width: 92, flexShrink: 0 }}>
        {label}
      </span>
      {values.map(v => {
        const m = meta?.[v];
        const col = m ? areaColor(m.area ?? '') : color;
        return (
          <span key={v} title={m?.full_name ?? v} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', padding: '1px 4px 1px 6px',
            borderRadius: 999, border: `1px solid color-mix(in srgb, ${col} 40%, var(--bd))`,
            background: `color-mix(in srgb, ${col} 10%, transparent)`, color: 'var(--t1)',
          }}>
            {m && <GameIcon slug={m.game_icon ?? 'cog'} size={12} style={{ color: col }} />}
            {v}
            <button type="button" onClick={() => onRemove(v)} disabled={disabled}
              style={{ background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', color: 'var(--t3)', padding: 0, fontSize: 'var(--fs-sm)' }}>✕</button>
          </span>
        );
      })}
      {!disabled && unlinked.length > 0 && (
        <select
          value=""
          onChange={e => { const v = e.target.value; if (v) onAdd(v); e.currentTarget.value = ''; }}
          style={{ fontSize: 'var(--fs-sm)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t3)', cursor: 'pointer' }}
        >
          <option value="">+ привязать…</option>
          {unlinked.map(o => <option key={o} value={o}>{meta?.[o]?.full_name ? `${o} — ${meta[o].full_name}` : o}</option>)}
        </select>
      )}
      {disabled && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>сохраните, чтобы связать</span>}
    </div>
  );
}
