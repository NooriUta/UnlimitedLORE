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
import { dataStateOf } from './dataState';

export interface DataStateBlockProps {
  meta: KitMeta;
  className?: string;
}

export function DataStateBlock({ meta, className }: DataStateBlockProps) {
  const lang = useKitLang();
  const t = (k: Parameters<typeof kitT>[1], v?: Record<string, string | number>) => kitT(lang, k, v);
  const s = dataStateOf(meta);
  if (!s.hasAnything) return null;

  const truncatedText = s.truncated
    ? (s.truncated.total !== undefined
      ? t('kit.ds.shownOf', { n: s.truncated.returned ?? 0, total: s.truncated.total })
      // Сколько всего — неизвестно, и выдумывать число нельзя.
      : t('kit.ds.shown', { n: s.truncated.returned ?? 0 }))
    : null;

  return (
    <section className={['sk-ds', className].filter(Boolean).join(' ')} aria-label={t('kit.ds.title')}>
      <h3 className="sk-ds__head">{t('kit.ds.title')}</h3>

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

      {(truncatedText || s.truncatedBlocks.length > 0) && (
        <p className="sk-ds__truncated" data-testid="ds-truncated">
          <span className="sk-ds__label">{t('kit.ds.truncated')}</span>{' '}
          {truncatedText}
          {s.truncatedBlocks.length > 0 && (
            <>{truncatedText ? ' · ' : ''}{s.truncatedBlocks.join(', ')}</>
          )}
        </p>
      )}
    </section>
  );
}
