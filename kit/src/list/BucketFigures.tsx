// Цифры ведра ленты — дня, группы, подгруппы (SPRINT_UXR_S7A_NEWS, владелица 11.11.2026:
// «если у нас группировка и подгруппировка идёт, все важные метрики должны быть посчитаны
// и отображены для этой группы: считает сервер, отображает kit»).
//
// Раньше эта строка жила только у дня, в приложении. Теперь она в kit и одна на всё: день,
// группу и подгруппу. Kit не знает, что такое «закрыто», «к выкатке» или «сгорание» (K-14):
// числа, подписи, иконки и тона называет приложение, kit их только раскладывает.
// Нет числа — нет элемента: «сервер не прислал» не рисуется нулём.
import { GameIcon } from '../elements/GameIcon';

export interface BucketChip {
  id?: string;
  n: number;
  label: string;
  icon?: string;
  /** Тон критичного чипа (wrn, dng, acc…); нет — информационный, серый. */
  tone?: string;
  /** Подпись рядом с числом — у критичных; информационные показывают только число. */
  showLabel?: boolean;
  /** Готовый текст чипа вместо числа (например «Δ 5»). */
  text?: string;
}

export interface BucketFiguresProps {
  /** Сгорание: число со знаком и тон (suc — убыло, dng — прибыло). */
  burn?: { text: string; tone?: string; title: string; id?: string };
  /** Полоса баланса «сделано против добавлено». */
  balance?: { done: number; added: number; doneText: string; addedText: string; aria: string; doneId?: string; addedId?: string };
  chips?: BucketChip[];
  /** Итог (пара «события · элементы»). */
  total?: { text: string; title: string; id?: string; innerId?: string };
  /** Хвостовые чипы после итога (например «Δ 5»). */
  tail?: BucketChip[];
  /** Разбивка по типам — иконка и число. */
  types?: { key: string; n: number; icon: string; title: string }[];
  typesId?: string;
  typesTitle?: string;
  /** Компактно — одной строкой, для заголовков групп и строк таблицы. */
  compact?: boolean;
  testid?: string;
}

function Chip({ c }: { c: BucketChip }) {
  return (
    <span className="sk-news__dchip" data-testid={c.id} data-tone={c.tone} title={c.label}>
      {c.icon && <GameIcon slug={c.icon} size={11} />}
      {c.text ?? (c.showLabel ? <><b>{c.n}</b><span>{c.label}</span></> : c.n)}
    </span>
  );
}

export function BucketFigures(p: BucketFiguresProps) {
  const { balance: b } = p;
  const share = b && b.done + b.added > 0 ? Math.round((b.done / (b.done + b.added)) * 100) : 0;
  const hasAny = !!(p.burn || b || p.chips?.length || p.total || p.tail?.length || p.types?.length);
  if (!hasAny) return null;
  return (
    <div className="sk-news__figs" data-compact={p.compact ? '' : undefined} data-testid={p.testid}>
      {(b || p.burn) && (
        <div className="sk-news__bal">
          {p.burn && (
            <span className="sk-news__bburn" data-testid={p.burn.id} data-tone={p.burn.tone} title={p.burn.title}>
              <GameIcon slug="flame" size={12} />
              <b>{p.burn.text}</b>
            </span>
          )}
          {b && (
            <>
              <span className="sk-news__balbar" role="img" aria-label={b.aria}>
                <span data-part="closed" style={{ width: `${share}%` }} />
                <span data-part="created" style={{ width: `${100 - share}%` }} />
              </span>
              <span className="sk-news__ball">
                <span data-testid={b.doneId}>{b.doneText}</span>
                {' · '}
                <span data-testid={b.addedId}>{b.addedText}</span>
              </span>
            </>
          )}
        </div>
      )}
      <div className="sk-news__dchips">
        {(p.chips ?? []).map((c, i) => <Chip key={c.id ?? `c${i}`} c={c} />)}
        {p.total && (
          <span className="sk-news__dchip" data-testid={p.total.id} title={p.total.title}>
            <span data-testid={p.total.innerId}>{p.total.text}</span>
          </span>
        )}
        {(p.tail ?? []).map((c, i) => <Chip key={c.id ?? `t${i}`} c={c} />)}
        {p.types && p.types.length > 0 && (
          <span className="sk-news__ftypes" data-testid={p.typesId} title={p.typesTitle}>
            {p.types.map(x => (
              <span key={x.key} title={x.title}><GameIcon slug={x.icon} size={11} />{x.n}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
