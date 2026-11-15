// Событие «запись обновлена» (SPRINT_UXR_S14_KIT5/K5-RECORD-UPDATED-EVENT).
//
// Слово владелицы 15.11.2026: когда паспорт правится или правится статус объекта, части, которая
// эту запись показывает, приходит событие обновления, и она обновляет свой элемент.
//
// Одна запись видна в нескольких местах сразу: строка списка, строка части в паспорте родителя,
// таблица связей. Источник правды — сервер: событие уходит ТОЛЬКО после того, как сервер принял
// запись (сохранение поля, смена статуса); отказ события не даёт, и элемент остаётся прежним.
//
// Приложение подписывается тем же `subscribeRecordUpdates`, если ему надо перечитать производное
// (итоги, вердикт родителя) — что именно, kit не знает (K-14).
import { useEffect, useMemo, useState } from 'react';
import type { KitData, KitRecord } from './contract';

/** Принятая сервером правка одной записи: поле (`status`, `title`, иначе — поле `fields`) и новое значение. */
export interface KitRecordUpdate { id: string; field: string; value: unknown }

type Listener = (e: KitRecordUpdate) => void;
const listeners = new Set<Listener>();

/** Сообщить всем местам, где видна запись: сервер принял правку. */
export function publishRecordUpdate(e: KitRecordUpdate): void {
  for (const l of [...listeners]) {
    try { l(e); } catch { /* сбой одного подписчика не отнимает событие у остальных */ }
  }
}

/** Подписка на принятые правки; возвращает отписку. */
export function subscribeRecordUpdates(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function apply(r: KitRecord, patch: Record<string, unknown>): KitRecord {
  const next: KitRecord = { ...r, fields: { ...r.fields } };
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'status') next.status = String(value ?? '');
    else if (field === 'title') next.title = String(value ?? '');
    else if (field === 'body_md') next.body_md = typeof value === 'string' ? value : undefined;
    else next.fields[field] = value;
  }
  return next;
}

/**
 * Данные с наложенными принятыми правками. Правка для записи, которой в данных нет, ничего не
 * добавляет. Пришли новые данные от приложения (перечитало) — они главнее, накопленное сбрасывается.
 */
export function usePatchedData(data: KitData): KitData {
  const [patches, setPatches] = useState<{ base: KitData; byId: Record<string, Record<string, unknown>> }>({ base: data, byId: {} });
  useEffect(() => subscribeRecordUpdates(e => {
    setPatches(p => {
      if (!p.base.records.some(r => r.id === e.id)) return p;
      return { base: p.base, byId: { ...p.byId, [e.id]: { ...(p.byId[e.id] ?? {}), [e.field]: e.value } } };
    });
  }), []);
  // Свежие данные — правки, накопленные по старым, не применяются.
  const byId = patches.base === data ? patches.byId : {};
  useEffect(() => {
    if (patches.base !== data) setPatches({ base: data, byId: {} });
  }, [data, patches.base]);
  return useMemo(() => {
    const ids = Object.keys(byId);
    if (ids.length === 0) return data;
    return { ...data, records: data.records.map(r => (byId[r.id] ? apply(r, byId[r.id]) : r)) };
  }, [data, byId]);
}
