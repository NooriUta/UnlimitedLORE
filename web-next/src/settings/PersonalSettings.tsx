// Личные настройки LORE v2: «новая навигация» (S3-07) и режим чтения (S5-05:
// размер текста, «сворачивать меню при чтении» — D-2026-UXR-READ-COLLAPSE);
// остальные приходят своими задачами UXR.
import { KitLangProvider, ReadingSettings } from '@seidr/kit';
import { detectLang, type Lang } from '../i18n/messages';
import { t } from '../i18n/messages';
import { switchNavUrl } from '../nav/navVersion';
import { NavSwitch } from './NavSwitch';

export function PersonalSettings({ lang = detectLang() }: { lang?: Lang }) {
  const targetUrl = typeof location === 'undefined' ? null : switchNavUrl(location, 'v1');
  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title" className="settings-title">{t(lang, 'settings.title')}</h2>
      <NavSwitch lang={lang} targetUrl={targetUrl} />
      <div className="setting-row" data-reading-settings>
        <KitLangProvider lang={lang}>
          <ReadingSettings />
        </KitLangProvider>
      </div>
    </section>
  );
}
