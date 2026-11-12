// Блок «Состояние данных» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Три состояния показываются по-разному намеренно: «проверено», «не смогли
// проверить» и «обрезано» — разные утверждения, и общая серая строка их бы
// слила. Непрочитанный блок выделен предупреждающим цветом, потому что по
// нему нельзя делать выводы.
//
// Когда сказать нечего, блока нет вовсе: пустая рамка «всё хорошо» занимает
// место и приучает её не читать.
import type { KitMeta } from '../core/contract';
import { kitT, useKitLang } from '../i18n';
import { dataStateOf, type DataState } from './dataState';
import { TechGate, useShowTech } from '../resilience/techGate';

export interface DataStateBlockProps {
  meta: KitMeta;
  className?: string;
}

type T = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => string;

/**
 * Строки одного адресата. S4-TECH-NOTES: строки с тегом tech рисуются тем же
 * видом, но внутри TechGate — скрыты, пока их не включили настройкой или
 * кнопкой «тех.» на месте.
 */
function Rows({ s, t }: { s: DataState; t: T }) {
  const truncatedText = s.truncated
    ? (s.truncated.total !== undefined
      ? t('kit.ds.shownOf', { n: s.truncated.returned ?? 0, total: s.truncated.total })
      // Сколько всего — неизвестно, и выдумывать число нельзя.
      : t('kit.ds.shown', { n: s.truncated.returned ?? 0 }))
    : null;
  return (
    <>
      {s.checked.length > 0 && (
        <p className="sk-ds__checked" data-testid="ds-checked">
          <span className="sk-ds__label">{t('kit.ds.checked')}</span> {s.checked.join(', ')}
        </p>
      )}

      {s.failed.length > 0 && (
        <div className="sk-ds__failed" data-testid="ds-failed">
          <span className="sk-ds__label">{t('kit.ds.failed')}</span>
          <ul className="sk-ds__list">
            {s.failed.map(f => (
              <li key={f.block}>
                <b>{f.block}</b> — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.forbidden.length > 0 && (
        <div className="sk-ds__forbidden" data-testid="ds-forbidden">
          <span className="sk-ds__label">{t('kit.ds.forbidden')}</span>
          <ul className="sk-ds__list">
            {s.forbidden.map(f => (
              <li key={f.block}><b>{f.block}</b> — {f.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {(truncatedText || s.truncatedBlocks.length > 0) && (
        <p className="sk-ds__truncated" data-testid="ds-truncated">
          <span className="sk-ds__label">{t('kit.ds.truncated')}</span>{' '}
          {truncatedText}
          {s.truncatedBlocks.length > 0 && (
            <>{truncatedText ? ' · ' : ''}{s.truncatedBlocks.join(', ')}</>
          )}
        </p>
      )}
    </>
  );
}

/** Одна человеческая строка вместо скрытой диагностики: факт неполноты не прячется вместе с кодами. */
function hiddenNote(s: DataState, t: T): string | undefined {
  const parts: string[] = [];
  if (s.failed.length > 0) parts.push(t('kit.ds.techFailed'));
  if (s.forbidden.length > 0) parts.push(t('kit.ds.techForbidden'));
  if (s.truncatedBlocks.length > 0) parts.push(t('kit.ds.techTruncated'));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function DataStateBlock({ meta, className }: DataStateBlockProps) {
  const lang = useKitLang();
  const t: T = (k, v) => kitT(lang, k, v);
  const showTech = useShowTech();
  // Техническое включено настройкой — блок ровно прежний: все строки на своих
  // местах, без деления на «для человека» и «для разработчика».
  const all = dataStateOf(meta);
  const user = dataStateOf(meta, 'user');
  const tech = dataStateOf(meta, 'tech');
  // Пользователю сказать нечего, если неполноты нет ни в его строках, ни в
  // скрытых: одно «проверено» в диагностике рамку не заводит (как и раньше).
  if (showTech) {
    if (!all.hasAnything) return null;
    return (
      <section className={['sk-ds', className].filter(Boolean).join(' ')} aria-label={t('kit.ds.title')}>
        <h3 className="sk-ds__head">{t('kit.ds.title')}</h3>
        <Rows s={all} t={t} />
      </section>
    );
  }
  if (!user.hasAnything && !tech.hasAnything) return null;
  const note = hiddenNote(tech, t);
  const techHasRows = tech.hasAnything || tech.checked.length > 0;

  return (
    <section className={['sk-ds', className].filter(Boolean).join(' ')} aria-label={t('kit.ds.title')}>
      <h3 className="sk-ds__head">{t('kit.ds.title')}</h3>
      <Rows s={user} t={t} />
      {techHasRows && (
        <TechGate label={t('kit.ds.techBtn')} hiddenNote={note && <span className="sk-ds__techNote" data-testid="ds-tech-hidden">{note}</span>}>
          <Rows s={tech} t={t} />
        </TechGate>
      )}
    </section>
  );
}
