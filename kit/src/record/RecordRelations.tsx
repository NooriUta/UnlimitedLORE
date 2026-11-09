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
import { RelationTable } from './RelationTable';

export const RELATION_MARK: Record<KitRelation, string> = {
  composition: '◆', aggregation: '◇', association: '⇢', attribute: '·', realization: '▷', generalization: '△',
};
/**
 * Название вида связи словами — подсказка у значка. Аудит 08.11 отметил «◆» у
 * вкладки «Задачи» как случайный глиф: сам значок осмысленный (вид связи из
 * модели), но молчащий.
 *
 * Вид связи приходит из модели, то есть может оказаться незнакомым. Тогда
 * подсказки нет вовсе — печатать ключ локали или выдумывать название хуже, чем
 * промолчать: значок останется без объяснения, но ничего ложного не скажет.
 */
export function relationName(lang: KitLang, relation: string): string | undefined {
  const key = `kit.record.relkind.${relation}` as 'kit.record.relkind.composition';
  const name = kitT(lang, key);
  return name === undefined || name === key ? undefined : name;
}

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

/**
 * Можно ли менять эту связь.
 *
 * Признак `manageable` от приложения главнее вида UML: путь привязки есть не у
 * каждой связи, и знает об этом только та сторона, что его предоставляет. Пока
 * правило было по виду, расходилось в обе стороны: у спринта `HAS_TASK` —
 * агрегация, и форма рисовалась без пути на сервере (человек получал
 * UNKNOWN_RELATION), а `DEPENDS_ON` — «зависимость», и управление скрывалось,
 * хотя путь есть.
 *
 * Признака нет — прежнее правило по виду: иначе конфиги, которые о нём не
 * знают, молча потеряли бы управление связями.
 */
const canManage = (def: KitRelationDef) =>
  def.manageable ?? (def.relation === 'aggregation' || def.relation === 'association');

function RelationGroup({ record, ctx, def, lang, onRelation, single }: {
  record: KitRecord; ctx: KitCtx; def: KitRelationDef; lang: KitLang; single: boolean;
  onRelation?: NonNullable<NonNullable<KitCtx['config']['hooks']>['onRelation']>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ids = relationTargets(record, ctx, def);
  const manage = onRelation && canManage(def);
  /**
   * Привязать или отвязать. Возвращает, получилось ли.
   *
   * Раньше вызов шёл через `void call(...)`, то есть отказ промиса
   * ВЫБРАСЫВАЛСЯ, а поле ввода очищалось сразу, до ответа. Снаружи это
   * выглядело как успех: поле опустело, строки нет — и человек заключал, что
   * ввёл не тот код, хотя сервер отказывал по одной и той же причине (путь
   * привязки может требовать прав или вовсе не существовать у этой связи).
   *
   * Молчаливый отказ хуже ошибки: ошибку читают и идут просить доступ, а
   * молчание заставляет перебирать варианты.
   */
  const call = async (target: string, action: 'add' | 'remove'): Promise<boolean> => {
    if (!onRelation) return false;
    setBusy(true);
    setFailed(null);
    try {
      await onRelation({ type: record.kind, id: record.id, rel: def.rel, dir: def.dir, target, action });
      return true;
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Связи — таблицей с общими колонками списка (замечание владелицы по
  // v1.17.4: «связи пока там, где я хотела бы видеть таблицы… наши любимые
  // общие колонки»). Пустую таблицу не рисуем: о пустоте говорим словами,
  // иначе одна шапка выглядит как «данные есть, но их не видно».
  const list = ids.length === 0
    ? <p className="sk-rel__empty" data-testid={single ? 'kit-relation-list' : undefined}>{kitT(lang, 'kit.record.rel.empty')}</p>
    : (
      <RelationTable
        ctx={ctx}
        lang={lang}
        ids={ids}
        onUnlink={manage ? (target: string) => void call(target, 'remove') : undefined}
        testId={single ? 'kit-relation-list' : undefined}
      />
    );
  const form = manage && (
    <form
      className="sk-rel__add"
      onSubmit={e => {
        e.preventDefault();
        const v = draft.trim();
        // Поле очищается ТОЛЬКО после удачи: иначе код, который не прошёл,
        // пришлось бы набирать заново — а он, скорее всего, верный.
        if (v) void call(v, 'add').then(ok => { if (ok) setDraft(''); });
      }}
    >
      <input type="text" value={draft} onChange={e => setDraft(e.target.value)} placeholder={kitT(lang, 'kit.record.rel.idPlaceholder')}
        aria-label={kitT(lang, 'kit.record.rel.link', { label: def.label })} />
      <button type="submit" className="sk-btn" disabled={busy}>{kitT(lang, 'kit.record.rel.linkBtn')}</button>
    </form>
  );
  // Причина отказа — словами и рядом с управлением, а не в консоли.
  const complaint = failed && (
    <p className="sk-rel__failed" role="alert">{kitT(lang, 'kit.record.rel.failed', { reason: failed })}</p>
  );
  if (single) return <div className="sk-rel" data-relation={def.relation}>{list}{form}{complaint}</div>;
  return (
    <section role="group" aria-label={def.label} className="sk-rel__group" data-relation={def.relation}>
      <h3 className="sk-rel__head"><span className="sk-rel__mark" aria-hidden="true">{RELATION_MARK[def.relation]}</span>{def.label}</h3>
      {list}{form}{complaint}
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
