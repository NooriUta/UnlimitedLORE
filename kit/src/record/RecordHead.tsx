// Шапка записи и строка вердикта (K-04).
import type { CSSProperties, ReactNode } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { kitT, type KitLang } from '../i18n';
import { verdictTone } from './graph';
import { StatusSlot } from './StatusSlot';
import { kitMinute } from '../core/fmtValue';

/**
 * Шапка записи (K-04; раскладка S4-29 по прототипу v4): надзаголовок «тип · ID»
 * → H1 → строка статуса. Строку статуса рисует шапка, только если её не рисует
 * строка фактов (там статус первым пунктом) — статус в статье один раз.
 */
export function RecordHead({ record, ctx, lang, titleId, withStatus = true, tail }: {
  record: KitRecord; ctx: KitCtx; lang: KitLang; titleId: string;
  /** Строка статуса под H1 (нет — её рисует строка фактов). */
  withStatus?: boolean;
  /** Хвост строки статуса: «получено N мин ↻». */
  tail?: ReactNode;
}) {
  const kind = ctx.config.kinds[record.kind];
  return (
    <header className="sk-rec-head" data-testid="kit-rec-head">
      <p className="sk-rec-head__over">
        <span className="sk-rec-head__kind">
          <GameIcon slug={kind?.icon} size={12} />
          <span>{kind?.title ?? record.kind}</span>
        </span>
        <span className="sk-rec-head__dot" aria-hidden="true">·</span>
        <span className="sk-rec-head__id">{record.id}</span>
      </p>
      <h1 id={titleId} className="sk-rec-head__title">{record.title}</h1>
      {withStatus && (
        <div className="sk-rec-head__status">
          <StatusSlot record={record} ctx={ctx} unknownTitle={kitT(lang, 'kit.record.status.unknown')} />
          {record.updated_at && (
            <time className="sk-rec-head__time" dateTime={record.updated_at}>
              {kitT(lang, 'kit.record.updated', { at: kitMinute(record.updated_at)?.text ?? record.updated_at })}
            </time>
          )}
          {tail}
        </div>
      )}
    </header>
  );
}

/** «Получено N мин назад ↻» (S4-29): когда экран получил данные, а не когда запись правили. */
export function RecordLoaded({ loadedAt, now, onReload, lang }: { loadedAt: string; now: number; onReload?: () => void; lang: KitLang }) {
  const t = Date.parse(loadedAt);
  const min = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60_000)) : null;
  const text = min === null ? kitT(lang, 'kit.record.loaded.unknown')
    : min < 1 ? kitT(lang, 'kit.record.loaded.now')
      : min < 60 ? kitT(lang, 'kit.record.loaded.min', { n: min })
        : kitT(lang, 'kit.record.loaded.hours', { n: Math.floor(min / 60) });
  return (
    <span className="sk-rec-loaded" data-testid="kit-rec-loaded">
      <time dateTime={loadedAt}>{text}</time>
      {onReload && (
        <button type="button" className="sk-rec-loaded__btn" onClick={onReload} aria-label={kitT(lang, 'kit.record.loaded.reload')}
          title={kitT(lang, 'kit.record.loaded.reload')}>↻</button>
      )}
    </span>
  );
}

/** Строка вердикта: считает конфиг (config.verdict) — исключение ловит BlockBoundary. */
export function RecordVerdict({ record, ctx, lang }: { record: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const fn = ctx.config.verdict;
  if (!fn) return null;
  const v = fn(record, ctx);
  const tone = verdictTone(v);
  const pct = v.max > 0 ? Math.max(0, Math.min(100, Math.round((v.score / v.max) * 100))) : 0;
  const style = { '--verdict-c': `var(--${tone})`, '--verdict-w': `${pct}%` } as CSSProperties;
  return (
    <section className="sk-rec-verdict" data-testid="kit-verdict" data-tone={tone} style={style}
      aria-label={kitT(lang, 'kit.record.verdict')}>
      <span className="sk-rec-verdict__score" aria-label={kitT(lang, 'kit.record.verdict.score', { score: v.score, max: v.max })}>
        {v.score}/{v.max}
      </span>
      <span className="sk-rec-verdict__bar" aria-hidden="true"><span className="sk-rec-verdict__fill" /></span>
      {v.failed.length === 0 && v.hints.length === 0 && (
        <span className="sk-rec-verdict__ok">{kitT(lang, 'kit.record.verdict.ok')}</span>
      )}
      {v.failed.length > 0 && (
        <span className="sk-rec-verdict__group">
          <span className="sk-rec-verdict__label">{kitT(lang, 'kit.record.verdict.failed')}</span>
          {v.failed.map(f => <span key={f} className="sk-pill sk-pill--value sk-rec-verdict__failed">{f}</span>)}
        </span>
      )}
      {v.hints.length > 0 && (
        <span className="sk-rec-verdict__group">
          <span className="sk-rec-verdict__label">{kitT(lang, 'kit.record.verdict.hints')}</span>
          {v.hints.map(h => <span key={h} className="sk-rec-verdict__hint">{h}</span>)}
        </span>
      )}
    </section>
  );
}
