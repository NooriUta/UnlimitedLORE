// Общие мелочи каркаса записи (K-04): статус из конфига, вывод значения,
// ссылка на запись, «строка или узел» из render конфига.
import type { CSSProperties, ReactNode } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { toCssColor } from './graph';

/** Результат overview/render конфига: строка — это Markdown (через ctx.md). */
export function renderOut(out: ReactNode | string, ctx: KitCtx): ReactNode {
  return typeof out === 'string' ? ctx.md(out) : out;
}

/** Значение поля/журнала словами: пустое — «—», объект — JSON. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function findRecord(ctx: KitCtx, id: string): KitRecord | undefined {
  return ctx.data.records.find(r => r.id === id);
}

/** Пилюля статуса по config.statuses; кода нет в конфиге — код виден как есть. */
export function StatusPill({ code, ctx, unknownTitle }: { code: string; ctx: KitCtx; unknownTitle: string }) {
  // Пустой код или пустая ось — плашки нет вовсе (B5, аудит 10.11): «—» у типа
  // без статуса (релиз, компонент, технология) читалось как реальный статус
  // записи. Те же правила у StatusSlot, пиков и таблицы связей — они зовут эту
  // плашку напрямую, так что гард здесь закрывает всех.
  if (!code || !ctx.config.statuses?.items?.length) return null;
  const item = ctx.config.statuses.items.find(s => s.code === code);
  const style = { '--pill-c': item ? toCssColor(item.color) : 'var(--t3)' } as CSSProperties;
  return (
    <span className="sk-pill sk-pill--value sk-rec-status" style={style} data-status={code} data-known={item ? 'true' : 'false'}
      title={item ? undefined : unknownTitle}>
      {item && <GameIcon slug={item.icon} size={11} />}
      <span>{item ? item.title : code || '—'}</span>
    </span>
  );
}

/** Ссылка на запись: заголовок, если запись в выборке, иначе id. */
/**
 * Ссылка на запись: название и код.
 *
 * Код печатается ОДИН раз. У проекта и у многих компонентов название и есть
 * код (`NooriUta/UnlimitedLORE`), и прежняя пара «название + код» выводила один
 * и тот же текст дважды: в свойствах это выглядело как наложение подписей
 * (находка P0 аудита 08.11.2026), в «Связях» — как дубль («FORseti … FORseti»).
 * Правило общее: название показывается, только когда говорит что-то помимо
 * кода; сравнение — без учёта регистра и крайних пробелов.
 */
export function RecordRef({ id, ctx }: { id: string; ctx: KitCtx }) {
  const r = findRecord(ctx, id);
  const title = r?.title?.trim();
  const same = !!title && title.toLocaleLowerCase() === id.trim().toLocaleLowerCase();
  const head = title && !same ? title : id;
  return (
    <a className="sk-rec-ref" href={ctx.href(id)} data-missing={r ? undefined : 'true'}>
      <span className="sk-rec-ref__name">{head}</span>
      {r && !same && title && <span className="sk-pill sk-pill--id">{id}</span>}
    </a>
  );
}
