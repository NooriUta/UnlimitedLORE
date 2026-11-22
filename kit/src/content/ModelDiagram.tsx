// Кубик «Схема модели» (SPRINT_UXR_S15_KIT6; LORE 22.11.2026 — вкладка «Схема» в «Модели» админки; GLADSHEIM —
// глава «Модель»). Вход — документ model/0 как пришёл; рисует MartProse (Mermaid erDiagram, раскладка ELK).
// Разрез по умолчанию — вид с соседями на шаг; группы меню документа — готовые наборы; вся модель — по нажатию,
// с честной пометкой «большая». Под схемой — статусы выбранного вида и куда из каждого можно перейти.
// «Пусто» честно: модель не пришла / не разобралась / видов нет — словами, а не пустой рамкой.
import { useMemo, useState } from 'react';
import { MartProse } from './MartProse';
import { kitT, useKitLangCode } from '../i18n';
import { modelErText, modelGraph, modelSlices, sliceKinds } from '../model/modelDiagram';

type Mode = { kind: 'focus' } | { kind: 'slice'; id: string } | { kind: 'all' };

export function ModelDiagram({ model, t, focus: focusProp, onFocus }: {
  /** Документ модели; null — не пришёл; Error — не разобрался (причина словами). */
  model: unknown | null | Error;
  /** Подписи групп меню по label_key — переводит приложение. */
  t?: (key: string) => string | undefined;
  focus?: string | null;
  onFocus?: (kind: string) => void;
}) {
  const lang = useKitLangCode();
  const g = useMemo(() => (model && !(model instanceof Error) ? modelGraph(model) : null), [model]);
  const slices = useMemo(() => (model && !(model instanceof Error) ? modelSlices(model, t) : []), [model, t]);
  const [own, setOwn] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'focus' });
  if (model === null) return <p className="sk-mdiag__empty" role="status">{kitT(lang, 'kit.model.none')}</p>;
  if (model instanceof Error) return <p className="sk-mdiag__empty is-bad" role="status">{kitT(lang, 'kit.model.bad', { why: model.message })}</p>;
  if (!g || g.kinds.length === 0) return <p className="sk-mdiag__empty" role="status">{kitT(lang, 'kit.model.noKinds')}</p>;

  const focus = (focusProp ?? own) && g.kinds.some((k) => k.id === (focusProp ?? own)) ? (focusProp ?? own)! : g.kinds[0].id;
  const pick = (k: string) => { setOwn(k); onFocus?.(k); setMode({ kind: 'focus' }); };
  const kinds = mode.kind === 'focus' ? sliceKinds(g, { focus })
    : mode.kind === 'slice' ? sliceKinds(g, { kinds: slices.find((s) => s.id === mode.id)?.kinds ?? [] }) : sliceKinds(g, {});
  const er = modelErText(g, kinds);
  const fk = g.kinds.find((k) => k.id === focus)!;
  const title = (code: string) => fk.statuses.find((s) => s.code === code)?.title ?? code;

  return (
    <div className="sk-mdiag">
      <div className="sk-mdiag__bar" role="group" aria-label={kitT(lang, 'kit.model.slice')}>
        <label className="sk-mdiag__pick">{kitT(lang, 'kit.model.focus')}
          <select className="sk-btn" value={focus} onChange={(e) => pick(e.target.value)}>
            {g.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <button type="button" className="sk-btn" aria-pressed={mode.kind === 'focus'} onClick={() => setMode({ kind: 'focus' })}>
          {kitT(lang, 'kit.model.withNeighbours')}</button>
        {slices.map((s) => <button key={s.id} type="button" className="sk-btn" aria-pressed={mode.kind === 'slice' && mode.id === s.id}
          onClick={() => setMode({ kind: 'slice', id: s.id })}>{s.label}</button>)}
        <button type="button" className="sk-btn" aria-pressed={mode.kind === 'all'} onClick={() => setMode({ kind: 'all' })}>
          {kitT(lang, 'kit.model.all', { n: g.kinds.length })}</button>
      </div>
      {mode.kind === 'all' && g.kinds.length > 12 && <p className="sk-mdiag__note">{kitT(lang, 'kit.model.allBig', { n: g.kinds.length })}</p>}
      <div className="sk-mdiag__er">
        <MartProse text={'```mermaid\n---\nconfig:\n  layout: elk\n  er:\n    useMaxWidth: false\n---\n' + er + '\n```'} />
      </div>
      {g.dangling.length > 0 && <p className="sk-mdiag__note">{kitT(lang, 'kit.model.dangling', { list: g.dangling
        .map((d) => `${g.kinds.find((k) => k.id === d.from)?.label ?? d.from} → ${d.rel} (${d.label})`).join(' · ') })}</p>}
      <div className="sk-mdiag__st">
        <div className="sk-mdiag__h">{kitT(lang, 'kit.model.statuses', { kind: fk.label })}</div>
        {fk.statuses.length === 0 ? <p className="sk-mdiag__note">{kitT(lang, 'kit.model.noStatuses')}</p> : (
          <table className="sk-mdiag__tbl">
            <thead><tr><th>{kitT(lang, 'kit.model.status')}</th><th>{kitT(lang, 'kit.model.category')}</th><th>{kitT(lang, 'kit.model.next')}</th></tr></thead>
            <tbody>{fk.statuses.map((s) => (
              <tr key={s.code}><td>{s.title} <code>{s.code}</code></td><td>{s.category}</td>
                <td>{s.allow === null ? kitT(lang, 'kit.model.nextUnknown') : s.allow.length ? s.allow.map(title).join(' · ') : kitT(lang, 'kit.model.nextNone')}</td></tr>))}
            </tbody>
          </table>)}
      </div>
    </div>
  );
}
