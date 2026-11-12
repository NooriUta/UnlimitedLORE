// Выбор цели связи с поиском (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24). Владелица
// 11.11.2026: «где значения задаются рёбрами — dropdown, а не корректировка
// текста». Варианты даёт приложение хуком `relationOptions` (K-14: kit не знает,
// из каких срезов их брать); kit рисует поиск, найденное и честные состояния:
// ищем · ничего не нашлось · не загрузилось (причина + «Повторить»). Свободного
// ввода кода нет — привязать можно только найденное.
import { useEffect, useId, useState } from 'react';
import type { KitLang } from '../i18n';
import { kitT } from '../i18n';

export interface RelationOption { id: string; title?: string; type?: string; group?: string }
export type RelationOptionsHook = (c: { type: string; id: string; rel: string; dir: 'out' | 'in'; query: string }) => Promise<RelationOption[]>;

type State = { s: 'idle' } | { s: 'loading' } | { s: 'ok'; items: RelationOption[] } | { s: 'error'; reason: string };

/** Сколько найденного показывать — выбор, а не список всего корпуса. */
const SHOWN = 10;

export function RelationPicker({ lang, label, recordType, recordId, rel, dir, options, linked, busy, onPick }: {
  lang: KitLang; label: string; recordType: string; recordId: string; rel: string; dir: 'out' | 'in';
  options: RelationOptionsHook; linked: readonly string[]; busy: boolean; onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ s: 'idle' });
  const [seq, setSeq] = useState(0);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (!q) { setState({ s: 'idle' }); return; }
    let alive = true;
    setState({ s: 'loading' });
    options({ type: recordType, id: recordId, rel, dir, query: q }).then(
      items => { if (alive) setState({ s: 'ok', items }); },
      e => { if (alive) setState({ s: 'error', reason: e instanceof Error && e.message ? e.message : String(e) }); },
    );
    return () => { alive = false; };
  }, [query, seq, options, recordType, recordId, rel, dir]);

  const fresh = state.s === 'ok' ? state.items.filter(o => !linked.includes(o.id)) : [];
  return (
    <div className="sk-rel__pick">
      <input
        type="search"
        className="sk-rel__search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={kitT(lang, 'kit.record.rel.search')}
        aria-label={kitT(lang, 'kit.record.rel.link', { label })}
        aria-controls={listId}
      />
      <div id={listId}>
        {state.s === 'loading' && <p className="sk-rel__note" role="status">{kitT(lang, 'kit.record.rel.searching')}</p>}
        {state.s === 'error' && (
          <p className="sk-rel__failed" role="alert">
            {kitT(lang, 'kit.record.rel.optionsFailed', { reason: state.reason })}{' '}
            <button type="button" className="sk-btn" onClick={() => setSeq(n => n + 1)}>{kitT(lang, 'kit.state.error.retry')}</button>
          </p>
        )}
        {state.s === 'ok' && fresh.length === 0 && <p className="sk-rel__note" role="status">{kitT(lang, 'kit.record.rel.nothing', { q: query.trim() })}</p>}
        {fresh.length > 0 && (
          <ul className="sk-rel__found">
            {fresh.slice(0, SHOWN).map(o => (
              <li key={o.id} className="sk-rel__opt">
                <span className="sk-rel__optid">{o.id}</span>
                {o.title && o.title !== o.id && <span className="sk-rel__opttitle">{o.title}</span>}
                <button type="button" className="sk-btn" disabled={busy}
                  aria-label={kitT(lang, 'kit.record.rel.linkOne', { id: o.id })} onClick={() => onPick(o.id)}>
                  {kitT(lang, 'kit.record.rel.linkBtn')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {fresh.length > SHOWN && <p className="sk-rel__note">{kitT(lang, 'kit.record.rel.more', { n: fresh.length - SHOWN })}</p>}
      </div>
    </div>
  );
}
