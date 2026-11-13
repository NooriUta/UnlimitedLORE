// Состояние данных записи — в общий сборщик warnings (MP2-08).
//
// Прежде блок «Состояние данных» стоял В ПОТОКЕ над содержимым паспорта
// (S4-30) и занимал верх записи — ровно там, где человек ищет шапку; на
// телефоне он съедал первый экран. Владелица 13.11.2026: технические
// сообщения убрать из компоновки и собрать под значок warnings с попапом.
//
// Правило честных состояний при этом не отменяется: сообщения никуда не
// деваются — они уходят в значок «⚠ N», который стоит в строке над записью и
// виден, пока есть что сказать. Без сборщика (витрина kit, тесты RecordView)
// блок рисуется прежним видом: молчать о неполноте данных нельзя нигде.
import { useMemo } from 'react';
import type { KitMeta } from '../core/contract';
import { kitT, useKitLang } from '../i18n';
import { useShowTech } from '../resilience/techGate';
import { DataStateBlock } from './DataStateBlock';
import { dataStateOf } from './dataState';
import { useWarningsSource, type WarningItem } from './warnings';

export interface DataStateWarningsProps {
  meta: KitMeta;
  className?: string;
}

type T = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => string;

/** Строки одного адресата — те же, что печатал блок «Состояние данных». */
function rowsOf(s: ReturnType<typeof dataStateOf>, t: T): WarningItem[] {
  const out: WarningItem[] = [];
  for (const f of s.failed) out.push({ source: f.block, label: t('kit.ds.failed'), text: f.reason, tone: 'dng' });
  for (const f of s.forbidden) out.push({ source: f.block, label: t('kit.ds.forbidden'), text: f.reason, tone: 'wrn' });
  for (const b of s.truncatedBlocks) out.push({ source: b, label: t('kit.ds.truncated'), text: t('kit.ds.techTruncated'), tone: 'wrn' });
  if (s.truncated) {
    const text = s.truncated.total !== undefined
      ? t('kit.ds.shownOf', { n: s.truncated.returned ?? 0, total: s.truncated.total })
      : t('kit.ds.shown', { n: s.truncated.returned ?? 0 });
    out.push({ source: t('kit.ds.title'), label: t('kit.ds.truncated'), text, tone: 'wrn' });
  }
  return out;
}

/**
 * Человеческая сводка о скрытой диагностике — та же, что блок печатал рядом
 * с кнопкой «тех.» (hiddenNote): факт неполноты не прячется вместе с кодами.
 */
function techSummary(s: ReturnType<typeof dataStateOf>, t: T): WarningItem[] {
  const out: WarningItem[] = [];
  const add = (text: string, tone: WarningItem['tone']) => out.push({ source: t('kit.ds.title'), label: t('kit.ds.title'), text, tone });
  if (s.failed.length > 0) add(t('kit.ds.techFailed'), 'dng');
  if (s.forbidden.length > 0) add(t('kit.ds.techForbidden'), 'wrn');
  if (s.truncatedBlocks.length > 0) add(t('kit.ds.techTruncated'), 'wrn');
  return out;
}

/** Строки состояния данных словами человека — те же, что печатал блок. */
export function dataStateItems(meta: KitMeta, t: T, showTech = false): WarningItem[] {
  const user = dataStateOf(meta, 'user');
  const tech = dataStateOf(meta, 'tech');
  const out: WarningItem[] = [...rowsOf(user, t), ...techSummary(tech, t)];
  // Диагностика с кодами источников — только с включённой настройкой
  // «технические сведения» (S4-TECH-NOTES): без неё человек видит сводку.
  if (showTech) out.push(...rowsOf(tech, t));
  // Замечания графа (GC-04) приложение кладёт в meta.graphNotes уже словами
  // человека — они о том же: часть сведений не пришла целиком.
  const notes = (meta as unknown as { graphNotes?: unknown }).graphNotes;
  if (Array.isArray(notes)) {
    for (const n of notes) {
      if (typeof n === 'string' && n.trim()) out.push({ source: t('kit.record.tab.graph'), label: t('kit.record.tab.graph'), text: n, tone: 'wrn' });
    }
  }
  return out;
}

export function DataStateWarnings({ meta, className }: DataStateWarningsProps) {
  const lang = useKitLang();
  const showTech = useShowTech();
  const t: T = (k, v) => kitT(lang, k, v);
  const items = useMemo(() => dataStateItems(meta, t, showTech), [meta, lang, showTech]); // eslint-disable-line react-hooks/exhaustive-deps
  const collected = useWarningsSource('data', items);
  if (collected) return null;
  return <DataStateBlock meta={meta} className={className} />;
}
