// Шапка записи и строка вердикта (K-04).
import type { CSSProperties } from 'react';
import type { KitCtx, KitRecord } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { kitT, type KitLang } from '../i18n';
import { verdictTone } from './graph';
import { StatusPill } from './fmt';

export function RecordHead({ record, ctx, lang, titleId }: { record: KitRecord; ctx: KitCtx; lang: KitLang; titleId: string }) {
  const kind = ctx.config.kinds[record.kind];
  return (
    <header className="sk-rec-head" data-testid="kit-rec-head">
      <div className="sk-rec-head__meta">
        <span className="sk-rec-head__kind">
          <GameIcon slug={kind?.icon} size={13} />
          <span>{kind?.title ?? record.kind}</span>
        </span>
        <span className="sk-pill sk-pill--id">{record.id}</span>
        <StatusPill code={record.status} ctx={ctx} unknownTitle={kitT(lang, 'kit.record.status.unknown')} />
        {record.updated_at && (
          <time className="sk-rec-head__time" dateTime={record.updated_at}>
            {kitT(lang, 'kit.record.updated', { at: record.updated_at.replace('T', ' ').slice(0, 16) })}
          </time>
        )}
      </div>
      <h1 id={titleId} className="sk-rec-head__title">{record.title}</h1>
    </header>
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
