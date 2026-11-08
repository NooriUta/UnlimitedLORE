// Переключатель «новая навигация» (SPRINT_UXR_S3_V2_INFRA/S3-07).
// В v2 он всегда включён: выключение = запомнить nav=v1 в seer-prefs и уйти на v1.
import { t, type Lang } from '../i18n/messages';
import { switchNav } from '../nav/navVersion';

export interface NavSwitchProps {
  lang: Lang;
  /** Адрес v1 для текущего хоста; null — пары нет, переключатель выключен. */
  targetUrl: string | null;
  /** Для тестов; по умолчанию — переход браузера. */
  onNavigate?: (url: string) => void;
}

export function NavSwitch({ lang, targetUrl, onNavigate }: NavSwitchProps) {
  const unavailable = targetUrl == null;
  const onChange = () => {
    const url = switchNav('v1');
    if (!url) return;
    (onNavigate ?? (u => window.location.assign(u)))(url);
  };
  return (
    <div className="setting-row" data-nav-switch="v2">
      <label className="setting-label">
        <input
          type="checkbox"
          className="setting-toggle"
          checked
          disabled={unavailable}
          onChange={onChange}
        />
        <span>{t(lang, 'settings.nav.label')}</span>
      </label>
      <p className={unavailable ? 'setting-hint setting-hint-warn' : 'setting-hint'}>
        {t(lang, unavailable ? 'settings.nav.unavailable' : 'settings.nav.hint')}
      </p>
    </div>
  );
}
