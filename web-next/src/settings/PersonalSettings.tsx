// Личные настройки LORE v2. Пока один пункт — «новая навигация» (S3-07);
// остальные приходят своими задачами UXR.
import { detectLang, t, type Lang } from '../i18n/messages';
import { switchNavUrl } from '../nav/navVersion';
import { NavSwitch } from './NavSwitch';

export function PersonalSettings({ lang = detectLang() }: { lang?: Lang }) {
  const targetUrl = typeof location === 'undefined' ? null : switchNavUrl(location, 'v1');
  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title" className="settings-title">{t(lang, 'settings.title')}</h2>
      <NavSwitch lang={lang} targetUrl={targetUrl} />
    </section>
  );
}
