// Связи записи по видам UML (D-2026-LORE-RECORD-RELATION-UML; владелица 08.11: «сделать в паспорте
// классификации и возможность управления и визуализации от этих типов связей»).
// Kit не знает типов записей: вид связи, ребро и направление приходят в KindConfig.relations.
//  composition ◆ — дочки (спринт → задачи): своя вкладка; отвязать нельзя — дочь без родителя не живёт;
//  aggregation ◇ — легче (ADR → решения, вопросы): своя вкладка; привязать / отвязать;
//  association ⇢ — (владелица: «просто ассоциация — это зависимости») одна вкладка «Зависимости»,
//    разделами по направлению («зависит от» / «блокирует»); привязать / отвязать;
//  attribute — поля-ссылки (компонент, проект, теги, роли…): их рисуют «Свойства», не вкладка;
//  realization ▷ — одна вкладка «Реализация»; только чтение;
//  generalization — строкой в шапке («Заменяет X»), не вкладкой.
// Управление — только через hooks.onRelation и только при праве править: запись идёт путём приложения.
import { useState } from 'react';
import type { KitCtx, KitRecord, KitRelation, KitRelationDef } from '../core/contract';
import { kitT, type KitLang } from '../i18n';
import { RecordRef } from './fmt';

export const RELATION_MARK: Record<KitRelation, string> = {
  composition: '◆', aggregation: '◇', association: '⇢', attribute: '·', realization: '▷', generalization: '△',
};
/** Виды, которые kit рисует отдельной вкладкой на каждую связь. */
export const OWN_TAB: readonly KitRelation[] = ['composition', 'aggregation'];
/** Виды, сведённые в одну общую вкладку: id вкладки и ключ подписи. */
export const SHARED_TAB: Partial<Record<KitRelation, { id: string; label: 'kit.record.rel.deps' | 'kit.record.rel.realization' }>> = {
  association: { id: 'rel:association', label: 'kit.record.rel.deps' },
  realization: { id: 'rel:realization', label: 'kit.record.rel.realization' },
};

/** Записи по другую сторону ребра. */
export function relationTargets(record: KitRecord, ctx: KitCtx, def: KitRelationDef): string[] {
  return ctx.data.edges
    .filter(e => e.type === def.rel && (def.dir === 'out' ? e.from === record.id : e.to === record.id))
    .map(e => (def.dir === 'out' ? e.to : e.from));
}

const canManage = (def: KitRelationDef) => def.relation === 'aggregation' || def.relation === 'association';

function RelationGroup({ record, ctx, def, lang, onRelation, single }: {
  record: KitRecord; ctx: KitCtx; def: KitRelationDef; lang: KitLang; single: boolean;
  onRelation?: NonNullable<NonNullable<KitCtx['config']['hooks']>['onRelation']>;
}) {
  const [draft, setDraft] = useState('');
  const ids = relationTargets(record, ctx, def);
  const byId = new Map(ctx.data.records.map(x => [x.id, x]));
  const manage = onRelation && canManage(def);
  const call = (target: string, action: 'add' | 'remove') => onRelation?.({ type: record.kind, id: record.id, rel: def.rel, dir: def.dir, target, action });
  const list = (
    <ul className="sk-rel__list" data-testid={single ? 'kit-relation-list' : undefined}>
      {ids.length === 0 && <li className="sk-rel__empty">{kitT(lang, 'kit.record.rel.empty')}</li>}
      {ids.map(id => (
        <li key={id} className="sk-rel__item" data-record-id={id}>
          <span className="sk-rel__mark" data-relation-mark aria-hidden="true">{RELATION_MARK[def.relation]}</span>
          <RecordRef id={id} ctx={ctx} />
          {manage && (
            <button type="button" className="sk-rel__unlink" onClick={() => void call(id, 'remove')}
              aria-label={kitT(lang, 'kit.record.rel.unlink', { title: byId.get(id)?.title ?? id })}>×</button>
          )}
        </li>
      ))}
    </ul>
  );
  const form = manage && (
    <form className="sk-rel__add" onSubmit={e => { e.preventDefault(); const v = draft.trim(); if (v) { void call(v, 'add'); setDraft(''); } }}>
      <input type="text" value={draft} onChange={e => setDraft(e.target.value)} placeholder={kitT(lang, 'kit.record.rel.idPlaceholder')}
        aria-label={kitT(lang, 'kit.record.rel.link', { label: def.label })} />
      <button type="submit" className="sk-btn">{kitT(lang, 'kit.record.rel.linkBtn')}</button>
    </form>
  );
  if (single) return <div className="sk-rel" data-relation={def.relation}>{list}{form}</div>;
  return (
    <section role="group" aria-label={def.label} className="sk-rel__group" data-relation={def.relation}>
      <h3 className="sk-rel__head"><span className="sk-rel__mark" aria-hidden="true">{RELATION_MARK[def.relation]}</span>{def.label}</h3>
      {list}{form}
    </section>
  );
}

/** Панель вкладки связей: одна связь (композиция / агрегация) или общая вкладка с разделами. */
export function RecordRelations({ record, ctx, defs, lang }: { record: KitRecord; ctx: KitCtx; defs: KitRelationDef[]; lang: KitLang }) {
  const can = ctx.config.roles?.[ctx.role ?? 'reader']?.canEdit ?? false;
  const onRelation = can ? ctx.config.hooks?.onRelation : undefined;
  if (defs.length === 1) return <RelationGroup record={record} ctx={ctx} def={defs[0]} lang={lang} onRelation={onRelation} single />;
  return <div className="sk-rel__groups">{defs.map(d => <RelationGroup key={d.key} record={record} ctx={ctx} def={d} lang={lang} onRelation={onRelation} single={false} />)}</div>;
}

/** Обобщение — строкой в шапке: «Заменяет: X». */
export function RelationLines({ record, ctx, defs }: { record: KitRecord; ctx: KitCtx; defs: KitRelationDef[] }) {
  const lines = defs.filter(d => d.relation === 'generalization').map(d => ({ d, ids: relationTargets(record, ctx, d) })).filter(x => x.ids.length);
  if (!lines.length) return null;
  return (
    <>
      {lines.map(({ d, ids }) => (
        <p key={d.key} className="sk-rel__line" data-relation-line={d.relation}>
          <span className="sk-rel__mark" aria-hidden="true">{RELATION_MARK[d.relation]}</span>
          <span className="sk-rel__linelabel">{d.label}:</span> {ids.map(id => <RecordRef key={id} id={id} ctx={ctx} />)}
        </p>
      ))}
    </>
  );
}
