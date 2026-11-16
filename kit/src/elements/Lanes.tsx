// «Дорожки» — запись, разложенная по полосам (SPRINT_UXR_S13_KIT4/K4-LANES).
//
// Повод — «Дата-странники»: тропа — это отрезки по сторонам (у сна А · стык · у сна Б), в отрезках
// свитки, квизы и тени. Пилот 15.11: обзор тропы был текстом, «пункты не кликаются». В LORE —
// кандидаты «этап → задачи», «до / во время / после». Владелица 16.11: «то что относится к кит бери».
//
// Что есть что, решает приложение (K-14): kit получает полосы готовыми и только раскладывает.
//   • полоса — заголовок и элементы; `accent` — выделенная полоса (стык);
//   • элемент — упоминание записи (значок и цвет вида, ссылка) и бейдж («×2» у ценного свитка);
//   • адреса нет — текст без ссылки, а не мёртвая ссылка; пустая полоса — словами, не пустой рамкой;
//   • на узком экране полосы встают в столбик (CSS).
import type { ReactNode } from 'react';
import type { KindConfig } from '../core/contract';
import { kitT, useKitLang } from '../i18n';
import { ObjectMention } from './ObjectMention';

export interface LaneItem {
  id: string;
  title?: string | null;
  /** Вид записи — облик упоминания. */
  kind?: string | null;
  /** Короткая пометка рядом (например, «×2»). */
  badge?: ReactNode;
}

export interface Lane {
  key: string;
  title: string;
  /** Выделить полосу (стык сторон). */
  accent?: boolean;
  items: readonly LaneItem[];
}

export interface LanesProps {
  lanes: readonly Lane[];
  /** Адрес записи; null — без ссылки. */
  href: (id: string) => string | null;
  /** Подпись всего блока (для чтения с экрана). */
  label: string;
  /** Виды приложения — облик упоминаний. */
  kinds?: Record<string, KindConfig>;
  className?: string;
}

export function Lanes({ lanes, href, label, kinds, className }: LanesProps) {
  const lang = useKitLang();
  return (
    <div className={['sk-lanes', className].filter(Boolean).join(' ')} role="region" aria-label={label} data-testid="kit-lanes">
      {lanes.map(l => (
        <section key={l.key} className="sk-lanes__lane" role="group" aria-label={l.title} data-lane={l.key} {...(l.accent ? { 'data-accent': 'true' } : {})}>
          <h3 className="sk-lanes__head">{l.title}<span className="sk-lanes__count">{l.items.length}</span></h3>
          {l.items.length === 0 ? (
            <p className="sk-lanes__empty">{kitT(lang, 'kit.lanes.empty')}</p>
          ) : (
            <ul className="sk-lanes__items">
              {l.items.map((it, i) => (
                <li key={`${it.id}#${i}`} className="sk-lanes__item">
                  <ObjectMention id={it.id} title={it.title} kind={it.kind} kinds={kinds} href={href(it.id)} />
                  {it.badge != null && <span className="sk-pill sk-lanes__badge">{it.badge}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
