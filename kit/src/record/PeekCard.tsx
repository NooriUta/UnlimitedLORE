// Карточка Peek (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD; прототип одобрен
// владелицей 11.11.2026): быстрый просмотр записи ТОЛЬКО для чтения — правка в паспорте.
//
// Карточка = карточка ленты: общая шапка (RecordCardHead) и один раздел тела (RecordSection, до трёх
// абзацев), плюс 2–3 свойства, счётчики и действия. Одна на все три входа: ссылка в тексте или
// ленте, строка списка, адрес ?peek=.
//
// Честно: нет статуса — нет пилюли; нет текста — «текста нет»; незаданное свойство — «не задано»;
// не смогли загрузить ≠ записи нет ≠ нет прав. Адреса паспорта нет — нет и кнопок перехода.
// Kit не знает предметных имён (K-14): подписи, свойства, счётчики и адрес даёт приложение.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { RecordCardHead } from './RecordCardHead';
import { RecordSection } from './RecordSection';
import { MartProse } from '../content/MartProse';
import { kitT, useKitLang, type KitKey } from '../i18n';

/** Сколько абзацев тела показывает карточка — как лента (body_head). */
const PARAS = 3;

export interface PeekCardData {
  kind: string;
  id: string;
  title: string;
  /** Статус готовым элементом (пилюля приложения); нет — нет. */
  status?: ReactNode;
  /** 2–3 свойства; value null — «не задано». */
  props: { label: string; value: ReactNode | null }[];
  /** Один раздел тела; null — «текста нет». */
  section: { title: string; paras: string[] } | null;
  /** Счётчики связей — по РАЗНЫМ значениям, считает приложение. */
  counters?: { label: string; n: number }[];
  /** Адрес паспорта; null — перейти некуда, кнопок нет. */
  href: string | null;
}

export type PeekState =
  | { state: 'loading' }
  | { state: 'ok'; data: PeekCardData }
  | { state: 'error'; reason: string }
  | { state: 'missing' }
  | { state: 'forbidden'; reason?: string };

export interface PeekCardProps {
  peek: PeekState;
  /** ID для состояний без данных (грузится, нет, нет прав). */
  id?: string;
  onRetry?: () => void;
  /** Полный адрес для «Копировать ссылку» (href приложения относительный). */
  absoluteHref?: (href: string) => string;
}

export function PeekCard({ peek, id, onRetry, absoluteHref }: PeekCardProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  if (peek.state !== 'ok') {
    const ref = id ? <span className="sk-peek-card__id">{id}</span> : null;
    return (
      <div className="sk-peek-card" data-peek={peek.state}>
        {ref}
        {peek.state === 'loading' && <p className="sk-peek-card__state">{t('kit.peek.loading')}</p>}
        {peek.state === 'error' && (
          <>
            <p className="sk-peek-card__state sk-peek-card__state--err" role="alert">{t('kit.peek.error', { reason: peek.reason })}</p>
            {onRetry && <div className="sk-peek-card__acts"><button type="button" className="sk-btn" onClick={onRetry}>{t('kit.peek.retry')}</button></div>}
          </>
        )}
        {peek.state === 'missing' && <p className="sk-peek-card__state sk-peek-card__state--err">{t('kit.peek.missing', { id: id ?? '' })}</p>}
        {peek.state === 'forbidden' && (
          <p className="sk-peek-card__state sk-peek-card__state--lock">
            {peek.reason ? t('kit.peek.forbiddenWhy', { reason: peek.reason }) : t('kit.peek.forbidden')}
          </p>
        )}
      </div>
    );
  }

  const d = peek.data;
  const copy = async () => {
    if (!d.href) return;
    try {
      await navigator.clipboard.writeText(absoluteHref ? absoluteHref(d.href) : d.href);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  return (
    <div className="sk-peek-card" data-peek="ok">
      <RecordCardHead kind={d.kind} id={d.id} title={d.title} status={d.status} />
      {d.props.length > 0 && (
        <dl className="sk-peek-card__props">
          {d.props.map(p => (
            <div key={p.label} className="sk-peek-card__prop">
              <dt>{p.label}</dt>
              <dd>{p.value ?? <span className="sk-peek-card__unset">{t('kit.peek.unset')}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.section
        ? <RecordSection title={d.section.title}>{d.section.paras.slice(0, PARAS).map((p, i) => <MartProse key={i} className="sk-feed__para" text={p} />)}</RecordSection>
        : <p className="sk-peek-card__none">{t('kit.peek.noText')}</p>}
      {d.counters && d.counters.length > 0 && (
        <p className="sk-peek-card__cnt">
          {d.counters.map((c, i) => <span key={c.label}>{i > 0 && ' · '}{c.label} <b>{c.n}</b></span>)}
        </p>
      )}
      {d.href && (
        <div className="sk-peek-card__acts">
          <a className="sk-btn sk-btn--primary sk-peek-card__open" href={d.href}>{t('kit.peek.open')}</a>
          <a className="sk-btn" href={d.href} target="_blank" rel="noopener noreferrer">{t('kit.peek.newTab')}</a>
          <button type="button" className="sk-btn" onClick={() => { void copy(); }}>{t('kit.peek.copy')}</button>
        </div>
      )}
      {copied === 'ok' && <p className="sk-peek-card__note" role="status">{t('kit.peek.copied')}</p>}
      {copied === 'fail' && <p className="sk-peek-card__note sk-peek-card__state--err" role="alert">{t('kit.peek.copyFailed')}</p>}
    </div>
  );
}
