// Свежесть ячейкой (SPRINT_UXR_S13_KIT4/K4-FRESHNESS): «3 мин назад»,
// «2 ч назад · устарело» в строке списка.
//
// Колонка списка `fresh:<поле>` читает отметку времени `fields[<поле>]` (или
// `updated_at`) и пишет, сколько прошло, словами локали kit. Тон — по порогам
// ПРИЛОЖЕНИЯ `list.fresh[<поле>] = { warnAfter, staleAfter }` в минутах.
//
// Граница K-14: какое поле считать временем и где «давно» — решает
// приложение. kit не знает, что такое «узел» или «прогон», и слов таких не
// печатает. Порогов нет — тона нет: kit не выдумывает, что считать «давно».
//
// «Времени нет» ≠ «давно». Пустое значение — отдельный исход с нейтральными
// словами и без тона: запись, у которой отметки не было вовсе, и запись,
// которая давно не обновлялась, — разные утверждения.
//
// Часы: один таймер раз в минуту на весь список (useMinuteNow в ListView), а не
// на каждую строку — у реестра в тысячу строк это тысяча интервалов.
import { useEffect, useState } from 'react';
import { kitT, useKitLang } from '../i18n';
import { kitDay } from '../core/fmtValue';

/** Пороги приложения, в минутах. Любой можно не задавать. */
export interface KitFreshThresholds {
  /** С этой минуты — тон «предупреждение». */
  warnAfter?: number;
  /** С этой минуты — тон «устарело». */
  staleAfter?: number;
}

/**
 * Пороги колонки в конфиге: общие числа плюс `perRecord` — ИМЕНА полей записи, где лежат
 * минуты этой строки (S7B-ACT-1: у каждой машины своё окно активности). Число в поле
 * главнее числа колонки; поля нет или в нём не число — порог колонки.
 */
export interface KitFreshConfig extends KitFreshThresholds {
  perRecord?: { warnAfter?: string; staleAfter?: string };
}

const minutes = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Пороги для строки: число из поля записи (perRecord) главнее порога колонки. */
export function freshThresholdsFor(th: KitFreshConfig | undefined, r: { fields?: Record<string, unknown> }): KitFreshThresholds | undefined {
  if (!th) return undefined;
  const pick = (k: 'warnAfter' | 'staleAfter'): number | undefined => {
    const f = th.perRecord?.[k];
    const own = f ? minutes(r.fields?.[f]) : undefined;
    return own ?? th[k];
  };
  const out: KitFreshThresholds = {};
  const w = pick('warnAfter');
  const s = pick('staleAfter');
  if (w !== undefined) out.warnAfter = w;
  if (s !== undefined) out.staleAfter = s;
  return out;
}

export type FreshTone = 'plain' | 'ok' | 'warn' | 'stale';
export type FreshWord = 'now' | 'min' | 'hours' | 'yesterday' | 'date';

export type FreshValue =
  | { kind: 'none' }
  | { kind: 'bad'; raw: string }
  | { kind: 'at'; iso: string; minutes: number; word: FreshWord; n?: number; date?: string; tone: FreshTone };

const DAY_MS = 86_400_000;

/** Начало локальных суток — для «вчера» по календарю, а не «24–48 ч назад». */
function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function freshTone(minutes: number, th?: KitFreshThresholds): FreshTone {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const warn = ok(th?.warnAfter) ? th!.warnAfter : undefined;
  const stale = ok(th?.staleAfter) ? th!.staleAfter : undefined;
  if (warn === undefined && stale === undefined) return 'plain';
  if (stale !== undefined && minutes >= stale) return 'stale';
  if (warn !== undefined && minutes >= warn) return 'warn';
  return 'ok';
}

/**
 * Разобрать отметку времени относительно `now` (мс). Отметка из будущего
 * (часы источника спешат) читается как «только что»: утверждать «давно» не из
 * чего, а «через 3 мин» в колонке «когда было» бессмысленно.
 */
export function freshOf(v: unknown, now: number, th?: KitFreshThresholds): FreshValue {
  if (v === null || v === undefined) return { kind: 'none' };
  const raw = String(v).trim();
  if (!raw) return { kind: 'none' };
  const t = typeof v === 'number' ? v : Date.parse(raw);
  if (!Number.isFinite(t)) return { kind: 'bad', raw };
  const iso = typeof v === 'number' ? new Date(t).toISOString() : raw;
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  const tone = freshTone(minutes, th);
  if (minutes < 1) return { kind: 'at', iso, minutes, word: 'now', tone };
  if (minutes < 60) return { kind: 'at', iso, minutes, word: 'min', n: minutes, tone };
  if (minutes < 24 * 60) return { kind: 'at', iso, minutes, word: 'hours', n: Math.floor(minutes / 60), tone };
  if (dayStart(t) === dayStart(dayStart(now) - DAY_MS / 2)) return { kind: 'at', iso, minutes, word: 'yesterday', tone };
  return { kind: 'at', iso, minutes, word: 'date', date: kitDay(iso)?.text ?? iso, tone };
}

/** Общие часы списка: тикают раз в минуту, только когда есть что тикать. */
export function useMinuteNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

export function FreshCell({ value, now, thresholds }: { value: unknown; now: number; thresholds?: KitFreshThresholds }) {
  const lang = useKitLang();
  const f = freshOf(value, now, thresholds);

  if (f.kind === 'none') {
    // Нейтральные слова, без тона и без «назад»: отметки не было, а не «давно».
    return <span className="sk-fresh" data-tone="none" title={kitT(lang, 'kit.fresh.noneHint')}>{kitT(lang, 'kit.fresh.none')}</span>;
  }
  if (f.kind === 'bad') {
    return <span className="sk-fresh" data-tone="bad" title={kitT(lang, 'kit.fmt.badDate')}>{f.raw}</span>;
  }

  const text = f.word === 'now' ? kitT(lang, 'kit.fresh.now')
    : f.word === 'min' ? kitT(lang, 'kit.fresh.min', { n: f.n ?? 0 })
      : f.word === 'hours' ? kitT(lang, 'kit.fresh.hours', { n: f.n ?? 0 })
        : f.word === 'yesterday' ? kitT(lang, 'kit.fresh.yesterday')
          : f.date ?? f.iso;
  const toneNote = f.tone === 'warn' ? kitT(lang, 'kit.fresh.tone.warn', { n: thresholds?.warnAfter ?? 0 })
    : f.tone === 'stale' ? kitT(lang, 'kit.fresh.tone.stale', { n: thresholds?.staleAfter ?? 0 })
      : '';
  // Полное время — в подсказке; тон — словом там же и в имени для чтеца.
  const title = toneNote ? `${f.iso} · ${toneNote}` : f.iso;
  return (
    <time className="sk-fresh" data-tone={f.tone} dateTime={f.iso} title={title} aria-label={toneNote ? `${text}, ${toneNote}` : undefined}>
      {f.tone === 'warn' || f.tone === 'stale' ? <span className="sk-fresh__dot" aria-hidden="true" /> : null}
      {text}
      {/* «Устарело» — словом В СТРОКЕ, не только цветом: на телефоне подсказки нет,
          а цвет не читается без цветового зрения. */}
      {f.tone === 'stale' ? <span className="sk-fresh__word">{kitT(lang, 'kit.fresh.staleShort')}</span> : null}
    </time>
  );
}
