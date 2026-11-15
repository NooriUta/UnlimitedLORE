// Связь-атрибут в «Свойствах» с правкой (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): компоненты,
// проекты. Владелица 11.11.2026: «не сделано редактирование множественного выбора
// привязок»; образец — v1 (LoreSprintDetail, toggleComp): по одному щелчку на значение,
// у чипа крестик снятия. Путь записи — hooks.onRelation (add/remove), найти новое —
// выбор с поиском (RelationPicker, hooks.relationOptions). Унаследованное значение
// (от спринта, от фичи) — не своё ребро: снять его отсюда нельзя, крестика нет.
import { useState } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { chipId, chipLabel, isChipList, toChips } from '../core/chipValue';
import { kitT, type KitLang } from '../i18n';
import { RelationPicker } from './RelationPicker';
import { ObjectMention } from '../elements/ObjectMention';

export function RelationField({ record, ctx, lang, label, value, rel, dir, view, refKind }: {
  record: KitRecord; ctx: KitCtx; lang: KitLang; label: string; value: unknown; rel: string; dir: 'out' | 'in'; view: React.ReactNode;
  /** K4-MENTION-LOOK: вид записей на другом конце — облик чипов. */
  refKind?: string;
}) {
  const onRelation = ctx.config.hooks?.onRelation;
  const options = ctx.config.hooks?.relationOptions;
  const can = ctx.config.roles?.[ctx.role ?? 'reader']?.canEdit ?? false;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!onRelation || !can) return <>{view}</>;

  const chips = isChipList(value) ? toChips(value)
    : (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value])
      .map(v => ({ id: String(v), label: String(v), inherited_from: null } as { id: string; label: string; inherited_from: null; kind?: string }));
  const own = chips.filter(c => !c.inherited_from);
  const inherited = chips.filter(c => c.inherited_from);

  const call = async (target: string, action: 'add' | 'remove') => {
    setBusy(true);
    setFailed(null);
    try {
      await onRelation({ type: record.kind, id: record.id, rel, dir, target, action });
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sk-relfield">
      <ul className="sk-relfield__chips">
        {own.map(c => (
          <li key={chipId(c)} className="sk-relfield__chip">
            <ObjectMention id={chipId(c)} kind={c.kind ?? refKind} href={ctx.href(chipId(c))} kinds={ctx.config.kinds}>{chipLabel(c)}</ObjectMention>
            <button type="button" className="sk-relfield__x" disabled={busy}
              aria-label={kitT(lang, 'kit.record.rel.unlink', { title: chipId(c) })} onClick={() => void call(chipId(c), 'remove')}>×</button>
          </li>
        ))}
        {inherited.map(c => (
          <li key={chipId(c)} className="sk-relfield__chip sk-relfield__chip--inherited" title={kitT(lang, 'kit.record.rel.inherited')}>
            <ObjectMention id={chipId(c)} kind={c.kind ?? refKind} href={ctx.href(chipId(c))} kinds={ctx.config.kinds}>{chipLabel(c)}</ObjectMention>
          </li>
        ))}
      </ul>
      {options && (
        <RelationPicker lang={lang} label={label} recordType={record.kind} recordId={record.id} rel={rel} dir={dir}
          options={options} linked={chips.map(chipId)} busy={busy} onPick={id => void call(id, 'add')} />
      )}
      {failed && <p className="sk-rel__failed" role="alert">{kitT(lang, 'kit.record.rel.failed', { reason: failed })}</p>}
    </div>
  );
}
