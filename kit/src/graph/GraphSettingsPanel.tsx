// Левая панель графа (GC-03) — разделы и шкалы как у панели графа Обсидиана
// (владелица: «левое меню с настройками возьми у обсидиан», «бери пока из
// обсидиан»): Фильтры, Группы, Отображение, Силы. Каждый раздел сворачивается.
import { useId, type CSSProperties } from 'react';
import { kitT, type KitLang } from '../i18n';
import {
  GX_DEFAULTS, GX_GROUP_COLORS, GX_RANGES, type GxSettings, type GxStyle,
} from './settings';
import { toCssColor } from '../record/graph';

interface Props {
  lang: KitLang;
  settings: GxSettings;
  onChange: (s: GxSettings) => void;
  /** Типы узлов, что есть в данных: подпись, цвет и сколько узлов. */
  types: { key: string; style: GxStyle; count: number }[];
}

type RangeKey = keyof typeof GX_RANGES;

function Slider({ k, lang, s, onChange }: { k: RangeKey; lang: KitLang; s: GxSettings; onChange: (s: GxSettings) => void }) {
  const id = useId();
  const [lo, hi, step] = GX_RANGES[k];
  const v = s[k];
  return (
    <div className="sk-gx-panel__row">
      <label htmlFor={id}>{kitT(lang, `kit.graph.${k}` as Parameters<typeof kitT>[1])}</label>
      <input id={id} type="range" min={lo} max={hi} step={step} value={v}
        onChange={e => onChange({ ...s, [k]: Number(e.target.value) })} />
      <output htmlFor={id} className="sk-gx-panel__val">{Number.isInteger(step) ? v : v.toFixed(2)}</output>
    </div>
  );
}

export function GraphSettingsPanel({ lang, settings: s, onChange, types }: Props) {
  const searchId = useId();
  const hidden = new Set(s.hiddenTypes);
  const toggleType = (t: string) =>
    onChange({ ...s, hiddenTypes: hidden.has(t) ? s.hiddenTypes.filter(x => x !== t) : [...s.hiddenTypes, t] });
  const setGroup = (i: number, patch: Partial<GxSettings['groups'][number]>) =>
    onChange({ ...s, groups: s.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  return (
    <aside className="sk-gx-panel" aria-label={kitT(lang, 'kit.graph.settings')} data-testid="sk-gx-panel">
      <details open className="sk-gx-panel__sec">
        <summary>{kitT(lang, 'kit.graph.filters')}</summary>
        <div className="sk-gx-panel__row sk-gx-panel__row--wide">
          <label htmlFor={searchId} className="sk-sr">{kitT(lang, 'kit.graph.search')}</label>
          <input id={searchId} type="search" className="sk-gx-panel__input" value={s.search}
            placeholder={kitT(lang, 'kit.graph.searchHint')}
            onChange={e => onChange({ ...s, search: e.target.value })} />
        </div>
        <ul className="sk-gx-panel__types">
          {types.map(t => (
            <li key={t.key}>
              <label className="sk-gx-panel__check">
                <input type="checkbox" checked={!hidden.has(t.key)} onChange={() => toggleType(t.key)} />
                <span className="sk-gx-dot" aria-hidden="true" style={{ '--gx-c': toCssColor(t.style.color) } as CSSProperties} />
                <span>{t.style.label}</span>
                <span className="sk-gx-panel__count">{t.count}</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="sk-gx-panel__check">
          <input type="checkbox" checked={s.orphans} onChange={() => onChange({ ...s, orphans: !s.orphans })} />
          <span>{kitT(lang, 'kit.graph.orphans')}</span>
        </label>
      </details>

      <details open className="sk-gx-panel__sec">
        <summary>{kitT(lang, 'kit.graph.groups')}</summary>
        {s.groups.length === 0 && <p className="sk-gx-panel__hint">{kitT(lang, 'kit.graph.groupsHint')}</p>}
        <ul className="sk-gx-panel__groups">
          {s.groups.map((g, i) => (
            <li key={i} className="sk-gx-panel__group">
              <input type="text" className="sk-gx-panel__input" value={g.query} aria-label={kitT(lang, 'kit.graph.groupQuery')}
                placeholder={kitT(lang, 'kit.graph.groupQueryHint')} onChange={e => setGroup(i, { query: e.target.value })} />
              <div className="sk-gx-panel__swatches" role="radiogroup" aria-label={kitT(lang, 'kit.graph.groupColor')}>
                {GX_GROUP_COLORS.map(c => (
                  <button key={c} type="button" role="radio" aria-checked={g.color === c} aria-label={c}
                    className="sk-gx-swatch" style={{ '--gx-c': `var(${c})` } as CSSProperties}
                    onClick={() => setGroup(i, { color: c })} />
                ))}
              </div>
              <button type="button" className="sk-btn sk-gx__ghost" aria-label={kitT(lang, 'kit.graph.groupRemove')}
                onClick={() => onChange({ ...s, groups: s.groups.filter((_, j) => j !== i) })}>×</button>
            </li>
          ))}
        </ul>
        <button type="button" className="sk-btn" onClick={() =>
          onChange({ ...s, groups: [...s.groups, { query: '', color: GX_GROUP_COLORS[s.groups.length % GX_GROUP_COLORS.length] }] })}>
          {kitT(lang, 'kit.graph.groupAdd')}
        </button>
      </details>

      <details open className="sk-gx-panel__sec">
        <summary>{kitT(lang, 'kit.graph.display')}</summary>
        <label className="sk-gx-panel__check">
          <input type="checkbox" checked={s.arrows} onChange={() => onChange({ ...s, arrows: !s.arrows })} />
          <span>{kitT(lang, 'kit.graph.arrows')}</span>
        </label>
        <Slider k="labels" lang={lang} s={s} onChange={onChange} />
        <Slider k="nodeSize" lang={lang} s={s} onChange={onChange} />
        <Slider k="linkWidth" lang={lang} s={s} onChange={onChange} />
      </details>

      <details open className="sk-gx-panel__sec">
        <summary>{kitT(lang, 'kit.graph.forces')}</summary>
        <Slider k="center" lang={lang} s={s} onChange={onChange} />
        <Slider k="repel" lang={lang} s={s} onChange={onChange} />
        <Slider k="linkForce" lang={lang} s={s} onChange={onChange} />
        <Slider k="linkDistance" lang={lang} s={s} onChange={onChange} />
      </details>

      <button type="button" className="sk-btn sk-gx-panel__reset"
        onClick={() => onChange({ ...GX_DEFAULTS, hiddenTypes: [], groups: [] })}>
        {kitT(lang, 'kit.graph.reset')}
      </button>
    </aside>
  );
}
