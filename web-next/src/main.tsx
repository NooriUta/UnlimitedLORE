import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KitLangProvider, applyTheme, registerGameIcons, resolvePrefs } from '@seidr/kit';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { AuthGate } from '@seidr/kit/auth';
import App from './App';
import { v2Auth } from './auth/session';
import { installServerPulse } from './shell/serverPulse';
import { themeSource } from './storage/themeSource';
import { ShowTechFromSettings } from './settings/ShowTech';
import { staleChunk } from './shell/staleChunk';

// Иконки game-icons — весь набор офлайн, до первого рендера (S4-00b): CSP
// запрещает удалённую подгрузку, а неизвестный слаг GameIcon рисует честной
// заглушкой data-missing, а не пустотой.
registerGameIcons(gameIcons);

// Тема — до первого рендера, из того же сохранённого выбора, что у v1
// (lore-palette/lore-mode, общая cookie seer-prefs — storage/themeSource.ts):
// иначе экран мигнул бы умолчанием, а v2 открывался бы не в той теме, что v1.
applyTheme(document.documentElement, resolvePrefs(themeSource()));

// Язык подписей kit (состояния, «Закрыть», S4-00c) — по <html lang>, один раз
// на приложение. Своих переводов этих строк web-next не держит.
const kitLang = document.documentElement.lang === 'en' ? 'en' : 'ru';

// Свой вход v2 (S3-18): сессия поднимается до приложения — callback Keycloak,
// сохранённый пользователь, тихое продление. Пока не поднялась, AuthGate
// показывает скелет; нет сессии — уводит на вход; вход выключен — как раньше.
void v2Auth.init();

// Устаревший чанк после выкатки (S4-STALE-CHUNK): вкладка на прежней сборке
// просит чанк, которого на сервере уже нет. Одна перезагрузка, повтор — плашка.
// Слушатель — до рендера: первый же ленивый раздел может упасть.
staleChunk.install(window);
// Свежесть для строки состояния (S4-21): когда сервер LORE ответил в последний раз.
installServerPulse();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KitLangProvider lang={kitLang}>
      <AuthGate session={v2Auth}>
        {/* S4-TECH-NOTES: техническое скрыто, пока его не включили личной настройкой. */}
        <ShowTechFromSettings>
          <App />
        </ShowTechFromSettings>
      </AuthGate>
    </KitLangProvider>
  </StrictMode>,
);
