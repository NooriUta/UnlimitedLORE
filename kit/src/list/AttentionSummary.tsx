// Сводка «требует внимания» (SPRINT_UXR_S13_KIT4/K4-SUMMARY-QUEUE). Решения владелицы 16.11.2026:
//  Q1 — группы сводки — это быстрые фильтры списка (`list.quick`): счётчик в сводке и «Показано N» в списке
//       считает один и тот же фильтр, второго источника правды нет;
//  Q2 — число даёт хук приложения `hooks.count` (сервер знает настоящее); хука нет — kit считает по
//       загруженным записям, а если выдача обрезана — пишет «≈»;
//  Q3 — под группой первые N записей и «ещё M»; N — настройка (`top`), по умолчанию 5 на широком и 3 на узком.
// Куда ведёт группа — приложение (hrefOf/onNavigate), как у сводки по вердикту.
import type { KitCtx, KitRecord } from '../core/contract';
import { navClick } from '../core/navClick';
import { useNarrow } from '../core/narrow';
import { kitT, useKitLang } from '../i18n';
import { EmptyState } from '../states/StateViews';
import { RecordRef } from '../record/fmt';
import { matchFilter, type QuickItem } from './listModel';

export interface AttentionSummaryProps {
  records: readonly KitRecord[];
  ctx: KitCtx;
  /** Группы. Не заданы — быстрые фильтры списка из конфига (Q1). */
  quick?: readonly QuickItem[];
  /** Сколько записей под группой (Q3). Не задано — 5 на широком экране, 3 на узком. */
  top?: number;
  /** Узкий экран (тесты, встройка); не задан — по ширине окна. */
  narrow?: boolean;
  /** Выдача обрезана — счёт по загруженным неточен. Не задано — `meta.truncated`. */
  truncated?: boolean;
  /** Адрес списка с быстрым фильтром группы. Не задан — группы без ссылок. */
  hrefOf?: (quickId: string) => string;
  /** Переход силами приложения (без перезагрузки); ссылка остаётся ссылкой для новой вкладки. */
  onNavigate?: (quickId: string) => void;
  className?: string;
}

export function AttentionSummary({ records, ctx, quick, top, narrow, truncated, hrefOf, onNavigate, className }: AttentionSummaryProps) {
  const lang = useKitLang();
  const isNarrow = useNarrow(narrow);
  const groups = quick ?? ctx.config.list?.quick ?? [];
  const n = top ?? (isNarrow ? 3 : 5);
  const cut = truncated ?? ctx.data.meta.truncated === true;
  const countHook = ctx.config.hooks?.count;
  if (groups.length === 0) return <EmptyState title={kitT(lang, 'kit.attn.noGroups')} hint={kitT(lang, 'kit.attn.noGroupsHint')} />;
  return (
    <section className={['sk-attn', className].filter(Boolean).join(' ')} aria-label={kitT(lang, 'kit.attn.title')}>
      {groups.map(g => {
        const hit = records.filter(r => matchFilter(r, g.filter));
        const fromApp = countHook?.({ quick: g.id });
        const total = typeof fromApp === 'number' ? fromApp : hit.length;
        const approx = typeof fromApp !== 'number' && cut;
        const more = Math.max(0, total - Math.min(n, hit.length));
        const href = hrefOf?.(g.id);
        const title = <span className="sk-attn__title">{g.title}</span>;
        return (
          <div key={g.id} className="sk-attn__group" data-testid="kit-attn-group" data-empty={total === 0 || undefined}>
            <div className="sk-attn__head">
              {href ? <a href={href} className="sk-attn__link" onClick={onNavigate ? navClick(() => onNavigate(g.id)) : undefined}>{title}</a> : title}
              <span className="sk-attn__count" data-testid="kit-attn-count" title={approx ? kitT(lang, 'kit.attn.approx') : undefined}>{approx ? '≈' : ''}{total}</span>
            </div>
            {hit.length > 0 && (
              <ul className="sk-attn__list">
                {hit.slice(0, n).map(r => <li key={r.id}><RecordRef id={r.id} ctx={ctx} kind={r.kind} /></li>)}
              </ul>
            )}
            {more > 0 && <span className="sk-attn__more">{kitT(lang, 'kit.attn.more', { n: more })}</span>}
          </div>
        );
      })}
    </section>
  );
}
